import { useEffect, useRef, useState } from "react";

export const PULL_THRESHOLD = 80; // px of pull needed to trigger refresh
const MAX_PULL = 120; // max visual pull distance in px

interface PullToRefreshState {
  pullDistance: number;
  isRefreshing: boolean;
  threshold: number;
}

export function usePullToRefresh(): PullToRefreshState {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startYRef = useRef(0);
  const activeRef = useRef(false);
  const pullDistanceRef = useRef(0);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      // Don't trigger inside dialogs/modals
      if (typeof target.closest === "function" && target.closest('[role="dialog"]')) return;
      if (window.scrollY === 0) {
        startYRef.current = e.touches[0].clientY;
        activeRef.current = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!activeRef.current) return;
      const delta = e.touches[0].clientY - startYRef.current;
      if (delta > 0 && window.scrollY === 0) {
        e.preventDefault();
        const clamped = Math.min(delta, MAX_PULL);
        pullDistanceRef.current = clamped;
        setPullDistance(clamped);
      } else {
        activeRef.current = false;
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    const onTouchEnd = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      if (pullDistanceRef.current >= PULL_THRESHOLD) {
        setIsRefreshing(true);
        window.location.reload();
      } else {
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  return { pullDistance, isRefreshing, threshold: PULL_THRESHOLD };
}
