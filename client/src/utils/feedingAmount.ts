/**
 * Feeding and pumping amounts are stored as a number plus the unit that was
 * picked when the entry was logged, so a single day can mix units. These
 * helpers total those amounts, normalizing to millilitres whenever more than
 * one volume unit shows up.
 */

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
  /** null when the entries carried no unit at all. */
  unit: string | null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Total the amounts recorded across `entries`.
 *
 * Volumes (ml/cc/oz) collapse into one total: it keeps its own unit when every
 * entry used the same one, and normalizes to millilitres when they differ.
 * Grams measure a mass rather than a volume, so they cannot be folded in and
 * come back as a second total.
 *
 * Returns the volume total first, then any gram total. The array is empty when
 * nothing had an amount.
 */
export function amountTotals(entries: AmountEntry[]): AmountTotal[] {
  const withAmount = entries.filter((e): e is AmountEntry & { amount: number } => e.amount != null);
  if (withAmount.length === 0) return [];

  // Amounts saved without a unit are counted against the unit the rest of the
  // entries mostly used — that is the only unit they could plausibly be in.
  const unitCounts = new Map<string, number>();
  for (const e of withAmount) {
    if (e.amount_unit) unitCounts.set(e.amount_unit, (unitCounts.get(e.amount_unit) ?? 0) + 1);
  }
  let dominantUnit: string | null = null;
  let dominantCount = 0;
  for (const [unit, count] of unitCounts) {
    if (count > dominantCount) {
      dominantUnit = unit;
      dominantCount = count;
    }
  }

  const volumeUnits = new Set<string>();
  let volumeNative = 0;
  let volumeMl = 0;
  let volumeCount = 0;
  let grams = 0;
  let gramCount = 0;

  for (const e of withAmount) {
    const unit = e.amount_unit ?? dominantUnit;
    const mlPerUnit = unit == null ? null : ML_PER_UNIT[unit];
    if (unit != null && mlPerUnit == null) {
      grams += e.amount;
      gramCount++;
      continue;
    }
    if (unit != null) volumeUnits.add(unit);
    volumeNative += e.amount;
    volumeMl += e.amount * (mlPerUnit ?? 1);
    volumeCount++;
  }

  const totals: AmountTotal[] = [];
  if (volumeCount > 0) {
    totals.push(
      volumeUnits.size > 1
        ? // Whole millilitres: the conversion invents precision the entries
          // never had, so a decimal here would be noise.
          { value: Math.round(volumeMl), unit: "ml" }
        : { value: round1(volumeNative), unit: volumeUnits.values().next().value ?? null },
    );
  }
  if (gramCount > 0) totals.push({ value: round1(grams), unit: "g" });
  return totals;
}

/** "118 mL", "4 oz", "100 g", or a bare number for unit-less amounts. */
export function formatAmountTotal(total: AmountTotal): string {
  if (total.unit == null) return `${total.value}`;
  // Millilitres are the one unit written with a capital L.
  return `${total.value} ${total.unit === "ml" ? "mL" : total.unit}`;
}
