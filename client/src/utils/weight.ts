/**
 * Weight is stored as a single decimal number plus a unit. Pounds are entered
 * and displayed as a pounds + ounces pair, so these helpers convert between the
 * two representations.
 */

export const OUNCES_PER_POUND = 16;

/** Round away binary floating point noise introduced by the oz -> lb division. */
function roundPounds(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Combine pounds and ounces text inputs into the decimal pounds value we
 * persist. Returns null when both fields are blank or unparseable.
 */
export function lbOzToPounds(lb: string, oz: string): number | null {
  const lbValue = lb.trim() === "" ? null : parseFloat(lb);
  const ozValue = oz.trim() === "" ? null : parseFloat(oz);
  const lbPart = lbValue != null && Number.isFinite(lbValue) ? lbValue : null;
  const ozPart = ozValue != null && Number.isFinite(ozValue) ? ozValue : null;
  if (lbPart == null && ozPart == null) return null;
  return roundPounds((lbPart ?? 0) + (ozPart ?? 0) / OUNCES_PER_POUND);
}

/** Split decimal pounds into whole pounds and remaining ounces for editing. */
export function poundsToLbOz(value: number): { lb: number; oz: number } {
  const negative = value < 0;
  const abs = Math.abs(value);
  let lb = Math.floor(abs);
  // Ounces keep one decimal so half-ounce scales survive a round trip.
  let oz = Math.round((abs - lb) * OUNCES_PER_POUND * 10) / 10;
  if (oz >= OUNCES_PER_POUND) {
    lb += 1;
    oz = 0;
  }
  return negative ? { lb: -lb, oz } : { lb, oz };
}

/** Human weight label: "7 lb 4 oz" for pounds, "3.4 kg" for everything else. */
export function formatWeight(value: number | null | undefined, unit: string | null | undefined): string {
  if (value == null) return "";
  if (unit !== "lb") return `${value} ${unit ?? ""}`.trim();
  const { lb, oz } = poundsToLbOz(value);
  if (oz === 0) return `${lb} lb`;
  if (lb === 0) return `${oz} oz`;
  return `${lb} lb ${oz} oz`;
}
