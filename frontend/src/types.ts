export interface Domain {
  id: number;
  domain_name: string;
  status: string;
  registrar: string;
  registration_date: string;
  expiration_date: string;
  namecheap_account_id: number;
  cloudflare_account_id: number;
  keitaro_id: number;
  ns: string;
  ssl: string;
  http_status: string;
  latency_ms: number;
  last_check: string;
  monitoring_status: string;
  
  keitaro_name?: string;
  keitaro_ip?: string;
  namecheap_name?: string;
  cloudflare_name?: string;
}

export interface NamecheapAccount {
  id: number;
  name: string;
  username: string;
  api_user: string;
  api_key: string;
  client_ip: string;
  status: string;
  balance: number;
  group_id: number | null;
}

export interface CloudflareAccount {
  id: number;
  name: string;
  api_token: string;
  email: string;
  status: string;
  group_id: number | null;
}

export interface KeitaroTracker {
  id: number;
  name: string;
  url: string;
  api_key: string;
  server_ip: string;
  status: string;
  group_id: number | null;
}

export interface CloudflareTemplate {
  id: number;
  name: string;
  proxy_on: boolean;
  ssl_mode: string;
  bot_fight_mode: boolean;
  https_redirect: boolean;
}
