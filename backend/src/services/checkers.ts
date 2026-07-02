import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import axios from "axios";

export interface HttpCheckResult {
  ok: boolean;
  statusCode: number | null;
  latency: number | null;
}

function parseUpCodes(str = "2xx,3xx"): (code: number) => boolean {
  const parts = str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (code: number) =>
    parts.some((p) => {
      if (p.endsWith("xx")) return Math.floor(code / 100) === parseInt(p[0], 10);
      return parseInt(p, 10) === code;
    });
}

// HTTP/HTTPS availability check (HEAD, falling back to GET).
export async function httpCheck(
  targetUrl: string,
  opts: {
    timeoutMs?: number;
    followRedirects?: boolean;
    upCodes?: string;
  } = {}
): Promise<HttpCheckResult> {
  const { timeoutMs = 30000, followRedirects = true, upCodes = "2xx,3xx" } = opts;
  const start = Date.now();
  const u = new URL(targetUrl);
  const lib = u.protocol === "https:" ? https : http;
  const isUp = parseUpCodes(upCodes);

  let redirects = 0;
  const maxRedirects = 10;

  const makeReq = (method: string, urlStr: string): Promise<{ statusCode: number; latency: number }> =>
    new Promise<{ statusCode: number; latency: number }>((resolve, reject) => {
      const req = lib.request(
        urlStr,
        { method, timeout: timeoutMs, headers: { "user-agent": "domains-monit/2.0" } },
        (res) => {
          const code = res.statusCode ?? 0;
          if (
            followRedirects &&
            [301, 302, 303, 307, 308].includes(code) &&
            res.headers.location &&
            redirects < maxRedirects
          ) {
            redirects++;
            res.resume();
            resolve(makeReq("GET", new URL(res.headers.location, urlStr).toString()));
            return;
          }
          res.resume();
          resolve({ statusCode: code, latency: Date.now() - start });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("TIMEOUT")));
      req.end();
    }).catch(async (err) => {
      if (method === "HEAD") return makeReq("GET", urlStr);
      throw err;
    });

  const r = await makeReq("HEAD", targetUrl);
  return { ok: isUp(r.statusCode), statusCode: r.statusCode, latency: r.latency };
}

// SSL certificate expiry date (best effort).
export async function getSSLTill(
  targetUrl: string,
  timeoutMs = 10000
): Promise<Date | null> {
  const { hostname, port } = new URL(targetUrl);
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: hostname,
        port: port ? Number(port) : 443,
        servername: hostname,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) return resolve(null);
        const d = new Date(cert.valid_to);
        resolve(isNaN(d.getTime()) ? null : d);
      }
    );
    socket.on("error", () => resolve(null));
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(null);
    });
  });
}

// Domain registration expiry via RDAP (best effort).
export async function getDomainExpiry(targetUrl: string): Promise<Date | null> {
  const hostname = new URL(targetUrl).hostname;
  try {
    const { data } = await axios.get(`https://rdap.org/domain/${hostname}`, {
      timeout: 8000,
    });
    if (data && Array.isArray(data.events)) {
      const ev = data.events.find((e: { eventAction?: string }) =>
        String(e.eventAction ?? "").toLowerCase().includes("expir")
      );
      if (ev?.eventDate) {
        const d = new Date(ev.eventDate);
        if (!isNaN(d.getTime())) return d;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
