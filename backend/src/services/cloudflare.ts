import axios, { type AxiosInstance } from "axios";
import { config } from "../config.ts";

export interface CloudflareTemplate {
  proxy_on: boolean;
  ssl_mode: string;
  bot_fight_mode: boolean;
  https_redirect: boolean;
}

export interface ZoneResult {
  zoneId: string;
  nameServers: string[];
}

export interface ZoneInfo {
  id: string;
  name: string;
  nameServers: string[];
  status: string;
}

function mapSslMode(mode: string): "off" | "flexible" | "full" | "strict" {
  switch ((mode || "").toLowerCase()) {
    case "off":
      return "off";
    case "flexible":
      return "flexible";
    case "full (strict)":
    case "strict":
      return "strict";
    case "full":
    default:
      return "full";
  }
}

export class CloudflareClient {
  private http: AxiosInstance;

  constructor(apiToken: string, private accountId?: string) {
    this.http = axios.create({
      baseURL: "https://api.cloudflare.com/client/v4",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    });
  }

  private unwrap<T>(data: { success: boolean; errors?: unknown[]; result: T }): T {
    if (!data.success) {
      throw new Error(`Cloudflare API error: ${JSON.stringify(data.errors)}`);
    }
    return data.result;
  }

  async resolveAccountId(): Promise<string> {
    if (this.accountId) return this.accountId;
    const { data } = await this.http.get("/accounts", { params: { per_page: 1 } });
    const accounts = this.unwrap<Array<{ id: string }>>(data);
    if (!accounts.length) throw new Error("No Cloudflare account available for token");
    this.accountId = accounts[0].id;
    return this.accountId;
  }

  // Create a zone (or return the existing one) and its assigned name servers.
  async ensureZone(domain: string): Promise<ZoneResult> {
    const existing = await this.http.get("/zones", { params: { name: domain } });
    const found = this.unwrap<Array<{ id: string; name_servers: string[] }>>(existing.data);
    if (found.length) {
      return { zoneId: found[0].id, nameServers: found[0].name_servers ?? [] };
    }

    const accountId = await this.resolveAccountId();
    const { data } = await this.http.post("/zones", {
      name: domain,
      account: { id: accountId },
      jump_start: false,
      type: "full",
    });
    const zone = this.unwrap<{ id: string; name_servers: string[] }>(data);
    return { zoneId: zone.id, nameServers: zone.name_servers ?? [] };
  }

  // List every zone on the account (paginated). Used by the reconcile/sync job
  // to match our domains to their Cloudflare zone in a single pass.
  async listZones(): Promise<ZoneInfo[]> {
    const out: ZoneInfo[] = [];
    let page = 1;
    for (;;) {
      const { data } = await this.http.get("/zones", {
        params: { per_page: 50, page },
      });
      const result = this.unwrap<
        Array<{ id: string; name: string; name_servers?: string[]; status: string }>
      >(data);
      for (const z of result) {
        out.push({
          id: z.id,
          name: z.name.toLowerCase(),
          nameServers: z.name_servers ?? [],
          status: z.status,
        });
      }
      const info = (data as { result_info?: { total_pages?: number } }).result_info;
      if (!result.length || !info || page >= (info.total_pages ?? 1)) break;
      page++;
    }
    return out;
  }

  // Read the origin A record for a zone (content = real target IP, plus proxy
  // state). This is the accurate way to tell where a proxied domain points.
  async getARecord(
    zoneId: string,
    name: string
  ): Promise<{ content: string; proxied: boolean } | null> {
    const { data } = await this.http.get(`/zones/${zoneId}/dns_records`, {
      params: { type: "A", name },
    });
    const records = this.unwrap<Array<{ content: string; proxied: boolean }>>(data);
    if (!records.length) return null;
    return { content: records[0].content, proxied: !!records[0].proxied };
  }

  async upsertDnsRecord(
    zoneId: string,
    domain: string,
    content: string,
    proxied: boolean
  ): Promise<void> {
    const list = await this.http.get(`/zones/${zoneId}/dns_records`, {
      params: { type: "A", name: domain },
    });
    const records = this.unwrap<Array<{ id: string }>>(list.data);
    const body = { type: "A", name: domain, content, proxied, ttl: 1 };

    if (records.length) {
      await this.http.put(`/zones/${zoneId}/dns_records/${records[0].id}`, body);
    } else {
      await this.http.post(`/zones/${zoneId}/dns_records`, body);
    }
  }

  // Route the whole domain to the origin the "correct" way:
  //   - apex (@)  -> A record to the target IP
  //   - www       -> CNAME to the apex (NOT an A record); any stale www A
  //                  records are deleted first
  //   - other A records -> repointed to the target IP as well
  async pointDomainToOrigin(
    zoneId: string,
    domain: string,
    content: string,
    proxied: boolean
  ): Promise<void> {
    const apex = domain.toLowerCase();
    const wwwName = `www.${apex}`;

    const list = await this.http.get(`/zones/${zoneId}/dns_records`, {
      params: { per_page: 100 },
    });
    const records = this.unwrap<Array<{ id: string; name: string; type: string }>>(list.data);
    const lc = (s: string) => s.toLowerCase();

    const apexA = records.filter((r) => r.type === "A" && lc(r.name) === apex);
    const wwwRecs = records.filter((r) => lc(r.name) === wwwName);
    const otherA = records.filter(
      (r) => r.type === "A" && lc(r.name) !== apex && lc(r.name) !== wwwName
    );

    // 1) apex A record -> target IP (create if missing, drop duplicates)
    if (apexA.length) {
      await this.http.put(`/zones/${zoneId}/dns_records/${apexA[0].id}`, {
        type: "A",
        name: domain,
        content,
        proxied,
        ttl: 1,
      });
      for (const dup of apexA.slice(1)) {
        await this.http.delete(`/zones/${zoneId}/dns_records/${dup.id}`);
      }
    } else {
      await this.http.post(`/zones/${zoneId}/dns_records`, {
        type: "A",
        name: domain,
        content,
        proxied,
        ttl: 1,
      });
    }

    // 2) www -> CNAME to apex. Delete any non-CNAME (e.g. stale A) www records,
    //    then upsert the CNAME.
    const wwwCname = wwwRecs.find((r) => r.type === "CNAME");
    for (const r of wwwRecs) {
      if (r.type !== "CNAME") {
        await this.http.delete(`/zones/${zoneId}/dns_records/${r.id}`);
      }
    }
    if (wwwCname) {
      await this.http.put(`/zones/${zoneId}/dns_records/${wwwCname.id}`, {
        type: "CNAME",
        name: wwwName,
        content: domain,
        proxied,
        ttl: 1,
      });
    } else {
      await this.http.post(`/zones/${zoneId}/dns_records`, {
        type: "CNAME",
        name: wwwName,
        content: domain,
        proxied,
        ttl: 1,
      });
    }

    // 3) any remaining A records -> keep them pointing at the origin
    for (const r of otherA) {
      await this.http.put(`/zones/${zoneId}/dns_records/${r.id}`, {
        type: "A",
        name: r.name,
        content,
        proxied,
        ttl: 1,
      });
    }
  }

  async applyTemplate(zoneId: string, tpl: CloudflareTemplate): Promise<void> {
    // SSL mode
    await this.http
      .patch(`/zones/${zoneId}/settings/ssl`, { value: mapSslMode(tpl.ssl_mode) })
      .catch(() => undefined);

    // Always Use HTTPS
    await this.http
      .patch(`/zones/${zoneId}/settings/always_use_https`, {
        value: tpl.https_redirect ? "on" : "off",
      })
      .catch(() => undefined);

    // Bot Fight Mode (may be unavailable on some plans; ignore failures)
    await this.http
      .post(`/zones/${zoneId}/bot_management`, {
        fight_mode: tpl.bot_fight_mode,
      })
      .catch(() => undefined);
  }

  // Full connect flow for one domain against the configured target IP.
  async connectDomain(
    domain: string,
    tpl: CloudflareTemplate,
    targetIp = config.keitaroDefaultIp
  ): Promise<ZoneResult> {
    const zone = await this.ensureZone(domain);
    await this.pointDomainToOrigin(zone.zoneId, domain, targetIp, tpl.proxy_on);
    await this.applyTemplate(zone.zoneId, tpl);
    return zone;
  }
}
