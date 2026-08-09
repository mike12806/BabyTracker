/**
 * Feeding and pumping amounts are stored as a number plus the unit that was
 * picked when the entry was logged, so the database can hold a mix of ml, cc
 * and oz for the same day.
 *
 * Display does not follow the stored unit. Every volume the app shows — a log
 * row, a stat card, a chart axis, a tooltip — is converted into the one unit
 * the user picked in their settings, so no two numbers on screen are ever in
 * different units. Grams are a mass, not a volume: they are never converted
 * and never folded into a volume total.
 */

/** The units a volume can be displayed in. */
export const VOLUME_UNITS = ["ml", "oz", "cc"] as const;

export type VolumeUnit = (typeof VOLUME_UNITS)[number];

/** Millilitres are the fallback whenever no preference has loaded yet. */
export const DEFAULT_VOLUME_UNIT: VolumeUnit = "ml";

/** Volume units, expressed as the millilitres in one of them. */
const ML_PER_UNIT: Record<string, number> = {
  ml: 1,
  cc: 1,
  oz: 29.5735,
};

/** The shape both feedings and pumping sessions share. */
export interface AmountEntry {
  amount: number | null;
  amount_unit: string | null;
}

export interface AmountTotal {
  value: number;
  /** The display unit for a volume, or "g" for a mass. */
  unit: string;
}

export function isVolumeUnit(unit: string | null | undefined): unit is VolumeUnit {
  return unit != null && unit in ML_PER_UNIT;
}

export function asVolumeUnit(unit: string | null | undefined): VolumeUnit {
  return isVolumeUnit(unit) ? unit : DEFAULT_VOLUME_UNIT;
}

/** Millilitres are the one unit written with a capital L. */
export function unitLabel(unit: string): string {
  return unit === "ml" ? "mL" : unit;
}

/**
 * Restate a volume in another volume unit. Returns null when either side is
 * not a volume, so callers cannot silently mix a mass into a volume total.
 */
export function convertVolume(value: number, from: string, to: string): number | null {
  const fromMl = ML_PER_UNIT[from];
  const toMl = ML_PER_UNIT[to];
  if (fromMl == null || toMl == null) return null;
  return (value * fromMl) / toMl;
}

/**
 * Round for display. Millilitres and cc are counted whole — a syringe is not
 * marked in tenths, and converting from ounces would otherwise invent
 * precision the entry never had. Ounces keep one decimal, where tenths are
 * how bottles are actually read.
 */
export function roundForUnit(value: number, unit: string): number {
  if (unit === "oz") return Math.round(value * 10) / 10;
  return Math.round(value);
}

/**
 * An entry's amount restated in `display`. Volumes convert; grams stay grams;
 * an amount saved with no unit at all is read as already being in the display
 * unit, since there is nothing to convert from. Returns null when the entry
 * has no amount.
 */
export function displayAmount(entry: AmountEntry, display: VolumeUnit): AmountTotal | null {
  if (entry.amount == null) return null;
  if (entry.amount_unit == null) return { value: roundForUnit(entry.amount, display), unit: display };
  if (!isVolumeUnit(entry.amount_unit)) {
    // A mass (grams). Keep it as logged.
    return { value: Math.round(entry.amount * 10) / 10, unit: entry.amount_unit };
  }
  const converted = convertVolume(entry.amount, entry.amount_unit, display) as number;
  return { value: roundForUnit(converted, display), unit: display };
}

/** "55 mL", "1.5 oz", "100 g". */
export function formatAmountTotal(total: AmountTotal): string {
  return `${total.value} ${unitLabel(total.unit)}`;
}

/**
 * An entry's amount, ready to print — or null when it has none.
 * `formatEntryAmount(f, "ml")` on a bottle logged as 1.5 oz gives "44 mL".
 */
export function formatEntryAmount(entry: AmountEntry, display: VolumeUnit): string | null {
  const amount = displayAmount(entry, display);
  return amount && formatAmountTotal(amount);
}

/**
 * Total the amounts recorded across `entries`, in the display unit.
 *
 * Every volume counts, whatever unit it was logged in, and the total comes
 * back in `display`. Grams cannot be folded into a volume, so they come back
 * as a second total. The volume total is first; the array is empty when
 * nothing had an amount.
 */
export function amountTotals(entries: AmountEntry[], display: VolumeUnit): AmountTotal[] {
  let volume = 0;
  let volumeCount = 0;
  let grams = 0;
  let gramCount = 0;

  for (const e of entries) {
    if (e.amount == null) continue;
    if (e.amount_unit != null && !isVolumeUnit(e.amount_unit)) {
      grams += e.amount;
      gramCount++;
      continue;
    }
    // No unit at all: taken to be in the display unit, the only reading left.
    volume += e.amount_unit == null ? e.amount : (convertVolume(e.amount, e.amount_unit, display) as number);
    volumeCount++;
  }

  const totals: AmountTotal[] = [];
  if (volumeCount > 0) totals.push({ value: roundForUnit(volume, display), unit: display });
  if (gramCount > 0) totals.push({ value: Math.round(grams * 10) / 10, unit: "g" });
  return totals;
}

/**
 * The unit to *store* a pumping session in. Pumping amounts only accept ml or
 * oz, so a user displaying cc logs in millilitres — the same volume under a
 * different name.
 */
export function pumpingLogUnit(display: VolumeUnit): "ml" | "oz" {
  return display === "oz" ? "oz" : "ml";
}

/**
 * The volume total on its own, in the display unit — for the places that plot
 * or average a number rather than print one. Null when nothing was measured by
 * volume.
 */
export function volumeTotal(entries: AmountEntry[], display: VolumeUnit): number | null {
  const total = amountTotals(entries, display).find((t) => t.unit !== "g");
  return total ? total.value : null;
}
