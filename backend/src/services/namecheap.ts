import axios from "axios";
import { XMLParser } from "fast-xml-parser";

export interface NamecheapCredentials {
  apiUser: string;
  apiKey: string;
  userName: string;
  clientIp: string;
  apiUrl?: string;
}

export interface DomainCheckResult {
  domain: string;
  available: boolean;
  isPremium: boolean;
  premiumPrice?: number;
}

// Contact profile used for registration (WHOIS). Namecheap requires a full set.
export interface ContactProfile {
  FirstName: string;
  LastName: string;
  Address1: string;
  City: string;
  StateProvince: string;
  PostalCode: string;
  Country: string;
  Phone: string; // e.g. +1.6613102107
  EmailAddress: string;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export class NamecheapClient {
  private apiUrl: string;

  constructor(private creds: NamecheapCredentials) {
    this.apiUrl = creds.apiUrl ?? "https://api.namecheap.com/xml.response";
  }

  private baseParams(command: string): Record<string, string> {
    return {
      ApiUser: this.creds.apiUser,
      ApiKey: this.creds.apiKey,
      UserName: this.creds.userName,
      ClientIp: this.creds.clientIp,
      Command: command,
    };
  }

  private async call(command: string, params: Record<string, string | number>): Promise<any> {
    const { data } = await axios.get(this.apiUrl, {
      params: { ...this.baseParams(command), ...params },
      timeout: 30000,
    });
    const parsed = parser.parse(data);
    const response = parsed?.ApiResponse;
    if (!response) throw new Error("Invalid Namecheap response");
    if (response["@_Status"] === "ERROR") {
      const errors = response.Errors?.Error;
      const message = Array.isArray(errors)
        ? errors.map((e: any) => e["#text"] ?? e).join("; ")
        : errors?.["#text"] ?? errors ?? "Unknown Namecheap error";
      throw new Error(`Namecheap: ${message}`);
    }
    return response.CommandResponse;
  }

  async checkDomains(domains: string[]): Promise<DomainCheckResult[]> {
    if (!domains.length) return [];
    const cmd = await this.call("namecheap.domains.check", {
      DomainList: domains.join(","),
    });
    const raw = cmd.DomainCheckResult;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.map((d: any) => ({
      domain: d["@_Domain"],
      available: d["@_Available"] === "true",
      isPremium: d["@_IsPremiumName"] === "true",
      premiumPrice: d["@_PremiumRegistrationPrice"]
        ? Number(d["@_PremiumRegistrationPrice"])
        : undefined,
    }));
  }

  async getBalance(): Promise<number> {
    const cmd = await this.call("namecheap.users.getBalances", {});
    const raw = cmd?.UserGetBalancesResult?.["@_AvailableBalance"];
    if (raw === undefined || raw === null) return 0;
    // Strip currency symbols / thousands separators, keep digits and dot.
    const n = Number(String(raw).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  async registerDomain(
    domain: string,
    contact: ContactProfile,
    opts: { years?: number; nameservers?: string[] } = {}
  ): Promise<{ domain: string; registered: boolean; chargedAmount?: number }> {
    const roles = ["Registrant", "Tech", "Admin", "AuxBilling"];
    const contactParams: Record<string, string> = {};
    for (const role of roles) {
      for (const [k, v] of Object.entries(contact)) {
        contactParams[`${role}${k}`] = String(v);
      }
    }

    const params: Record<string, string | number> = {
      DomainName: domain,
      Years: opts.years ?? 1,
      ...contactParams,
    };
    if (opts.nameservers?.length) {
      params.Nameservers = opts.nameservers.join(",");
    }

    const cmd = await this.call("namecheap.domains.create", params);
    const result = cmd.DomainCreateResult;
    return {
      domain: result?.["@_Domain"] ?? domain,
      registered: result?.["@_Registered"] === "true",
      chargedAmount: result?.["@_ChargedAmount"]
        ? Number(result["@_ChargedAmount"])
        : undefined,
    };
  }

  // Point the domain at custom (Cloudflare) name servers.
  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    const [sld, ...rest] = domain.split(".");
    const tld = rest.join(".");
    await this.call("namecheap.domains.dns.setCustom", {
      SLD: sld,
      TLD: tld,
      Nameservers: nameservers.join(","),
    });
  }
}
