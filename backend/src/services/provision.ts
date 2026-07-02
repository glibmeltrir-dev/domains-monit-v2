import { query } from "../db/pool.ts";
import { logger } from "../logger.ts";
import { config } from "../config.ts";
import { CloudflareClient, type CloudflareTemplate } from "./cloudflare.ts";
import { NamecheapClient, type ContactProfile } from "./namecheap.ts";
import { KeitaroClient } from "./keitaro.ts";
import { sendTG, getSetting } from "./telegram.ts";

export interface ProvisionOptions {
  register: boolean;
  cfTemplateId: number | null;
  years?: number;
}

async function getContactProfile(): Promise<ContactProfile | null> {
  const raw = (await getSetting("namecheap_contact")) || process.env.NAMECHEAP_CONTACT;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ContactProfile;
  } catch {
    return null;
  }
}

export async function fetchDomainContext(domainId: number) {
  const { rows } = await query<any>(
    `SELECT d.*, 
            nc.api_user, nc.api_key, nc.username AS nc_username, nc.client_ip,
            cf.api_token AS cf_token, cf.account_id AS cf_account_id,
            k.url AS keitaro_url, k.api_key AS keitaro_key, k.server_ip AS keitaro_ip
     FROM domains d
     LEFT JOIN namecheap_accounts nc ON nc.id = d.namecheap_account_id
     LEFT JOIN cloudflare_accounts cf ON cf.id = d.cloudflare_account_id
     LEFT JOIN keitaro_trackers k ON k.id = d.keitaro_id
     WHERE d.id = $1`,
    [domainId]
  );
  return rows[0] ?? null;
}

async function loadCfTemplate(id: number | null): Promise<CloudflareTemplate> {
  if (id) {
    const { rows } = await query<CloudflareTemplate>(
      "SELECT proxy_on, ssl_mode, bot_fight_mode, https_redirect FROM cloudflare_templates WHERE id = $1",
      [id]
    );
    if (rows[0]) return rows[0];
  }
  return { proxy_on: true, ssl_mode: "Full", bot_fight_mode: false, https_redirect: true };
}

// Point an already-existing domain at the Keitaro IP via Cloudflare and make
// sure it is registered in the Keitaro tracker. Unlike provisionDomain this
// does NOT touch provision_status / enabled, so a repoint never removes a live
// domain from monitoring — it only updates DNS + tracker membership.
export async function repointDomain(domainId: number): Promise<void> {
  const ctx = await fetchDomainContext(domainId);
  if (!ctx) throw new Error(`Domain ${domainId} not found`);
  const domain = ctx.domain_name as string;
  if (!ctx.cf_token) throw new Error("No Cloudflare account attached to domain");

  const cf = new CloudflareClient(ctx.cf_token, ctx.cf_account_id ?? undefined);
  const tpl = await loadCfTemplate(null);
  const targetIp = ctx.keitaro_ip || config.keitaroDefaultIp;

  const zone = await cf.connectDomain(domain, tpl, targetIp);

  // Already in the tracker (per the last sync)? Skip the API call entirely to
  // avoid a needless request / duplicate attempt.
  let keitaroOk = ctx.keitaro_registered === true;
  if (!keitaroOk && ctx.keitaro_url && ctx.keitaro_key) {
    try {
      await new KeitaroClient(ctx.keitaro_url, ctx.keitaro_key).addDomain(domain);
      keitaroOk = true;
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      // A domain that already exists in Keitaro is fine — treat as success.
      if (/exist|already|taken|duplicate/i.test(msg)) keitaroOk = true;
      else logger.warn({ err: msg, domain }, "Keitaro addDomain failed (non-fatal)");
    }
  }

  await query(
    `UPDATE domains
       SET cloudflare_zone_id   = $1,
           ns                   = $2,
           resolved_ip          = $3,
           proxied              = $4,
           keitaro_registered   = CASE WHEN $5 THEN TRUE ELSE keitaro_registered END,
           synced_at            = now()
     WHERE id = $6`,
    [zone.zoneId, zone.nameServers.join("\n"), targetIp, tpl.proxy_on, keitaroOk, domainId]
  );

  await query("INSERT INTO incidents (domain_id, type, message) VALUES ($1, 'provision', $2)", [
    domainId,
    `🎯 ${domain} направлен на Keitaro (${targetIp})`,
  ]);
  await sendTG(`🎯 <b>KEITARO</b> ${domain} → ${targetIp}`, "purchase");
}

// Best-effort removal of a domain from its Keitaro tracker before the DB row is
// deleted. Looks up the tracker creds, finds the Keitaro domain by name and
// deletes it. Missing tracker / missing domain is not fatal.
export async function removeFromKeitaro(domainId: number): Promise<void> {
  const ctx = await fetchDomainContext(domainId);
  if (!ctx || !ctx.keitaro_url || !ctx.keitaro_key) return;
  const domain = String(ctx.domain_name || "").toLowerCase();
  if (!domain) return;
  try {
    const kc = new KeitaroClient(ctx.keitaro_url, ctx.keitaro_key);
    const list = await kc.listDomains();
    const match = list.find((d) => d.name?.toLowerCase() === domain);
    if (match) await kc.deleteDomain(match.id);
  } catch (err: any) {
    logger.warn({ err: err?.message, domain }, "Keitaro deleteDomain failed (non-fatal)");
  }
}

// Buy (optional) + connect a single domain end-to-end.
export async function provisionDomain(
  domainId: number,
  opts: ProvisionOptions
): Promise<void> {
  const ctx = await fetchDomainContext(domainId);
  if (!ctx) throw new Error(`Domain ${domainId} not found`);

  const domain = ctx.domain_name as string;
  await query("UPDATE domains SET provision_status = 'PROVISIONING', provision_error = NULL WHERE id = $1", [
    domainId,
  ]);

  try {
    if (!ctx.cf_token) throw new Error("No Cloudflare account attached to domain");

    const cf = new CloudflareClient(ctx.cf_token, ctx.cf_account_id ?? undefined);
    const tpl = await loadCfTemplate(opts.cfTemplateId);
    const targetIp = ctx.keitaro_ip || config.keitaroDefaultIp;

    // 1) Cloudflare: create zone, DNS A record -> target, apply settings.
    const zone = await cf.connectDomain(domain, tpl, targetIp);
    logger.info({ domain, zoneId: zone.zoneId }, "Cloudflare zone connected");

    // 2) Namecheap: register (optional) and point NS to Cloudflare.
    if (ctx.api_user && ctx.api_key) {
      const nc = new NamecheapClient({
        apiUser: ctx.api_user,
        apiKey: ctx.api_key,
        userName: ctx.nc_username,
        clientIp: ctx.client_ip || "",
      });

      if (opts.register) {
        const contact = await getContactProfile();
        if (!contact) throw new Error("Registration requested but no Namecheap contact profile configured");
        const result = await nc.registerDomain(domain, contact, {
          years: opts.years ?? 1,
          nameservers: zone.nameServers,
        });
        if (!result.registered) throw new Error("Namecheap registration returned not registered");
        logger.info({ domain, charged: result.chargedAmount }, "Domain registered");
      } else if (zone.nameServers.length) {
        await nc.setNameservers(domain, zone.nameServers).catch((err) =>
          logger.warn({ err: err?.message, domain }, "setNameservers failed (non-fatal)")
        );
      }
    }

    // 3) Keitaro: register the domain in the tracker.
    if (ctx.keitaro_url && ctx.keitaro_key) {
      await new KeitaroClient(ctx.keitaro_url, ctx.keitaro_key)
        .addDomain(domain)
        .catch((err) => logger.warn({ err: err?.message, domain }, "Keitaro addDomain failed (non-fatal)"));
    }

    await query(
      `UPDATE domains
       SET provision_status = 'CONNECTED',
           cloudflare_zone_id = $1,
           ns = $2,
           status = 'ACTIVE',
           enabled = TRUE
       WHERE id = $3`,
      [zone.zoneId, zone.nameServers.join("\n"), domainId]
    );

    await query("INSERT INTO incidents (domain_id, type, message) VALUES ($1, 'provision', $2)", [
      domainId,
      `🚀 ${domain} подключён (Cloudflare + Keitaro)`,
    ]);
    await sendTG(`🚀 <b>CONNECTED</b> ${domain} готов к работе`, "purchase");
  } catch (err: any) {
    const message = err?.message ?? "provision error";
    await query("UPDATE domains SET provision_status = 'FAILED', provision_error = $1 WHERE id = $2", [
      message,
      domainId,
    ]);
    await query("INSERT INTO incidents (domain_id, type, message) VALUES ($1, 'provision', $2)", [
      domainId,
      `⚠️ Provisioning failed for ${domain}: ${message}`,
    ]);
    await sendTG(`⚠️ <b>PROVISION FAILED</b> ${domain}: ${message}`, "purchase");
    throw err;
  }
}
