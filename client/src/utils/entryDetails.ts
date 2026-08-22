import { formatEntryAmount, type AmountEntry, type VolumeUnit } from "./feedingAmount";

/**
 * The wording an entry's own details are shown with — its type, the amount it
 * recorded, how long it ran.
 *
 * The forms that log an entry and the views that list one both read from here,
 * so a bottle reads "Bottle (Formula)" in the picker, on the feedings page and
 * in the activity feed alike.
 */

export const FEEDING_TYPES = [
  { value: "breast_left", label: "Breast (Left)" },
  { value: "breast_right", label: "Breast (Right)" },
  { value: "both_breasts", label: "Both Breasts" },
  { value: "bottle_breast_milk", label: "Bottle (Breast Milk)" },
  { value: "bottle_formula", label: "Bottle (Formula)" },
  { value: "solid", label: "Solid Food" },
  { value: "fortified_breast_milk", label: "Fortified Breast Milk" },
];

export const DIAPER_TYPES = [
  { value: "wet", label: "Wet" },
  { value: "solid", label: "Solid" },
  { value: "both", label: "Both" },
  { value: "none", label: "None" },
];

/** An unrecognised type still reads as words rather than a database value. */
export function feedingTypeLabel(type: string): string {
  return FEEDING_TYPES.find((t) => t.value === type)?.label ?? type.replace(/_/g, " ");
}

export function diaperTypeLabel(type: string): string {
  return DIAPER_TYPES.find((t) => t.value === type)?.label ?? type;
}

/** "Left breast", "Both breasts", or "" when the side was not recorded. */
export function pumpingSideLabel(side: string | null | undefined): string {
  if (side === "left") return "Left breast";
  if (side === "right") return "Right breast";
  if (side === "both") return "Both breasts";
  return "";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "45m", "1h 20m", "2h" — compact, for a line that also carries other facts. */
export function formatSpan(startIso: string, endIso: string): string | null {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hrs}h` : `${hrs}h ${rem}m`;
}

/**
 * One row of the activity feed, as `/api/activity` returns it. The structured
 * fields are optional: a client can outlive the deploy that added them, and
 * `detail` is what it falls back to.
 */
export interface ActivityFeedEntry {
  activity_type: string;
  event_time: string;
  detail: string;
  end_time?: string | null;
  subtype?: string | null;
  label?: string | null;
  amount?: number | null;
  amount_unit?: string | null;
  color?: string | null;
}

export interface EntryDetails {
  /** What kind of entry it is: "Bottle (Formula)", "Wet · Yellow", "Nap". */
  label: string;
  /** The number it carries or how long it ran: "118 mL", "1h 20m". */
  measure: string | null;
}

function amountEntry(entry: ActivityFeedEntry): AmountEntry {
  return { amount: entry.amount ?? null, amount_unit: entry.amount_unit ?? null };
}

/** How long the entry ran, or null while it is still open. */
function span(entry: ActivityFeedEntry): string | null {
  return entry.end_time ? formatSpan(entry.event_time, entry.end_time) : null;
}

/**
 * Nothing recognisable to show means the entry came from a server that predates
 * the structured fields — the sentence it built is still there.
 */
function orFallback(entry: ActivityFeedEntry, label: string, measure: string | null): EntryDetails {
  if (label || measure) return { label, measure };
  return { label: entry.detail ? capitalize(entry.detail) : "", measure: null };
}

/**
 * The details to print under an activity entry's title.
 *
 * Volumes are restated in `unit` — the one unit the whole app displays — so a
 * bottle logged as 4 oz reads the same here as it does on the feedings page.
 * Doses and temperatures keep the unit they were recorded with: converting a
 * 2.5 mL dose of medicine into ounces would help nobody.
 */
export function entryDetails(entry: ActivityFeedEntry, unit: VolumeUnit): EntryDetails {
  switch (entry.activity_type) {
    case "Feeding": {
      const label = entry.subtype ? feedingTypeLabel(entry.subtype) : "";
      // A breastfeed records no amount, so its length is the fact it has.
      return orFallback(entry, label, formatEntryAmount(amountEntry(entry), unit) ?? span(entry));
    }
    case "Diaper Change": {
      const parts: string[] = [];
      if (entry.subtype) parts.push(diaperTypeLabel(entry.subtype));
      if (entry.color) parts.push(capitalize(entry.color));
      return orFallback(entry, parts.join(" · "), null);
    }
    case "Sleep": {
      const label = entry.subtype === "nap" ? "Nap" : entry.subtype === "night" ? "Night sleep" : "";
      // An unfinished sleep is one the child is still having: say so rather
      // than leaving the row looking like it recorded nothing.
      return orFallback(entry, label, entry.end_time ? span(entry) : label ? "In progress" : null);
    }
    case "Tummy Time":
      return orFallback(entry, entry.label ?? "", span(entry));
    case "Pumping":
      return orFallback(
        entry,
        pumpingSideLabel(entry.subtype),
        formatEntryAmount(amountEntry(entry), unit) ?? span(entry)
      );
    case "Temperature":
      return orFallback(
        entry,
        "",
        entry.amount != null ? `${entry.amount}°${entry.amount_unit ?? ""}` : null
      );
    case "Medication": {
      const dose =
        entry.amount != null
          ? `${entry.amount}${entry.amount_unit ? ` ${entry.amount_unit}` : ""}`
          : null;
      return orFallback(entry, entry.label ?? "", dose);
    }
    case "Note":
      return orFallback(entry, entry.label ?? "", null);
    default:
      return orFallback(entry, "", null);
  }
}
