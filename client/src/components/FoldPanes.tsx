import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { Box, type SxProps, type Theme } from "@mui/material";
import { useFold } from "../hooks/useFold";

interface FoldPanesContextValue {
  /** Tells Layout this page fills both panes itself. Returns the release. */
  claim: () => () => void;
  /**
   * The pane right of the fold. Provided by Layout, because where it sits
   * depends on the app bar's height.
   */
  endPaneSx: SxProps<Theme>;
}

export const FoldPanesContext = createContext<FoldPanesContextValue>({
  claim: () => () => {},
  endPaneSx: {},
});

/**
 * A page with something to put on each side of an open foldable. On one
 * screen it is `start` followed by `end`, exactly as the page was before;
 * open, `start` goes left of the fold, `end` right of it, and Layout leaves
 * out the log panel it would otherwise show there.
 *
 * The element tree is the same in both cases and only the styles differ, so
 * opening or closing the phone never remounts either half — a dialog left
 * open inside one stays open.
 */
export default function FoldPanes({ start, end }: { start: ReactNode; end: ReactNode }) {
  const fold = useFold();
  const { claim, endPaneSx } = useContext(FoldPanesContext);
  // Layout, not paint: Layout must give up the right-hand pane before the
  // first frame, or its log panel flashes up under this page's content.
  useLayoutEffect(() => claim(), [claim]);

  const columns = fold.kind === "columns" ? fold : null;
  return (
    <Box
      sx={
        columns
          ? {
              display: "grid",
              gridTemplateColumns: `${columns.start}px ${columns.hinge}px ${columns.end}px`,
              alignItems: "start",
            }
          : undefined
      }
    >
      <Box sx={columns ? { gridColumn: 1, minWidth: 0, px: 1.5 } : undefined}>{start}</Box>
      <Box sx={columns ? endPaneSx : undefined}>{end}</Box>
    </Box>
  );
}
