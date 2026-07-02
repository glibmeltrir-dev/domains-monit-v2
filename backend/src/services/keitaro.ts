import axios, { type AxiosInstance } from "axios";

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

  async listDomains(): Promise<Array<{ id: number; name: string }>> {
    const { data } = await this.http.get("/admin_api/v1/domains");
    return Array.isArray(data) ? data : [];
  }
}
