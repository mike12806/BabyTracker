// Everything the dashboard's hero card needs to say something warm and true
// about the child right now: how old he is to the day, what time of day it is
// for whoever is holding the phone, and whether today happens to be one of the
// small anniversaries worth marking.
//
// All of it is pure and date-injectable so the tests can stand anywhere in time.

import type { Child } from "../types/models";

/** Calendar-day parse: `birth_date` is a plain date ("2026-04-07"), and
 *  occasionally carries a time part. `new Date("2026-04-07")` is UTC midnight,
 *  which reads as the previous day west of Greenwich and would make the age —
 *  and every anniversary below — a day out. Build local midnight instead. */
export function parseBirthDate(birthDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Whole days between the two calendar days, ignoring clock time and DST. */
export function daysOld(birthDate: string, now: Date): number {
  const birth = parseBirthDate(birthDate);
  if (!birth) return 0;
  const days = Math.round((startOfDay(now).getTime() - birth.getTime()) / 86400000);
  return Math.max(0, days);
}

/** Whole months elapsed, plus the days left over since that monthly turn. */
function monthsAndDays(birth: Date, today: Date): { months: number; days: number } {
  let months =
    (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
  if (today.getDate() < birth.getDate()) months--;
  if (months < 0) return { months: 0, days: 0 };
  // The most recent monthly turn. Months shorter than the birth day-of-month
  // (a 31st birth date in February) clamp to the end of that month, which is
  // the same day `months` was counted to above.
  const turn = new Date(birth.getFullYear(), birth.getMonth() + months, 1);
  const lastDayOfTurnMonth = new Date(turn.getFullYear(), turn.getMonth() + 1, 0).getDate();
  turn.setDate(Math.min(birth.getDate(), lastDayOfTurnMonth));
  const days = Math.max(0, Math.round((today.getTime() - turn.getTime()) / 86400000));
  return { months, days };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The long-form age the hero card leads with — "12 days old", "6 weeks old",
 * "4 months, 12 days old", "1 year, 3 months old". Deliberately wordier than
 * the compact `formatAge` on the children list: this line is the one someone
 * reads on purpose.
 */
export function detailedAge(birthDate: string, now: Date): string {
  const birth = parseBirthDate(birthDate);
  if (!birth) return "";
  const today = startOfDay(now);
  const days = Math.round((today.getTime() - birth.getTime()) / 86400000);
  if (days < 0) return "on the way";
  if (days === 0) return "born today";
  if (days < 14) return `${plural(days, "day")} old`;

  const { months, days: remDays } = monthsAndDays(birth, today);
  if (months < 3) {
    const weeks = Math.floor(days / 7);
    const spareDays = days % 7;
    if (spareDays === 0) return `${plural(weeks, "week")} old`;
    return `${plural(weeks, "week")}, ${plural(spareDays, "day")} old`;
  }
  if (months < 24) {
    if (remDays === 0) return `${plural(months, "month")} old`;
    return `${plural(months, "month")}, ${plural(remDays, "day")} old`;
  }
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (remMonths === 0) return `${plural(years, "year")} old`;
  return `${plural(years, "year")}, ${plural(remMonths, "month")} old`;
}

/**
 * Time-of-day greeting. The small-hours case is the one that matters most —
 * whoever opens this at 3am to log a feed is not having a "good morning", and
 * being met with one is its own tiny insult.
 */
export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Late one tonight";
}

export type Milestone = { label: string; emoji: string };

/**
 * Today's anniversary, if today is one. Kept rare on purpose: a badge that
 * shows up most days stops meaning anything. Highest occasion wins.
 */
export function milestone(birthDate: string, now: Date): Milestone | null {
  const birth = parseBirthDate(birthDate);
  if (!birth) return null;
  const today = startOfDay(now);
  const days = Math.round((today.getTime() - birth.getTime()) / 86400000);
  if (days < 0) return null;
  if (days === 0) return { label: "Welcome to the world", emoji: "🌟" };

  const { months, days: remDays } = monthsAndDays(birth, today);
  const onTheDay = remDays === 0;

  if (onTheDay && months >= 12 && months % 12 === 0) {
    const years = months / 12;
    return { label: `${plural(years, "year")} old today`, emoji: "🎂" };
  }
  if (onTheDay && months >= 1 && months < 24) {
    return { label: `${plural(months, "month")} old today`, emoji: "🎉" };
  }
  // Round day counts, for the stretch between monthly turns.
  if (days === 100 || days === 500 || days === 1000) {
    return { label: `${days} days old today`, emoji: "💯" };
  }
  // Weekly turns, but only through the newborn stretch where a week is still
  // the unit everybody is counting in.
  if (days > 0 && days % 7 === 0 && days <= 56) {
    return { label: `${plural(days / 7, "week")} old today`, emoji: "🌱" };
  }
  return null;
}

/** New lines a low-frequency server cron writes into the boop_lines table
 *  (see server/src/scheduled/boopLines.ts) so the joke doesn't go stale after
 *  the thousandth tap. Optional everywhere: an empty or missing pool just
 *  means `boopMessage` cycles through the built-ins below on their own. */
export interface BoopLinePool {
  day: string[];
  night: string[];
}

/**
 * The lines that cycle when the photo gets tapped. Ordinary, small, and true
 * to the hour — the joke is that the app has an opinion at all.
 *
 * These built-ins are the permanent fallback and always come first, so the
 * feature works identically with no server pool at all (offline, a fresh
 * deploy before the first cron run). Any AI-written lines for the current
 * mood are appended after them.
 */
export function boopMessage(firstName: string, tapCount: number, now: Date, extra?: BoopLinePool): string {
  const hour = now.getHours();
  const nocturnal = hour < 5 || hour >= 22;
  const lines = nocturnal
    ? [
        "Boop.",
        `${firstName} says go back to sleep.`,
        "Shh. We're both tired.",
        "That's a 3am boop.",
        "Still the cutest at this hour.",
        ...(extra?.night ?? []),
      ]
    : [
        "Boop.",
        `${firstName} approves.`,
        "Squish.",
        "Certified good baby.",
        `Somebody loves ${firstName}.`,
        "Boop received.",
        ...(extra?.day ?? []),
      ];
  return lines[tapCount % lines.length];
}

/** The photo endpoint for a child, cache-busted on `updated_at` so a new
 *  upload replaces the old image everywhere. `null` when there is no photo. */
export function childPhotoUrl(child: Child, apiBase: string): string | null {
  if (!child.picture_content_type) return null;
  return `${apiBase}/children/${child.id}/photo?v=${encodeURIComponent(child.updated_at)}`;
}
