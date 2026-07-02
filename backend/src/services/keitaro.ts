import axios, { type AxiosInstance } from "axios";

export interface KeitaroDomain {
  id: number;
  name: string;
  group_id: number | null;
}

export interface KeitaroCampaign {
  id: number;
  name: string;
  domain_id: number | null;
}

export interface KeitaroGroup {
  id: number;
  name: string;
  type: string | null;
}

export class KeitaroClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      timeout: 20000,
    });
  }

  // Register a domain in the Keitaro tracker so it can serve campaigns.
  async addDomain(domain: string): Promise<void> {
    await this.http.post("/admin_api/v1/domains", {
      name: domain,
      ssl_redirect: true,
    });
  }

  async listDomains(): Promise<KeitaroDomain[]> {
    const { data } = await this.http.get("/admin_api/v1/domains");
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
      id: d.id,
      name: d.name,
      group_id: d.group_id ?? null,
    }));
  }

  // Remove a domain from the tracker by its Keitaro id.
  async deleteDomain(id: number): Promise<void> {
    await this.http.delete(`/admin_api/v1/domains/${id}`);
  }

  // PUT updates only the provided fields — here just the domain group.
  async updateDomainGroup(id: number, groupId: number): Promise<void> {
    await this.http.put(`/admin_api/v1/domains/${id}`, { group_id: groupId });
  }

  async listCampaigns(): Promise<KeitaroCampaign[]> {
    const { data } = await this.http.get("/admin_api/v1/campaigns");
    if (!Array.isArray(data)) return [];
    return data.map((c: any) => ({
      id: c.id,
      name: c.name,
      domain_id: c.domain_id ?? null,
    }));
  }

  // Rebind a campaign to a different tracking domain (PUT updates only domain_id).
  async updateCampaignDomain(id: number, domainId: number): Promise<void> {
    await this.http.put(`/admin_api/v1/campaigns/${id}`, { domain_id: domainId });
  }

  // List groups. Domain groups may require a `type` filter on some Keitaro
  // versions — we try without it first and fall back to `?type=domain`.
  async listGroups(): Promise<KeitaroGroup[]> {
    const parse = (data: unknown): KeitaroGroup[] =>
      Array.isArray(data)
        ? data.map((g: any) => ({ id: g.id, name: g.name, type: g.type ?? null }))
        : [];
    try {
      const { data } = await this.http.get("/admin_api/v1/groups");
      const arr = parse(data);
      if (arr.length) return arr;
    } catch {
      // ignore and try with the type filter
    }
    try {
      const { data } = await this.http.get("/admin_api/v1/groups", {
        params: { type: "domain" },
      });
      return parse(data);
    } catch {
      return [];
    }
  }
}
