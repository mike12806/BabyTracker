import { useState } from "react";
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link,
  List,
  ListItem,
  ListItemText,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import FlagIcon from "@mui/icons-material/Flag";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { detailedAge } from "../utils/childMoments";
import {
  DEVELOPMENTAL_MILESTONES,
  MILESTONE_DOMAINS,
  MILESTONE_DOMAIN_LABELS,
  MILESTONE_SOURCE,
  checkpointItems,
  compactGap,
  daysUntilCheckpoint,
  describeGap,
  focusCheckpoint,
  milestoneOfTheDay,
  type MilestoneDomain,
} from "../utils/milestones";
import type { CategoryColorSet, CategoryKey } from "../theme/categoryColors";
import type { Child } from "../types/models";

/** Each CDC domain borrows a colour from the existing category palette, so the
 *  sheet uses the same colours as the rest of the dashboard. */
const DOMAIN_COLOR: Record<MilestoneDomain, CategoryKey> = {
  social: "feed",
  language: "pump",
  cognitive: "sleep",
  movement: "tummy",
};

interface Props {
  child: Child;
  cat: Record<CategoryKey, CategoryColorSet>;
  isDark: boolean;
  /** Injectable for tests; defaults to the real clock. */
  now?: Date;
}

/**
 * Developmental milestones on the dashboard. The card itself is one row: the
 * checkpoint coming up, one milestone from it (a different one each day), and
 * how far away it is. The full CDC checklist and its sources open in a sheet
 * when tapped. It is kept to one row so it never pushes the logging tiles and
 * today's totals down the page.
 */
export default function MilestonesCard({ child, cat, isDark, now = new Date() }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [open, setOpen] = useState(false);
  const [viewIndex, setViewIndex] = useState(0);

  const focus = focusCheckpoint(child.birth_date, now);
  if (!focus) return null;

  const accent = cat.tummy;
  const preview = milestoneOfTheDay(focus.checkpoint, now);
  const gap = compactGap(focus.daysUntil);

  const viewed = DEVELOPMENTAL_MILESTONES[viewIndex] ?? focus.checkpoint;
  const viewedDays = daysUntilCheckpoint(child.birth_date, viewed, now);
  const previous = DEVELOPMENTAL_MILESTONES[viewIndex - 1];
  const next = DEVELOPMENTAL_MILESTONES[viewIndex + 1];

  const handleOpen = () => {
    // Always open on the checkpoint that fits today, whatever was browsed last time.
    setViewIndex(focus.index);
    setOpen(true);
  };

  return (
    <>
      <ButtonBase
        onClick={handleOpen}
        aria-label={`Milestones by ${focus.checkpoint.label}, ${gap}: ${preview}. Source: CDC. Open the full checklist.`}
        sx={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 1,
          p: "7px 10px",
          mb: 1.5,
          borderRadius: 2,
          bgcolor: "background.paper",
          border: 1,
          borderColor: "divider",
          textAlign: "left",
          "&:focus-visible": { outline: `2px solid ${accent.solid}`, outlineOffset: 2 },
        }}
      >
        <Box
          sx={{
            width: 28, height: 28, borderRadius: "9px",
            bgcolor: accent.soft, color: accent.ink,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}
        >
          <FlagIcon sx={{ fontSize: 15 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{ fontSize: 10, color: accent.ink, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2 }}
            noWrap
          >
            Milestones by {focus.checkpoint.label} · CDC
          </Typography>
          {/* Two lines at most. Cutting a milestone off after a few words on a
              phone left only the start of it, which isn't enough to read. */}
          <Typography
            sx={{
              fontSize: 12.5, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.3,
              display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden",
            }}
          >
            {preview}
          </Typography>
        </Box>
        <Typography
          sx={{ fontSize: 11, color: "text.secondary", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
        >
          {gap}
        </Typography>
        <ChevronRightIcon sx={{ fontSize: 15, color: "text.disabled", flexShrink: 0 }} />
      </ButtonBase>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
        fullScreen={fullScreen}
        aria-labelledby="milestones-title"
      >
        <DialogTitle id="milestones-title" sx={{ pb: 0.5 }}>
          Milestones by {viewed.label}
        </DialogTitle>
        <DialogContent sx={{ pt: 0 }}>
          <Typography sx={{ fontSize: 13.5, color: "text.secondary", lineHeight: 1.4 }}>
            What most children (75% or more) can do by {viewed.label}.
          </Typography>
          {viewedDays !== null && (
            <Typography sx={{ fontSize: 12.5, color: accent.ink, fontWeight: 600, mt: 0.5 }}>
              {child.first_name} is {detailedAge(child.birth_date, now)} · {viewed.label} {viewedDays < 0 ? "was" : "is"} {describeGap(viewedDays)}
            </Typography>
          )}

          <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, mt: 1.25, mb: 0.5 }}>
            <Button
              size="small"
              startIcon={<ChevronLeftIcon />}
              disabled={!previous}
              onClick={() => setViewIndex((i) => i - 1)}
              aria-label={previous ? `Show milestones by ${previous.label}` : "No earlier milestones"}
              sx={{ textTransform: "none", visibility: previous ? "visible" : "hidden" }}
            >
              {previous?.label ?? ""}
            </Button>
            <Button
              size="small"
              endIcon={<ChevronRightIcon />}
              disabled={!next}
              onClick={() => setViewIndex((i) => i + 1)}
              aria-label={next ? `Show milestones by ${next.label}` : "No later milestones"}
              sx={{ textTransform: "none", visibility: next ? "visible" : "hidden" }}
            >
              {next?.label ?? ""}
            </Button>
          </Box>

          {MILESTONE_DOMAINS.map((domain) => {
            const c = cat[DOMAIN_COLOR[domain]];
            return (
              <Box key={domain} sx={{ mt: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: 99, bgcolor: c.solid, flexShrink: 0 }} />
                  <Typography
                    component="h3"
                    sx={{ fontSize: 11, fontWeight: 700, color: c.ink, textTransform: "uppercase", letterSpacing: "0.06em" }}
                  >
                    {MILESTONE_DOMAIN_LABELS[domain]}
                  </Typography>
                </Box>
                <List dense disablePadding sx={{ mt: 0.25 }}>
                  {viewed.items[domain].map((item) => (
                    <ListItem key={item} disableGutters sx={{ py: 0.25, pl: 1.75 }}>
                      <ListItemText
                        primary={item}
                        slotProps={{ primary: { sx: { fontSize: 13.5, lineHeight: 1.35 } } }}
                      />
                    </ListItem>
                  ))}
                </List>
              </Box>
            );
          })}

          <Divider sx={{ my: 1.5 }} />

          <Box
            sx={{
              p: 1.25,
              borderRadius: 1.5,
              bgcolor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.025)",
              display: "flex",
              flexDirection: "column",
              gap: 0.75,
            }}
          >
            <Typography sx={{ fontSize: 12, lineHeight: 1.45 }}>
              <Box component="span" sx={{ fontWeight: 700 }}>Source: </Box>
              <Link href={viewed.sourceUrl} target="_blank" rel="noopener noreferrer">
                CDC, “Milestones by {viewed.label}”
                <OpenInNewIcon sx={{ fontSize: 12, ml: 0.25, verticalAlign: "-1px" }} />
              </Link>
              , part of the “{MILESTONE_SOURCE.program}” program
            </Typography>
            <Typography sx={{ fontSize: 12, lineHeight: 1.45, color: "text.secondary" }}>
              Revised with the American Academy of Pediatrics:{" "}
              <Link href={MILESTONE_SOURCE.paperUrl} target="_blank" rel="noopener noreferrer" color="inherit">
                {MILESTONE_SOURCE.paper}
              </Link>
            </Typography>
            <Typography sx={{ fontSize: 12, lineHeight: 1.45, color: "text.secondary" }}>
              Every child develops at their own pace. Born early? Milestones are usually counted from
              the due date. Ask your child’s doctor which age to use. If {child.first_name} isn’t
              meeting one or more milestones, has lost skills they once had, or you have other
              concerns, the CDC advises acting early: talk with your child’s doctor and ask about
              developmental screening.
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 11, color: "text.disabled", mt: 1 }}>
            {checkpointItems(viewed).length} milestones · wording adapted from the CDC checklist
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
