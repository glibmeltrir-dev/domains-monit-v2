import { query } from "../db/pool.ts";
import { logger } from "../logger.ts";
import { httpCheck, getSSLTill, getDomainExpiry, normalizeUrl } from "./checkers.ts";
import { sendTG, getSetting } from "./telegram.ts";

interface DomainRow {
  id: number;
  domain_name: string;
  monitoring_status: string;
  expiration_date: Date | null;
  request_timeout_ms: number;
  follow_redirects: boolean;
  check_ssl_errors: boolean;
  ssl_expiry_reminder_days: string;
  domain_expiry_reminder_days: string;
  slow_alert_ms: number | null;
  up_status_codes: string;
}

// Only hit RDAP when the registration date is unknown or close, to avoid
// hammering rdap.org on every check for domains that expire far in the future.
const RDAP_REFRESH_WINDOW_DAYS = 45;

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

function needReminder(daysList: string, targetDate: Date | null): number | null {
  const diffDays = daysUntil(targetDate);
  if (diffDays === null) return null;
  const days = daysList
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
  return days.includes(diffDays) ? diffDays : null;
}

async function loadDomain(domainId: number): Promise<DomainRow | null> {
  const { rows } = await query<DomainRow>(
    `SELECT d.id, d.domain_name, d.monitoring_status, d.expiration_date,
            COALESCE(t.request_timeout_ms, 30000)                 AS request_timeout_ms,
            COALESCE(t.follow_redirects, true)                    AS follow_redirects,
            COALESCE(t.check_ssl_errors, true)                    AS check_ssl_errors,
            COALESCE(t.ssl_expiry_reminder_days, '14,7,3,1')      AS ssl_expiry_reminder_days,
            COALESCE(t.domain_expiry_reminder_days, '30,14,7,1')  AS domain_expiry_reminder_days,
            t.slow_alert_ms                                       AS slow_alert_ms,
            COALESCE(t.up_status_codes, '2xx,3xx,404')            AS up_status_codes
     FROM domains d
     LEFT JOIN monitor_templates t ON t.id = d.monitor_template_id
     WHERE d.id = $1`,
    [domainId]
  );
  return rows[0] ?? null;
}

async function addIncident(domainId: number, type: string, message: string): Promise<void> {
  await query("INSERT INTO incidents (domain_id, type, message) VALUES ($1, $2, $3)", [
    domainId,
    type,
    message,
  ]);
}

// Prevent the same recurring alert (slow / expiry reminders) from being sent on
// every check within the window — a domain is checked far more often than once
// per day, so exact-day reminders would otherwise spam Telegram.
async function notifiedWithinHours(
  domainId: number,
  type: string,
  hours: number
): Promise<boolean> {
  const { rows } = await query(
    `SELECT 1 FROM incidents
     WHERE domain_id = $1 AND type = $2 AND created_at > now() - make_interval(hours => $3)
     LIMIT 1`,
    [domainId, type, hours]
  );
  return rows.length > 0;
}

// Resolve the SLOW threshold: per-template value wins, otherwise the global
// setting from the UI (Settings page), otherwise disabled.
async function resolveSlowThreshold(templateValue: number | null): Promise<number | null> {
  if (templateValue && templateValue > 0) return templateValue;
  const global = await getSetting("slow_threshold_ms");
  const n = global ? Number(global) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Perform a full check of a single domain and persist the result.
export async function checkDomain(domainId: number): Promise<void> {
  const m = await loadDomain(domainId);
  if (!m) return;

  const url = normalizeUrl(m.domain_name);
  const monitoringMsgs: string[] = [];
  const expiryMsgs: string[] = [];

  let monitoringStatus: "UP" | "DOWN" | "SLOW" = "DOWN";
  let httpCode: number | null = null;
  let latency: number | null = null;
  let sslTill: Date | null = null;

  const slowThreshold = await resolveSlowThreshold(m.slow_alert_ms);

  try {
    const http = await httpCheck(url, {
      timeoutMs: m.request_timeout_ms,
      followRedirects: m.follow_redirects,
      upCodes: m.up_status_codes,
    });
    httpCode = http.statusCode;
    latency = http.latency;
    monitoringStatus = http.ok ? "UP" : "DOWN";

    if (http.ok && slowThreshold && (http.latency ?? 0) > slowThreshold) {
      monitoringStatus = "SLOW";
      if (!(await notifiedWithinHours(m.id, "slow", 1))) {
        const msg = `⚠️ <b>SLOW</b> ${m.domain_name} — ${http.latency}ms (> ${slowThreshold}ms)`;
        monitoringMsgs.push(msg);
        await addIncident(m.id, "slow", msg);
      }
    }

    // SSL (best effort)
    sslTill = await getSSLTill(url).catch(() => null);
    if (sslTill) {
      const d = needReminder(m.ssl_expiry_reminder_days, sslTill);
      if (d !== null && !(await notifiedWithinHours(m.id, "ssl_expiry", 20))) {
        const msg = `🔒 <b>SSL</b> ${m.domain_name} expires in ${d} days (${sslTill
          .toISOString()
          .slice(0, 10)})`;
        expiryMsgs.push(msg);
        await addIncident(m.id, "ssl_expiry", msg);
      }
      // Expired certificate forces DOWN; the transition alert below reports it
      // once (avoids repeating the message on every subsequent check).
      if (m.check_ssl_errors && monitoringStatus !== "DOWN" && sslTill < new Date()) {
        monitoringStatus = "DOWN";
      }
    }
  } catch (err: any) {
    monitoringStatus = "DOWN";
    httpCode = null;
    latency = null;
    logger.debug({ err: err?.message, domain: m.domain_name }, "check failed");
  }

  // Status transition alert (UP <-> DOWN). SLOW is treated as UP for transitions.
  const prev = m.monitoring_status;
  const effectivePrev = prev === "SLOW" ? "UP" : prev;
  const effectiveNow = monitoringStatus === "SLOW" ? "UP" : monitoringStatus;
  if (prev !== "PENDING" && effectivePrev !== effectiveNow) {
    const msg =
      effectiveNow === "UP"
        ? `✅ <b>UP</b> ${m.domain_name} (HTTP ${httpCode ?? "-"}, ${latency ?? "-"}ms)`
        : `❌ <b>DOWN</b> ${m.domain_name} (HTTP ${httpCode ?? "-"})`;
    monitoringMsgs.push(msg);
    await addIncident(m.id, effectiveNow.toLowerCase(), msg);
  }

  // Domain registration expiry (RDAP) — refreshed only when unknown or close.
  let domainExpiry: Date | null = m.expiration_date ? new Date(m.expiration_date) : null;
  const dToExpiry = daysUntil(domainExpiry);
  if (domainExpiry === null || (dToExpiry !== null && dToExpiry <= RDAP_REFRESH_WINDOW_DAYS)) {
    const fresh = await getDomainExpiry(url).catch(() => null);
    if (fresh) domainExpiry = fresh;
  }
  const dRem = needReminder(m.domain_expiry_reminder_days, domainExpiry);
  if (dRem !== null && domainExpiry && !(await notifiedWithinHours(m.id, "domain_expiry", 20))) {
    const msg = `🌐 <b>DOMAIN</b> ${m.domain_name} expires in ${dRem} days (${domainExpiry
      .toISOString()
      .slice(0, 10)})`;
    expiryMsgs.push(msg);
    await addIncident(m.id, "domain_expiry", msg);
  }

  await query(
    `UPDATE domains
     SET monitoring_status = $1,
         last_http_code = $2,
         http_status = $3,
         latency_ms = $4,
         ssl_valid_till = COALESCE($5, ssl_valid_till),
         ssl = COALESCE($6, ssl),
         expiration_date = COALESCE($7, expiration_date),
         last_check = now()
     WHERE id = $8`,
    [
      monitoringStatus,
      httpCode,
      httpCode ? String(httpCode) : null,
      latency,
      sslTill ? sslTill.toISOString() : null,
      sslTill ? (sslTill < new Date() ? "Expired" : "Valid") : null,
      domainExpiry ? domainExpiry.toISOString() : null,
      m.id,
    ]
  );

  if (monitoringMsgs.length) await sendTG(monitoringMsgs.join("\n"), "monitoring");
  if (expiryMsgs.length) await sendTG(expiryMsgs.join("\n"), "expiry");
}
