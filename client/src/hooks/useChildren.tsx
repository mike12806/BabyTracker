import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { api } from "../api/client";
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

    // Auto-select: use default child if set & exists, otherwise first child
    if (data.length > 0 && !selectedChild) {
      const defaultChild = defId ? data.find((c) => c.id === defId) : null;
      setSelectedChild(defaultChild ?? data[0]);
    }
  }, []);

  useEffect(() => {
    refreshChildren()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
