export type CategoryKey =
  | "feed"
  | "diaper"
  | "sleep"
  | "pump"
  | "tummy"
  | "temp"
  | "med"
  | "note"
  | "growth"
  | "todo";

export interface CategoryColorSet {
  solid: string;
  ink: string;
  soft: string;
  edge: string;
  tile: string;
  name: string;
  hue: number;
}

const CATEGORIES: Record<CategoryKey, { hue: number; name: string }> = {
  feed: { hue: 28, name: "Feeding" },
  diaper: { hue: 75, name: "Diaper" },
  sleep: { hue: 270, name: "Sleep" },
  pump: { hue: 210, name: "Pump" },
  tummy: { hue: 145, name: "Tummy time" },
  temp: { hue: 12, name: "Temp" },
  med: { hue: 320, name: "Meds" },
  note: { hue: 240, name: "Note" },
  growth: { hue: 180, name: "Growth" },
  todo: { hue: 260, name: "To-do" },
};

function catColor(hue: number, dark: boolean) {
  if (dark) {
    return {
      solid: `oklch(0.76 0.16 ${hue})`,
      ink: `oklch(0.88 0.08 ${hue})`,
      soft: `oklch(0.30 0.07 ${hue} / 0.55)`,
      edge: `oklch(0.45 0.10 ${hue} / 0.55)`,
      tile: `oklch(0.32 0.085 ${hue})`,
    };
  }
  return {
    solid: `oklch(0.56 0.16 ${hue})`,
    ink: `oklch(0.40 0.16 ${hue})`,
    soft: `oklch(0.95 0.04 ${hue})`,
    edge: `oklch(0.85 0.06 ${hue})`,
    tile: `oklch(0.95 0.04 ${hue})`,
  };
}

export function buildCategoryColors(
  dark: boolean,
): Record<CategoryKey, CategoryColorSet> {
  return Object.fromEntries(
    Object.entries(CATEGORIES).map(([k, v]) => [
      k,
      { ...v, ...catColor(v.hue, dark) },
    ]),
  ) as Record<CategoryKey, CategoryColorSet>;
}

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];
