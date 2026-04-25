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
interface HistoryEntryRow { activity_type: string; event_time: string; detail: string; child_name: string; logged_by: string }

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

// ── Activity history fetching ─────────────────────────────────────────────────

const childNameExpr = `TRIM(c.first_name || CASE WHEN c.last_name != '' THEN ' ' || c.last_name ELSE '' END)`;
const loggedByExpr = `COALESCE(u.name, 'Unknown')`;

async function fetchActivityHistory(
  env: Env,
  userId: number,
  windowStart: string,
  windowEnd: string,
): Promise<HistoryEntryRow[]> {
  const [feedings, diapers, sleepSessions, tummyTimes, pumping, temperatures, notes, medications] =
    await Promise.all([
      env.DB.prepare(`
        SELECT 'Feeding' AS activity_type, f.start_time AS event_time,
          REPLACE(f.type, '_', ' ') AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM feedings f
        JOIN children c ON c.id = f.child_id
        LEFT JOIN users u ON u.id = f.created_by_user_id
        JOIN user_children uc ON uc.child_id = f.child_id
        WHERE uc.user_id = ? AND f.created_at >= ? AND f.created_at < ?
      `).bind(userId, windowStart, windowEnd).all<HistoryEntryRow>(),
      env.DB.prepare(`
        SELECT 'Diaper Change' AS activity_type, d.time AS event_time,
          d.type || CASE WHEN d.color IS NOT NULL AND d.color != '' THEN ' (' || d.color || ')' ELSE '' END AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM diaper_changes d
        JOIN children c ON c.id = d.child_id
        LEFT JOIN users u ON u.id = d.created_by_user_id
        JOIN user_children uc ON uc.child_id = d.child_id
        WHERE uc.user_id = ? AND d.created_at >= ? AND d.created_at < ?
      `).bind(userId, windowStart, windowEnd).all<HistoryEntryRow>(),
      env.DB.prepare(`
        SELECT 'Sleep' AS activity_type, s.start_time AS event_time,
          CASE WHEN s.is_nap = 1 THEN 'nap' ELSE 'night sleep' END AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM sleep s
        JOIN children c ON c.id = s.child_id
        LEFT JOIN users u ON u.id = s.created_by_user_id
        JOIN user_children uc ON uc.child_id = s.child_id
        WHERE uc.user_id = ? AND s.created_at >= ? AND s.created_at < ?
      `).bind(userId, windowStart, windowEnd).all<HistoryEntryRow>(),
      env.DB.prepare(`
        SELECT 'Tummy Time' AS activity_type, t.start_time AS event_time,
          CASE WHEN t.milestone IS NOT NULL THEN 'tummy time — ' || t.milestone ELSE 'tummy time' END AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM tummy_time t
        JOIN children c ON c.id = t.child_id
        LEFT JOIN users u ON u.id = t.created_by_user_id
        JOIN user_children uc ON uc.child_id = t.child_id
        WHERE uc.user_id = ? AND t.created_at >= ? AND t.created_at < ?
      `).bind(userId, windowStart, windowEnd).all<HistoryEntryRow>(),
      env.DB.prepare(`
        SELECT 'Pumping' AS activity_type, p.start_time AS event_time,
          CASE WHEN p.amount IS NOT NULL THEN 'pumped ' || p.amount || ' ' || COALESCE(p.amount_unit, '') ELSE 'pumping' END AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM pumping p
        JOIN children c ON c.id = p.child_id
        LEFT JOIN users u ON u.id = p.created_by_user_id
        JOIN user_children uc ON uc.child_id = p.child_id
        WHERE uc.user_id = ? AND p.created_at >= ? AND p.created_at < ?
      `).bind(userId, windowStart, windowEnd).all<HistoryEntryRow>(),
      env.DB.prepare(`
        SELECT 'Temperature' AS activity_type, t.time AS event_time,
          t.reading || '°' || t.reading_unit AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM temperature t
        JOIN children c ON c.id = t.child_id
        LEFT JOIN users u ON u.id = t.created_by_user_id
        JOIN user_children uc ON uc.child_id = t.child_id
        WHERE uc.user_id = ? AND t.created_at >= ? AND t.created_at < ?
      `).bind(userId, windowStart, windowEnd).all<HistoryEntryRow>(),
      env.DB.prepare(`
        SELECT 'Note' AS activity_type, n.time AS event_time,
          COALESCE(n.title, SUBSTR(n.content, 1, 60)) AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM notes n
        JOIN children c ON c.id = n.child_id
        LEFT JOIN users u ON u.id = n.created_by_user_id
        JOIN user_children uc ON uc.child_id = n.child_id
        WHERE uc.user_id = ? AND n.created_at >= ? AND n.created_at < ?
      `).bind(userId, windowStart, windowEnd).all<HistoryEntryRow>(),
      env.DB.prepare(`
        SELECT 'Medication' AS activity_type, m.time AS event_time,
          m.name || CASE WHEN m.dosage IS NOT NULL THEN ' ' || m.dosage || COALESCE(' ' || m.dosage_unit, '') ELSE '' END AS detail,
          ${childNameExpr} AS child_name, ${loggedByExpr} AS logged_by
        FROM medications m
        JOIN children c ON c.id = m.child_id
        LEFT JOIN users u ON u.id = m.created_by_user_id
        JOIN user_children uc ON uc.child_id = m.child_id
        WHERE uc.user_id = ? AND m.created_at >= ? AND m.created_at < ?
      `).bind(userId, windowStart, windowEnd).all<HistoryEntryRow>(),
    ]);

  const all: HistoryEntryRow[] = [
    ...feedings.results,
    ...diapers.results,
    ...sleepSessions.results,
    ...tummyTimes.results,
    ...pumping.results,
    ...temperatures.results,
    ...notes.results,
    ...medications.results,
  ];

  return all.sort((a, b) => a.event_time.localeCompare(b.event_time));
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
        <td style="background:#e3f2fd;padding:12px 16px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;font-size:19px;color:#1565c0;font-family:sans-serif">
            ${name}
            <span style="font-size:13px;color:#1976d2;font-weight:normal;margin-left:8px">${age}</span>
          </h2>
        </td>
      </tr>
      <tr>
        <td style="background:#f8fbff;padding:4px 16px 16px;border:1px solid #bbdefb;border-top:none;border-radius:0 0 8px 8px">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${rows.join("\n")}
          </table>
        </td>
      </tr>
    </table>`;
}

function buildHistorySection(entries: HistoryEntryRow[]): string {
  if (entries.length === 0) return "";

  const headerCell = (text: string) =>
    `<th style="padding:6px 8px;font-size:12px;color:#fff;background:#388e3c;text-align:left;white-space:nowrap">${text}</th>`;

  const dataCell = (text: string, muted = false) =>
    `<td style="padding:5px 8px;font-size:12px;color:${muted ? "#888" : "#444"};border-bottom:1px solid #e8f5e9;vertical-align:top">${text}</td>`;

  const tableRows = entries.map((e, i) => {
    const bg = i % 2 === 0 ? "#f9fef9" : "#ffffff";
    return `<tr style="background:${bg}">
      ${dataCell(esc(formatTime(e.event_time)))}
      ${dataCell(esc(e.child_name))}
      ${dataCell(esc(e.activity_type))}
      ${dataCell(esc(e.detail))}
      ${dataCell(esc(e.logged_by), true)}
    </tr>`;
  });

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-radius:8px;overflow:hidden">
      <tr>
        <td style="background:#2e7d32;padding:12px 16px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;font-size:19px;color:#fff;font-family:sans-serif">📋 Change History</h2>
          <p style="margin:4px 0 0;font-size:12px;color:#c8e6c9">All entries logged yesterday &mdash; with who recorded them</p>
        </td>
      </tr>
      <tr>
        <td style="background:#f9fef9;padding:0;border:1px solid #c8e6c9;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              ${headerCell("Time")}
              ${headerCell("Child")}
              ${headerCell("Activity")}
              ${headerCell("Details")}
              ${headerCell("Logged by")}
            </tr>
            ${tableRows.join("\n")}
          </table>
        </td>
      </tr>
    </table>`;
}

function buildEmailHtml(
  userName: string,
  reportDateLabel: string,
  childSections: string[],
  historySection: string,
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
            <td style="background:#1565c0;padding:24px 28px;border-radius:8px 8px 0 0;text-align:center">
              <h1 style="margin:0;font-size:24px;color:#fff;font-family:sans-serif">👶 Baby Tracker</h1>
              <p style="margin:6px 0 0;font-size:14px;color:#bbdefb">Daily Summary &mdash; ${esc(reportDateLabel)}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#fff;padding:24px 28px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px">
              <p style="margin:0 0 20px;font-size:15px;color:#444">Hi ${esc(userName)}, here&rsquo;s a summary of yesterday&rsquo;s activity.</p>
              ${childSections.join("\n")}
              ${historySection}
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
  const region = env.AWS_SES_REGION ?? (() => { throw new Error("AWS_SES_REGION is not set") })();
  const accessKey = env.AWS_SES_ACCESS_KEY ?? (() => { throw new Error("AWS_SES_ACCESS_KEY is not set") })();
  const secretKey = env.AWS_SES_SECRET_KEY ?? (() => { throw new Error("AWS_SES_SECRET_KEY is not set") })();
  const fromEmail = env.REPORT_FROM_EMAIL ?? (() => { throw new Error("REPORT_FROM_EMAIL is not set") })();

  const service = "ses";
  const host = `email.${region}.amazonaws.com`;
  const url = `https://${host}/v2/email/outbound-emails`;

  const payload = JSON.stringify({
    FromEmailAddress: fromEmail,
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

  const key = await signingKey(secretKey, dateStamp, region, service);
  const signature = toHex(await hmacSha256(key, stringToSign));

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
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

/** Returns the `YYYY-MM-DD` calendar-date string in America/New_York for a given UTC instant. */
function toEtDateStr(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/**
 * Returns the UTC ISO string (with milliseconds) for midnight 00:00:00.000 at the
 * start of `etDateStr` (a "YYYY-MM-DD" calendar date in America/New_York).
 * Correctly handles both EST (UTC-5) and EDT (UTC-4).
 *
 * Offset 4 (EDT) is tried before 5 (EST) so that on DST fall-back days — where
 * midnight can correspond to both UTC-4 and UTC-5 — the earlier (EDT) midnight
 * is chosen, giving the correct 25-hour day boundary.
 */
function etMidnightToUtc(etDateStr: string): string {
  for (const offsetHrs of [4, 5]) {
    const candidate = new Date(`${etDateStr}T${String(offsetHrs).padStart(2, "0")}:00:00.000Z`);
    if (toEtDateStr(candidate) === etDateStr) {
      const etHour = parseInt(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          hour12: false,
        }).format(candidate),
        10,
      );
      // hour12:false returns "00" for midnight in V8; guard against "24" which
      // some Intl implementations emit for the very start of a new day.
      if (etHour === 0 || etHour === 24) return candidate.toISOString();
    }
  }
  // Fallback — ET is always UTC-4 or UTC-5
  return `${etDateStr}T05:00:00.000Z`;
}

export function computeDailyWindow(now: Date): {
  windowStart: string;
  windowEnd: string;
  reportDateLabel: string;
} {
  // Compute exact ET calendar-day boundaries for yesterday. Using explicit ET midnight
  // instants (rather than a fixed 24h offset) handles DST transitions correctly:
  // spring-forward days are 23h, fall-back days are 25h.
  const todayEt = toEtDateStr(now);
  const windowEnd = etMidnightToUtc(todayEt);

  // Go 12 hours before today's ET midnight to safely land in "yesterday" regardless of DST
  const midYesterday = new Date(new Date(windowEnd).getTime() - 12 * 60 * 60 * 1000);
  const yesterdayEt = toEtDateStr(midYesterday);
  const windowStart = etMidnightToUtc(yesterdayEt);

  const reportDateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(windowStart));

  return { windowStart, windowEnd, reportDateLabel };
}

export async function sendDailySummary(env: Env): Promise<void> {
  const now = new Date();
  const { windowStart, windowEnd, reportDateLabel } = computeDailyWindow(now);

  // Fetch all users — every user receives the daily summary
  const { results: users } = await env.DB.prepare(
    "SELECT id, email, name FROM users"
  ).all<UserRow>();

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

      const historyEntries = await fetchActivityHistory(env, user.id, windowStart, windowEnd);
      const historySection = buildHistorySection(historyEntries);

      const html = buildEmailHtml(user.name, reportDateLabel, childSections, historySection);
      const subject = `Baby Tracker: Daily Summary – ${reportDateLabel}`;

      await sendEmail(env, user.email, subject, html);
      console.log(`Daily summary sent to ${user.email}`);
    } catch (error) {
      console.error(`Failed to send daily summary to ${user.email}:`, error);
    }
  }
}
