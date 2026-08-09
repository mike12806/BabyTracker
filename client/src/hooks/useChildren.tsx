import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { api } from "../api/client";
import { useDataRefresh } from "./useDataRefresh";
import type { Child, UserSettings } from "../types/models";

interface ChildContextType {
  children: Child[];
  selectedChild: Child | null;
  selectChild: (child: Child) => void;
  refreshChildren: () => Promise<void>;
  loading: boolean;
  defaultChildId: number | null;
  setDefaultChild: (childId: number | null) => Promise<void>;
}

const ChildContext = createContext<ChildContextType>({
  children: [],
  selectedChild: null,
  selectChild: () => {},
  refreshChildren: async () => {},
  loading: true,
  defaultChildId: null,
  setDefaultChild: async () => {},
});

export function ChildProvider({ children: reactChildren }: { children: ReactNode }) {
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChild, setSelectedChild] = useState<Child | null>(null);
  const [loading, setLoading] = useState(true);
  const [defaultChildId, setDefaultChildId] = useState<number | null>(null);

  const refreshChildren = useCallback(async () => {
    const [data, settings] = await Promise.all([
      api.get<Child[]>("/children"),
      api.get<UserSettings>("/settings").catch(() => null),
    ]);
    setChildren(data);
    const defId = settings?.default_child_id ?? null;
    setDefaultChildId(defId);

    // Reconciled through the updater rather than read from the closure: this
    // now runs on every refresh, and reading a `selectedChild` captured at
    // mount would treat the user as having selected nobody and silently
    // switch them back to the default child.
    setSelectedChild((current) => {
      // Auto-select: use default child if set & exists, otherwise first child
      if (!current) {
        if (data.length === 0) return null;
        const defaultChild = defId ? data.find((c) => c.id === defId) : null;
        return defaultChild ?? data[0];
      }
      // Keep the selection, but swap in the freshly fetched row so a rename or
      // a new photo made on another device shows up here. A child deleted
      // elsewhere falls back to whoever is left.
      const match = data.find((c) => c.id === current.id);
      if (!match) return data[0] ?? null;
      // Identity matters: every page keys its fetch effect on `selectedChild`,
      // so handing back an equal-but-new object on each refresh would make all
      // of them fetch a second time. `updated_at` moves on every write, which
      // is the same signal the avatar URL is cache-busted with.
      return match.updated_at === current.updated_at ? current : match;
    });
  }, []);

  // Refetches on mount and whenever `refreshKey` is bumped, so a child added,
  // renamed or removed on another device reaches the switcher without a
  // reload. `loading` only gates the very first load; setting it false again
  // on later refreshes is a no-op.
  const { refreshKey } = useDataRefresh();
  useEffect(() => {
    refreshChildren()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const selectChild = (child: Child) => {
    setSelectedChild(child);
  };

  const setDefaultChild = async (childId: number | null) => {
    await api.put<UserSettings>("/settings", { default_child_id: childId });
    setDefaultChildId(childId);
  };

  return (
    <ChildContext.Provider value={{ children, selectedChild, selectChild, refreshChildren, loading, defaultChildId, setDefaultChild }}>
      {reactChildren}
    </ChildContext.Provider>
  );
}

export function useChildren() {
  return useContext(ChildContext);
}
