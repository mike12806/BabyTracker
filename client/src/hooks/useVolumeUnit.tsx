import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { loadUserSettings } from "../api/userSettings";
import { asVolumeUnit, DEFAULT_VOLUME_UNIT, type VolumeUnit } from "../utils/feedingAmount";

/**
 * The unit every volume in the app is shown in.
 *
 * One preference, read by every screen: bottles, pumping sessions, daily
 * totals, chart axes and tooltips all render through it, so a day logged in a
 * mix of cc and oz still reads as one unit wherever it appears. Entries keep
 * the unit they were logged with — this only decides how they are displayed.
 */
interface VolumeUnitContextValue {
  unit: VolumeUnit;
  setUnit: (unit: VolumeUnit) => void;
}

const STORAGE_KEY = "volume-unit";

const VolumeUnitContext = createContext<VolumeUnitContextValue>({
  unit: DEFAULT_VOLUME_UNIT,
  setUnit: () => {},
});

/**
 * Components read this without caring whether the provider is mounted: with no
 * provider they get the default unit, which is what a bare render should show.
 */
export function useVolumeUnit(): VolumeUnitContextValue {
  return useContext(VolumeUnitContext);
}

function storedUnit(): VolumeUnit {
  try {
    return asVolumeUnit(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_VOLUME_UNIT;
  }
}

export function VolumeUnitProvider({ children }: { children: React.ReactNode }) {
  // Start from the last known choice so the first paint is already right, then
  // let the server's copy correct it.
  const [unit, setUnitState] = useState<VolumeUnit>(storedUnit);

  useEffect(() => {
    loadUserSettings().then((s) => {
      if (!s?.volume_unit) return;
      const next = asVolumeUnit(s.volume_unit);
      setUnitState(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch { /* noop */ }
    });
  }, []);

  const setUnit = useCallback((next: VolumeUnit) => {
    setUnitState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch { /* noop */ }
    // Persist to server (fire-and-forget), same as the theme preference.
    api.put("/settings", { volume_unit: next }).catch(() => {});
  }, []);

  const value = useMemo(() => ({ unit, setUnit }), [unit, setUnit]);

  return <VolumeUnitContext.Provider value={value}>{children}</VolumeUnitContext.Provider>;
}
