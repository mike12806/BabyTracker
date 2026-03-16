import type { Env } from "../types/env.js";

// ── HTML helpers ──────────────────────────────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function durationMins(start: string, end: string | null): number | null {
  if (!end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms < 0 ? null : Math.round(ms / 60000);
}

function fmtDuration(mins: number | null): string {
  if (mins === null) return "ongoing";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function childAge(birthDate: string): string {
  const birth = new Date(birthDate);
  const totalDays = Math.floor((Date.now() - birth.getTime()) / 86400000);
  if (totalDays < 30) return `${totalDays} day${totalDays !== 1 ? "s" : ""} old`;
  const months = Math.floor(totalDays / 30.44);
  if (months < 24) return `${months} month${months !== 1 ? "s" : ""} old`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years}y ${rem}mo old` : `${years} year${years !== 1 ? "s" : ""} old`;
}

// ── DB row types ──────────────────────────────────────────────────────────────

interface UserRow { id: number; email: string; name: string }
interface ChildRow { id: number; first_name: string; last_name: string; birth_date: string }
interface FeedingRow { type: string; start_time: string; end_time: string | null; amount: number | null; amount_unit: string | null }
interface DiaperRow { time: string; type: string; color: string | null }
interface SleepRow { start_time: string; end_time: string | null; is_nap: number }
interface TummyRow { start_time: string; end_time: string | null; milestone: string | null }
interface PumpingRow { start_time: string; end_time: string | null; amount: number | null; amount_unit: string | null }
interface TemperatureRow { time: string; reading: number; reading_unit: string }
interface NoteRow { time: string; title: string | null; content: string }

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchChildData(
  env: Env,
  childId: number,
  start: string,
  end: string,
): Promise<{
  feedings: FeedingRow[];
  diapers: DiaperRow[];
  sleepSessions: SleepRow[];
  tummyTimes: TummyRow[];
  pumping: PumpingRow[];
  temperatures: TemperatureRow[];
  notes: NoteRow[];
}> {
  const [feedings, diapers, sleepSessions, tummyTimes, pumping, temperatures, notes] =
    await Promise.all([
      env.DB.prepare(
        "SELECT type, start_time, end_time, amount, amount_unit FROM feedings WHERE child_id = ? AND start_time >= ? AND start_time < ? ORDER BY start_time"
      ).bind(childId, start, end).all<FeedingRow>(),
      env.DB.prepare(
        "SELECT time, type, color FROM diaper_changes WHERE child_id = ? AND time >= ? AND time < ? ORDER BY time"
      ).bind(childId, start, end).all<DiaperRow>(),
      env.DB.prepare(
        "SELECT start_time, end_time, is_nap FROM sleep WHERE child_id = ? AND start_time < ? AND (end_time IS NULL OR end_time > ?) ORDER BY start_time"
      ).bind(childId, end, start).all<SleepRow>(),
      env.DB.prepare(
        "SELECT start_time, end_time, milestone FROM tummy_time WHERE child_id = ? AND start_time < ? AND (end_time IS NULL OR end_time > ?) ORDER BY start_time"
      ).bind(childId, end, start).all<TummyRow>(),
      env.DB.prepare(
        "SELECT start_time, end_time, amount, amount_unit FROM pumping WHERE child_id = ? AND start_time < ? AND (end_time IS NULL OR end_time > ?) ORDER BY start_time"
      ).bind(childId, end, start).all<PumpingRow>(),
      env.DB.prepare(
        "SELECT time, reading, reading_unit FROM temperature WHERE child_id = ? AND time >= ? AND time < ? ORDER BY time"
      ).bind(childId, start, end).all<TemperatureRow>(),
      env.DB.prepare(
        "SELECT time, title, content FROM notes WHERE child_id = ? AND time >= ? AND time < ? ORDER BY time"
      ).bind(childId, start, end).all<NoteRow>(),
    ]);

  return {
    feedings: feedings.results,
    diapers: diapers.results,
    sleepSessions: sleepSessions.results,
    tummyTimes: tummyTimes.results,
    pumping: pumping.results,
    temperatures: temperatures.results,
    notes: notes.results,
  };
}

// ── Email HTML builder ────────────────────────────────────────────────────────

function row(content: string): string {
  return `<tr><td style="padding:2px 0 2px 12px;font-size:13px;color:#555;line-height:1.5">${content}</td></tr>`;
}

function sectionHeader(icon: string, label: string): string {
  return `<tr><td style="padding:14px 0 4px 0"><strong style="font-size:14px;color:#444">${icon} ${esc(label)}</strong></td></tr>`;
}

function noData(): string {
  return `<tr><td style="padding:2px 0 10px 12px;font-size:13px;color:#aaa;font-style:italic">None recorded</td></tr>`;
}

function buildChildSection(
  child: ChildRow,
  feedings: FeedingRow[],
  diapers: DiaperRow[],
  sleepSessions: SleepRow[],
  tummyTimes: TummyRow[],
  pumping: PumpingRow[],
  temperatures: TemperatureRow[],
  notes: NoteRow[],
): string {
  const name = esc([child.first_name, child.last_name].filter(Boolean).join(" "));
  const age = esc(childAge(child.birth_date));
  const rows: string[] = [];

  // Feedings
  rows.push(sectionHeader("🍼", `Feedings (${feedings.length})`));
  if (feedings.length > 0) {
    let totalMins: number | null = null;
    for (const f of feedings) {
      const dur = durationMins(f.start_time, f.end_time);
      if (dur != null) {
        totalMins = (totalMins ?? 0) + dur;
      }
    }
    const typeCounts = feedings.reduce<Record<string, number>>((acc, f) => {
      acc[f.type] = (acc[f.type] ?? 0) + 1;
      return acc;
    }, {});
    const typeStr = Object.entries(typeCounts)
      .map(([t, c]) => `${c}× ${t.replace(/_/g, " ")}`)
      .join(", ");
    const totalStr = totalMins != null && totalMins > 0 ? fmtDuration(totalMins) : "—";
    rows.push(row(`<span style="color:#888">${esc(typeStr)} · Total nursing/feed time: ${esc(totalStr)}</span>`));
    for (const f of feedings) {
      const amount = f.amount != null ? ` · ${f.amount} ${esc(f.amount_unit ?? "")}` : "";
      rows.push(row(`${esc(formatTime(f.start_time))} &mdash; ${esc(f.type.replace(/_/g, " "))} · ${esc(fmtDuration(durationMins(f.start_time, f.end_time)))}${amount}`));
    }
  } else {
    rows.push(noData());
  }

  // Diaper changes
  rows.push(sectionHeader("👶", `Diaper Changes (${diapers.length})`));
  if (diapers.length > 0) {
    const typeCounts = diapers.reduce<Record<string, number>>((acc, d) => {
      acc[d.type] = (acc[d.type] ?? 0) + 1;
      return acc;
    }, {});
    const typeStr = Object.entries(typeCounts).map(([t, c]) => `${c}× ${t}`).join(", ");
    rows.push(row(`<span style="color:#888">${esc(typeStr)}</span>`));
    for (const d of diapers) {
      const color = d.color ? ` · ${esc(d.color)}` : "";
      rows.push(row(`${esc(formatTime(d.time))} &mdash; ${esc(d.type)}${color}`));
    }
  } else {
    rows.push(noData());
  }

  // Sleep
  const naps = sleepSessions.filter(s => s.is_nap === 1);
  const nights = sleepSessions.filter(s => s.is_nap === 0);
  const totalSleepMins = sleepSessions.reduce((sum, s) => sum + (durationMins(s.start_time, s.end_time) ?? 0), 0);
  rows.push(sectionHeader("😴", `Sleep (${sleepSessions.length} session${sleepSessions.length !== 1 ? "s" : ""}${totalSleepMins > 0 ? " · " + fmtDuration(totalSleepMins) + " total" : ""})`));
  if (sleepSessions.length > 0) {
    if (naps.length > 0) rows.push(row(`<span style="color:#888">${naps.length} nap${naps.length !== 1 ? "s" : ""}</span>`));
    if (nights.length > 0) rows.push(row(`<span style="color:#888">${nights.length} night sleep session${nights.length !== 1 ? "s" : ""}</span>`));
    for (const s of sleepSessions) {
      const label = s.is_nap ? "nap" : "night";
      const end = s.end_time ? ` → ${esc(formatTime(s.end_time))}` : " (ongoing)";
      rows.push(row(`${esc(formatTime(s.start_time))}${end} &mdash; ${esc(label)} · ${esc(fmtDuration(durationMins(s.start_time, s.end_time)))}`));
    }
  } else {
    rows.push(noData());
  }

  // Tummy time
  const totalTummyMins = tummyTimes.reduce((sum, t) => sum + (durationMins(t.start_time, t.end_time) ?? 0), 0);
  rows.push(sectionHeader("🏋️", `Tummy Time (${tummyTimes.length} session${tummyTimes.length !== 1 ? "s" : ""}${totalTummyMins > 0 ? " · " + fmtDuration(totalTummyMins) + " total" : ""})`));
  if (tummyTimes.length > 0) {
    for (const t of tummyTimes) {
      const milestone = t.milestone ? ` · <em>${esc(t.milestone)}</em>` : "";
      rows.push(row(`${esc(formatTime(t.start_time))} &mdash; ${esc(fmtDuration(durationMins(t.start_time, t.end_time)))}${milestone}`));
    }
  } else {
    rows.push(noData());
  }

  // Pumping
  if (pumping.length > 0) {
    const totalAmount = pumping.reduce((sum, p) => sum + (p.amount ?? 0), 0);
    const unit = pumping.find(p => p.amount_unit)?.amount_unit ?? "";
    const totalStr = totalAmount > 0 ? ` · ${totalAmount.toFixed(1)} ${esc(unit)} total` : "";
    rows.push(sectionHeader("🍶", `Pumping (${pumping.length} session${pumping.length !== 1 ? "s" : ""}${totalStr})`));
    for (const p of pumping) {
      const amount = p.amount != null ? ` · ${p.amount} ${esc(p.amount_unit ?? "")}` : "";
      rows.push(row(`${esc(formatTime(p.start_time))} &mdash; ${esc(fmtDuration(durationMins(p.start_time, p.end_time)))}${amount}`));
    }
  }

  // Temperature
  if (temperatures.length > 0) {
    rows.push(sectionHeader("🌡️", `Temperature (${temperatures.length} reading${temperatures.length !== 1 ? "s" : ""})`));
    for (const t of temperatures) {
      rows.push(row(`${esc(formatTime(t.time))} &mdash; ${t.reading}&deg;${esc(t.reading_unit)}`));
    }
  }

  // Notes
  if (notes.length > 0) {
    rows.push(sectionHeader("📝", `Notes (${notes.length})`));
    for (const n of notes) {
      const title = n.title ? `<strong>${esc(n.title)}</strong> — ` : "";
      rows.push(row(`${esc(formatTime(n.time))} &mdash; ${title}${esc(n.content)}`));
    }
  }

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-radius:8px;overflow:hidden">
      <tr>
        <td style="background:#fce4ec;padding:12px 16px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;font-size:19px;color:#c2185b;font-family:sans-serif">
            ${name}
            <span style="font-size:13px;color:#e91e63;font-weight:normal;margin-left:8px">${age}</span>
          </h2>
        </td>
      </tr>
      <tr>
        <td style="background:#fffbfc;padding:4px 16px 16px;border:1px solid #f8bbd0;border-top:none;border-radius:0 0 8px 8px">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${rows.join("\n")}
          </table>
        </td>
      </tr>
    </table>`;
}

function buildEmailHtml(
  userName: string,
  reportDateLabel: string,
  childSections: string[],
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

          <!-- Header -->
          <tr>
            <td style="background:#c2185b;padding:24px 28px;border-radius:8px 8px 0 0;text-align:center">
              <h1 style="margin:0;font-size:24px;color:#fff;font-family:sans-serif">👶 Baby Tracker</h1>
              <p style="margin:6px 0 0;font-size:14px;color:#f8bbd0">Daily Summary &mdash; ${esc(reportDateLabel)}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#fff;padding:24px 28px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px">
              <p style="margin:0 0 20px;font-size:15px;color:#444">Hi ${esc(userName)}, here&rsquo;s a summary of yesterday&rsquo;s activity.</p>
              ${childSections.join("\n")}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 0;text-align:center">
              <p style="margin:0;font-size:12px;color:#aaa">
                Sent by Baby Tracker &middot; To stop receiving these emails, update your notification settings in the app.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── AWS SES v2 (SigV4) ───────────────────────────────────────────────────────

async function hmacSha256(key: CryptoKey, data: string): Promise<ArrayBuffer> {
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
}

async function importKey(raw: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function signingKey(secretKey: string, date: string, region: string, service: string): Promise<CryptoKey> {
  const kDate = await hmacSha256(await importKey(new TextEncoder().encode(`AWS4${secretKey}`)), date);
  const kRegion = await hmacSha256(await importKey(new Uint8Array(kDate)), region);
  const kService = await hmacSha256(await importKey(new Uint8Array(kRegion)), service);
  const kSigning = await hmacSha256(await importKey(new Uint8Array(kService)), "aws4_request");
  return importKey(new Uint8Array(kSigning));
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return toHex(buf);
}

async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const region = env.AWS_SES_REGION;
  const service = "ses";
  const host = `email.${region}.amazonaws.com`;
  const url = `https://${host}/v2/email/outbound-emails`;

  const payload = JSON.stringify({
    FromEmailAddress: env.REPORT_FROM_EMAIL,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Html: { Data: html, Charset: "UTF-8" } },
      },
    },
  });

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = await sha256Hex(payload);
  const canonicalHeaders =
    `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalRequest = [
    "POST",
    "/v2/email/outbound-emails",
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const key = await signingKey(env.AWS_SES_SECRET_KEY, dateStamp, region, service);
  const signature = toHex(await hmacSha256(key, stringToSign));

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${env.AWS_SES_ACCESS_KEY}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Amz-Date": amzDate,
      Authorization: authHeader,
    },
    body: payload,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SES error ${response.status}: ${body}`);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function computeDailyWindow(now: Date): {
  windowStart: string;
  windowEnd: string;
  reportDateLabel: string;
} {
  // Rolling 24-hour window ending at the moment the cron fires (5:00 AM UTC = midnight ET).
  // This covers exactly "yesterday" in Eastern time regardless of DST.
  const windowEnd = now.toISOString().slice(0, 19) + "Z";
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19) + "Z";

  const reportDateLabel = new Date(now.getTime() - 24 * 60 * 60 * 1000).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return { windowStart, windowEnd, reportDateLabel };
}

export async function sendDailySummary(env: Env): Promise<void> {
  const now = new Date();
  const { windowStart, windowEnd, reportDateLabel } = computeDailyWindow(now);

  // Fetch users who have email reports enabled (default = enabled when no settings row exists)
  const { results: users } = await env.DB.prepare(`
    SELECT u.id, u.email, u.name
    FROM users u
    LEFT JOIN user_settings us ON us.user_id = u.id
    WHERE COALESCE(us.email_reports, 1) = 1
  `).all<UserRow>();

  for (const user of users) {
    try {
      const { results: children } = await env.DB.prepare(`
        SELECT c.id, c.first_name, c.last_name, c.birth_date
        FROM children c
        JOIN user_children uc ON uc.child_id = c.id
        WHERE uc.user_id = ?
        ORDER BY c.first_name
      `).bind(user.id).all<ChildRow>();

      if (children.length === 0) continue;

      const childData = await Promise.all(
        children.map(async (child) => ({
          child,
          data: await fetchChildData(env, child.id, windowStart, windowEnd),
        })),
      );

      // Skip email if there is no activity at all across all children
      const hasActivity = childData.some(({ data }) =>
        data.feedings.length > 0 ||
        data.diapers.length > 0 ||
        data.sleepSessions.length > 0 ||
        data.tummyTimes.length > 0 ||
        data.pumping.length > 0 ||
        data.temperatures.length > 0 ||
        data.notes.length > 0
      );

      if (!hasActivity) {
        console.log(`No activity for ${user.email} on ${reportDateLabel}, skipping email`);
        continue;
      }

      const childSections = childData.map(({ child, data }) =>
        buildChildSection(
          child,
          data.feedings,
          data.diapers,
          data.sleepSessions,
          data.tummyTimes,
          data.pumping,
          data.temperatures,
          data.notes,
        )
      );

      const html = buildEmailHtml(user.name, reportDateLabel, childSections);
      const subject = `Baby Tracker: Daily Summary – ${reportDateLabel}`;

      await sendEmail(env, user.email, subject, html);
      console.log(`Daily summary sent to ${user.email}`);
    } catch (error) {
      console.error(`Failed to send daily summary to ${user.email}:`, error);
    }
  }
}
