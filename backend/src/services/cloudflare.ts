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
    await this.upsertDnsRecord(zone.zoneId, domain, targetIp, tpl.proxy_on);
    await this.applyTemplate(zone.zoneId, tpl);
    return zone;
  }
}
