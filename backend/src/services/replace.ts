import { query } from "../db/pool.ts";
import { logger } from "../logger.ts";
import { KeitaroClient, keitaroHasGroup } from "./keitaro.ts";
import { sendTG } from "./telegram.ts";
import { fetchDomainContext, repointDomain } from "./provision.ts";

function normalizeDomain(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

// Ошибка валидации замены — роут возвращает её как HTTP 400.
export class ReplaceValidationError extends Error {}

export interface KeitaroUsage {
  domain: string;
  keitaroId: number | null;
  groupId: number | null;
  campaigns: Array<{ id: number; name: string }>;
}

export interface NewDomainCheck {
  newDomain: string;
  existsInKeitaro: boolean;
  groupId: number | null;
  campaigns: Array<{ id: number; name: string }>;
  clean: boolean;
}

// Проверяем, пригоден ли новый домен для замены: он должен либо отсутствовать в
// Keitaro, либо присутствовать без группы и без привязанных кампаний. Использует
// трекер старого домена.
export async function checkNewDomain(
  oldId: number,
  newDomainRaw: string
): Promise<NewDomainCheck> {
  const ctx = await fetchDomainContext(oldId);
  if (!ctx) throw new Error(`Домен ${oldId} не найден`);
  if (!ctx.keitaro_url || !ctx.keitaro_key) {
    throw new Error("У старого домена не привязан трекер Keitaro (нужны url и ключ)");
  }
  const newDomain = normalizeDomain(newDomainRaw);
  if (!newDomain) throw new Error("Некорректное имя нового домена");

  const kc = new KeitaroClient(ctx.keitaro_url, ctx.keitaro_key);
  const list = await kc.listDomains();
  const existing = list.find((d) => d.name?.toLowerCase() === newDomain);
  if (!existing) {
    return { newDomain, existsInKeitaro: false, groupId: null, campaigns: [], clean: true };
  }
  const hasGroup = keitaroHasGroup(existing.group_id);
  // Список кампаний тянем только если счётчик ненулевой (для имён в UI).
  let bound: Array<{ id: number; name: string }> = [];
  if ((existing.campaigns_count ?? 0) > 0) {
    const campaigns = await kc.listCampaigns();
    bound = campaigns
      .filter((c) => Number(c.domain_id) === Number(existing.id))
      .map((c) => ({ id: c.id, name: c.name }));
  }
  const clean = !hasGroup && (existing.campaigns_count ?? 0) === 0 && bound.length === 0;
  return {
    newDomain,
    existsInKeitaro: true,
    groupId: hasGroup ? existing.group_id : null,
    campaigns: bound,
    clean,
  };
}

// Read the old domain's current footprint in Keitaro: its tracker id, group and
// the campaigns bound to it. Used by the replace page for the preview.
export async function getKeitaroUsage(domainId: number): Promise<KeitaroUsage> {
  const ctx = await fetchDomainContext(domainId);
  if (!ctx) throw new Error(`Домен ${domainId} не найден`);
  const domain = String(ctx.domain_name || "").toLowerCase();
  if (!ctx.keitaro_url || !ctx.keitaro_key) {
    return { domain, keitaroId: null, groupId: null, campaigns: [] };
  }
  const kc = new KeitaroClient(ctx.keitaro_url, ctx.keitaro_key);
  const list = await kc.listDomains();
  const match = list.find((d) => d.name?.toLowerCase() === domain);
  if (!match) return { domain, keitaroId: null, groupId: null, campaigns: [] };
  const campaigns = await kc.listCampaigns();
  const used = campaigns
    .filter((c) => Number(c.domain_id) === Number(match.id))
    .map((c) => ({ id: c.id, name: c.name }));
  return {
    domain,
    keitaroId: match.id,
    groupId: keitaroHasGroup(match.group_id) ? match.group_id : null,
    campaigns: used,
  };
}

// Список "чистых" доменов в Keitaro (без группы и без кампаний) — для выбора
// нового домена при замене. Берём трекер указанного домена (или первый активный).
export async function listCleanKeitaroDomains(oldId?: number): Promise<string[]> {
  let url: string | null = null;
  let key: string | null = null;
  if (oldId) {
    const ctx = await fetchDomainContext(oldId);
    url = ctx?.keitaro_url ?? null;
    key = ctx?.keitaro_key ?? null;
  }
  if (!url || !key) {
    const { rows } = await query<{ url: string; api_key: string }>(
      "SELECT url, api_key FROM keitaro_trackers WHERE status = 'ACTIVE' AND url <> '' AND api_key <> '' ORDER BY id LIMIT 1"
    );
    url = rows[0]?.url ?? null;
    key = rows[0]?.api_key ?? null;
  }
  if (!url || !key) throw new Error("Нет активного трекера Keitaro");

  const kc = new KeitaroClient(url, key);
  const list = await kc.listDomains();
  return list
    .filter((d) => !keitaroHasGroup(d.group_id) && (d.campaigns_count ?? 0) === 0)
    .map((d) => d.name)
    .filter(Boolean)
    .sort();
}

export interface ReplaceReport {
  oldDomain: string;
  newDomain: string;
  newId: number;
  newKeitaroId: number | null;
  oldKeitaroId: number | null;
  groupId: number | null;
  campaignsRebound: number;
  steps: string[];
  warnings: string[];
}

// Replace an expiring domain with a new one: create/point the new domain, carry
// over the Keitaro group, rebind every campaign of the old domain to the new
// one, then delete the old domain from Keitaro and our DB. Each external step is
// defensive so a partial failure still returns a meaningful report.
export async function replaceDomain(oldId: number, newDomainRaw: string): Promise<ReplaceReport> {
  const ctx = await fetchDomainContext(oldId);
  if (!ctx) throw new Error(`Домен ${oldId} не найден`);
  if (!ctx.keitaro_url || !ctx.keitaro_key) {
    throw new Error("У старого домена не привязан трекер Keitaro (нужны url и ключ)");
  }

  const oldDomain = String(ctx.domain_name || "").toLowerCase();
  const newDomain = normalizeDomain(newDomainRaw);
  if (!newDomain) throw new Error("Некорректное имя нового домена");
  if (newDomain === oldDomain) throw new Error("Новый домен совпадает со старым");

  const report: ReplaceReport = {
    oldDomain,
    newDomain,
    newId: 0,
    newKeitaroId: null,
    oldKeitaroId: null,
    groupId: null,
    campaignsRebound: 0,
    steps: [],
    warnings: [],
  };

  const kc = new KeitaroClient(ctx.keitaro_url, ctx.keitaro_key);

  // 1a) Валидация: новый домен должен быть "чистым" в Keitaro — без группы и без
  // привязанных кампаний. Если он ещё не заведён в трекере — это допустимо.
  // Проверяем ДО любых изменений, чтобы при ошибке ничего не пострадало.
  {
    const preList = await kc.listDomains();
    const existingNew = preList.find((d) => d.name?.toLowerCase() === newDomain);
    if (existingNew) {
      const dirty =
        keitaroHasGroup(existingNew.group_id) || (existingNew.campaigns_count ?? 0) > 0;
      if (dirty) {
        throw new ReplaceValidationError(
          "Новый домен уже привязан к группе/кампаниям в Keitaro — выберите чистый домен"
        );
      }
    }
  }

  // 2) Заводим новый домен в нашей БД, наследуя интеграции старого.
  const { rows: upserted } = await query<{ id: number }>(
    `INSERT INTO domains
       (domain_name, namecheap_account_id, cloudflare_account_id, keitaro_id,
        monitor_template_id, provision_status, monitoring_status)
     VALUES ($1, $2, $3, $4, $5, 'CONNECTED', 'PENDING')
     ON CONFLICT (domain_name) DO UPDATE SET
       namecheap_account_id  = COALESCE(domains.namecheap_account_id, EXCLUDED.namecheap_account_id),
       cloudflare_account_id = COALESCE(domains.cloudflare_account_id, EXCLUDED.cloudflare_account_id),
       keitaro_id            = COALESCE(domains.keitaro_id, EXCLUDED.keitaro_id),
       monitor_template_id   = COALESCE(domains.monitor_template_id, EXCLUDED.monitor_template_id)
     RETURNING id`,
    [
      newDomain,
      ctx.namecheap_account_id ?? null,
      ctx.cloudflare_account_id ?? null,
      ctx.keitaro_id ?? null,
      ctx.monitor_template_id ?? null,
    ]
  );
  const newId = upserted[0].id;
  report.newId = newId;
  report.steps.push(`Новый домен ${newDomain} добавлен в систему (id=${newId})`);

  // 3) Направляем новый домен на Keitaro через Cloudflare и регистрируем в трекере.
  try {
    await repointDomain(newId);
    report.steps.push(`${newDomain} направлен на Keitaro через Cloudflare`);
  } catch (err: any) {
    report.warnings.push(`Не удалось направить ${newDomain} на Keitaro: ${err?.message}`);
  }

  // Находим (или создаём) новый домен в Keitaro, чтобы получить его id.
  let kDomains = await kc.listDomains().catch((err: any) => {
    report.warnings.push(`Не удалось получить список доменов Keitaro: ${err?.message}`);
    return [] as Awaited<ReturnType<KeitaroClient["listDomains"]>>;
  });
  let newK = kDomains.find((d) => d.name?.toLowerCase() === newDomain);
  if (!newK) {
    try {
      await kc.addDomain(newDomain);
    } catch (err: any) {
      if (!/exist|already|taken|duplicate/i.test(String(err?.message ?? ""))) {
        report.warnings.push(`Не удалось создать ${newDomain} в Keitaro: ${err?.message}`);
      }
    }
    kDomains = await kc.listDomains().catch(() => kDomains);
    newK = kDomains.find((d) => d.name?.toLowerCase() === newDomain);
  }
  report.newKeitaroId = newK?.id ?? null;

  // 4) Ищем старый домен в Keitaro, переносим его группу на новый домен.
  const oldK = kDomains.find((d) => d.name?.toLowerCase() === oldDomain);
  report.oldKeitaroId = oldK?.id ?? null;
  const groupId = keitaroHasGroup(oldK?.group_id) ? oldK!.group_id : null;
  report.groupId = groupId;

  if (newK && groupId != null) {
    try {
      await kc.updateDomainGroup(newK.id, groupId);
      report.steps.push(`Группа ${groupId} перенесена на ${newDomain}`);
    } catch (err: any) {
      report.warnings.push(`Не удалось перенести группу: ${err?.message}`);
    }
  }

  // 5) Перепривязываем кампании старого домена на новый.
  if (newK && oldK) {
    try {
      const campaigns = await kc.listCampaigns();
      const affected = campaigns.filter((c) => Number(c.domain_id) === Number(oldK.id));
      for (const c of affected) {
        try {
          await kc.updateCampaignDomain(c.id, newK.id);
          report.campaignsRebound++;
        } catch (err: any) {
          report.warnings.push(`Кампания ${c.id} не перепривязана: ${err?.message}`);
        }
      }
      report.steps.push(`Перепривязано кампаний: ${report.campaignsRebound}`);
    } catch (err: any) {
      report.warnings.push(`Не удалось получить кампании Keitaro: ${err?.message}`);
    }
  }

  // 6) Удаляем старый домен из Keitaro и из нашей БД.
  if (oldK) {
    try {
      await kc.deleteDomain(oldK.id);
      report.steps.push(`Старый домен ${oldDomain} удалён из Keitaro`);
    } catch (err: any) {
      report.warnings.push(`Не удалось удалить старый домен из Keitaro: ${err?.message}`);
    }
  }
  await query("DELETE FROM domains WHERE id = $1", [oldId]);
  report.steps.push(`Старый домен ${oldDomain} удалён из системы`);

  logger.info({ oldDomain, newDomain, report }, "Domain replaced");

  // 7) Уведомление в Telegram.
  await sendTG(
    `♻️ <b>ЗАМЕНА</b> ${oldDomain} → ${newDomain}\n` +
      `Группа: ${groupId ?? "—"} • кампаний перепривязано: ${report.campaignsRebound}`,
    "purchase"
  );

  return report;
}
