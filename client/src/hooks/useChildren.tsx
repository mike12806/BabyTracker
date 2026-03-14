import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { Child } from "../types/models";

interface ChildContextType {
  children: Child[];
  selectedChild: Child | null;
  selectChild: (child: Child) => void;
  refreshChildren: () => Promise<void>;
  loading: boolean;
}

const ChildContext = createContext<ChildContextType>({
  children: [],
  selectedChild: null,
  selectChild: () => {},
  refreshChildren: async () => {},
  loading: true,
});

export function ChildProvider({ children: reactChildren }: { children: ReactNode }) {
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChild, setSelectedChild] = useState<Child | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshChildren = async () => {
    const data = await api.get<Child[]>("/children");
    setChildren(data);
    if (data.length > 0 && !selectedChild) {
      setSelectedChild(data[0]);
    }
  };

  useEffect(() => {
    refreshChildren()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selectChild = (child: Child) => {
    setSelectedChild(child);
  };

  return (
    <ChildContext.Provider value={{ children, selectedChild, selectChild, refreshChildren, loading }}>
      {reactChildren}
    </ChildContext.Provider>
  );
}

export function useChildren() {
  return useContext(ChildContext);
}
