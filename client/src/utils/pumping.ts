import type { PumpingSide } from "../types/models";

export const PUMPING_SIDES: { value: PumpingSide; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "both", label: "Both" },
];

/** Human label for a stored side, or null when the session predates side tracking. */
export function sideLabel(side: string | null | undefined): string | null {
  return PUMPING_SIDES.find((s) => s.value === side)?.label ?? null;
}
