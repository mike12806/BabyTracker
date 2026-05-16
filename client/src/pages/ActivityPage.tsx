import { useEffect, useState, useCallback, useMemo } from "react";
import { Box, Stack, Typography, useTheme } from "@mui/material";
import RestaurantIcon from "@mui/icons-material/Restaurant";
import BabyChangingStationIcon from "@mui/icons-material/BabyChangingStation";
import BedtimeIcon from "@mui/icons-material/Bedtime";
import AccessibilityNewIcon from "@mui/icons-material/AccessibilityNew";
import OpacityIcon from "@mui/icons-material/Opacity";
import ThermostatIcon from "@mui/icons-material/Thermostat";
import NoteIcon from "@mui/icons-material/Note";
import MedicationIcon from "@mui/icons-material/Medication";
import HistoryIcon from "@mui/icons-material/History";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import Button from "@mui/material/Button";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import {
  buildCategoryColors,
  type CategoryKey,
  type CategoryColorSet,
} from "../theme/categoryColors";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ActivityEntry {
  activity_type: string;
  event_time: string;
  detail: string;
  child_name: string;
  logged_by: string;
}

interface ActivityResponse {
  total: number;
  offset: number;
  limit: number;
  results: ActivityEntry[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 50;

const DAY_ABBRS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Map activity_type strings coming from the API to CategoryKeys. */
const ACTIVITY_TO_CAT: Record<string, CategoryKey> = {
  Feeding: "feed",
  "Diaper Change": "diaper",
  Sleep: "sleep",
  Pumping: "pump",
  "Tummy Time": "tummy",
  Temperature: "temp",
  Medication: "med",
  Note: "note",
};

/** Filter pill definitions. */
const FILTER_PILLS: { label: string; cat: CategoryKey | null }[] = [
  { label: "All", cat: null },
  { label: "Feeds", cat: "feed" },
  { label: "Diapers", cat: "diaper" },
  { label: "Sleep", cat: "sleep" },
  { label: "Pump", cat: "pump" },
];

/* ------------------------------------------------------------------ */
/*  Icon mapping                                                       */
/* ------------------------------------------------------------------ */

function typeIcon(activityType: string): React.ReactElement {
  switch (activityType) {
    case "Feeding":
      return <RestaurantIcon fontSize="small" />;
    case "Diaper Change":
      return <BabyChangingStationIcon fontSize="small" />;
    case "Sleep":
      return <BedtimeIcon fontSize="small" />;
    case "Tummy Time":
      return <AccessibilityNewIcon fontSize="small" />;
    case "Pumping":
      return <OpacityIcon fontSize="small" />;
    case "Temperature":
      return <ThermostatIcon fontSize="small" />;
    case "Note":
      return <NoteIcon fontSize="small" />;
    case "Medication":
      return <MedicationIcon fontSize="small" />;
    default:
      return <HistoryIcon fontSize="small" />;
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Build a 7-day strip centred on `anchor`. */
function buildWeekDates(anchor: Date): Date[] {
  const startOfWeek = new Date(anchor);
  startOfWeek.setDate(anchor.getDate() - anchor.getDay()); // Sunday
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    days.push(d);
  }
  return days;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Group entries by period of day. */
function periodLabel(iso: string, today: Date): string {
  const d = new Date(iso);
  if (!isSameDay(d, today)) {
    // Older date — use the date itself
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }
  const h = d.getHours();
  if (h >= 17) return "This evening";
  if (h >= 12) return "This afternoon";
  if (h >= 5) return "This morning";
  return "Earlier today";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ActivityPage() {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);

  const { selectedChild } = useChildren();
  const { notify } = useNotification();

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [activeFilter, setActiveFilter] = useState<CategoryKey | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  const weekDates = useMemo(() => buildWeekDates(selectedDate), [selectedDate]);
  const today = useMemo(() => new Date(), []);

  /* ---- Data loading ---- */

  const load = useCallback(
    async (childId: number, off: number) => {
      try {
        const params = new URLSearchParams({
          child_id: String(childId),
          limit: String(PAGE_SIZE),
          offset: String(off),
        });
        // Scope to selected date
        const dayStart = new Date(selectedDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(selectedDate);
        dayEnd.setHours(23, 59, 59, 999);
        params.set("date_from", dayStart.toISOString());
        params.set("date_to", dayEnd.toISOString());

        const data = await api.get<ActivityResponse>(`/activity?${params}`);
        setEntries(data.results);
        setTotal(data.total);
      } catch (err) {
        notify(
          err instanceof Error ? err.message : "Failed to load activity.",
          "error",
        );
      }
    },
    [selectedDate, notify],
  );

  useEffect(() => {
    if (!selectedChild) return;
    setOffset(0);
    load(selectedChild.id, 0);
  }, [selectedChild, load]);

  const handlePageChange = (newOffset: number) => {
    if (!selectedChild) return;
    setOffset(newOffset);
    load(selectedChild.id, newOffset);
  };

  /* ---- Filtering ---- */

  const filteredEntries = useMemo(() => {
    if (!activeFilter) return entries;
    return entries.filter(
      (e) => ACTIVITY_TO_CAT[e.activity_type] === activeFilter,
    );
  }, [entries, activeFilter]);

  /* ---- Grouping by period of day ---- */

  const grouped = useMemo(() => {
    const groups: { label: string; items: ActivityEntry[] }[] = [];
    for (const entry of filteredEntries) {
      const lbl = periodLabel(entry.event_time, today);
      const last = groups[groups.length - 1];
      if (last && last.label === lbl) {
        last.items.push(entry);
      } else {
        groups.push({ label: lbl, items: [entry] });
      }
    }
    return groups;
  }, [filteredEntries, today]);

  /* ---- Pagination ---- */

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  /* ---- Guard ---- */

  if (!selectedChild) return <NoChildPlaceholder />;

  /* ---- Resolve colors for an entry ---- */

  function catColors(
    activityType: string,
  ): CategoryColorSet & { key: CategoryKey } {
    const key = ACTIVITY_TO_CAT[activityType] ?? "note";
    return { ...cat[key], key };
  }

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <Box sx={{ maxWidth: { xs: "100%", md: 700 }, mx: "auto", pb: 4 }}>
      {/* ── Header ── */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Typography variant="h4">Activity</Typography>
        <Typography variant="body2" color="text.secondary">
          {total} {total === 1 ? "entry" : "entries"}
        </Typography>
      </Box>

      {/* ── Filter pills ── */}
      <Box
        sx={{
          display: "flex",
          gap: 1,
          overflowX: "auto",
          pb: 1,
          mb: 2,
          "&::-webkit-scrollbar": { display: "none" },
          scrollbarWidth: "none",
        }}
      >
        {FILTER_PILLS.map(({ label, cat: filterCat }) => {
          const isActive = activeFilter === filterCat;
          const dotColor = filterCat ? cat[filterCat].solid : undefined;
          return (
            <Box
              key={label}
              onClick={() => setActiveFilter(filterCat)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                px: 1.75,
                py: 0.75,
                borderRadius: 99,
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontSize: 13,
                fontWeight: 600,
                flexShrink: 0,
                userSelect: "none",
                transition: "all 0.15s ease",
                ...(isActive
                  ? {
                      bgcolor: "text.primary",
                      color: "background.default",
                    }
                  : {
                      bgcolor: "background.paper",
                      color: "text.primary",
                      border: 1,
                      borderColor: "divider",
                    }),
              }}
            >
              {dotColor && (
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: dotColor,
                    flexShrink: 0,
                  }}
                />
              )}
              {label}
            </Box>
          );
        })}
      </Box>

      {/* ── Date strip ── */}
      <Box
        sx={{
          display: "flex",
          gap: 1,
          mb: 3,
          overflowX: "auto",
          pb: 0.5,
          "&::-webkit-scrollbar": { display: "none" },
          scrollbarWidth: "none",
        }}
      >
        {weekDates.map((d) => {
          const isToday = isSameDay(d, today);
          const isSelected = isSameDay(d, selectedDate);
          return (
            <Box
              key={d.toISOString()}
              onClick={() => setSelectedDate(new Date(d))}
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 48,
                py: 1,
                px: 1,
                borderRadius: 2,
                cursor: "pointer",
                userSelect: "none",
                transition: "all 0.15s ease",
                flexShrink: 0,
                ...(isSelected && isToday
                  ? {
                      bgcolor: "primary.main",
                      color: "primary.contrastText",
                    }
                  : isSelected
                    ? {
                        bgcolor: "text.primary",
                        color: "background.default",
                      }
                    : {
                        bgcolor: "background.paper",
                        border: 1,
                        borderColor: "divider",
                        "&:hover": {
                          borderColor: "text.secondary",
                        },
                      }),
              }}
            >
              <Typography
                sx={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  opacity: 0.7,
                  color: "inherit",
                }}
              >
                {DAY_ABBRS[d.getDay()]}
              </Typography>
              <Typography
                sx={{
                  fontSize: 16,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  color: "inherit",
                }}
              >
                {d.getDate()}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* ── Timeline ── */}
      {filteredEntries.length === 0 ? (
        <Box
          sx={{
            textAlign: "center",
            py: 8,
            px: 3,
            color: "text.secondary",
          }}
        >
          <HistoryIcon sx={{ fontSize: 72, opacity: 0.25, mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            No activity yet
          </Typography>
          <Typography variant="body2">
            Logged entries will appear here.
          </Typography>
        </Box>
      ) : (
        <Stack sx={{ gap: 3 }}>
          {grouped.map(({ label, items }) => (
            <Box key={label}>
              {/* Section header */}
              <Typography
                sx={{
                  fontSize: 11.5,
                  textTransform: "uppercase",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: "text.secondary",
                  mb: 1.5,
                  pl: 4.5,
                }}
              >
                {label}
              </Typography>

              {/* Timeline spine + cards */}
              <Box sx={{ position: "relative", pl: 4.5 }}>
                {/* Spine line */}
                <Box
                  sx={{
                    position: "absolute",
                    left: 8,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    bgcolor: "divider",
                    borderRadius: 1,
                  }}
                />

                <Stack sx={{ gap: 1.5 }}>
                  {items.map((entry, i) => {
                    const cc = catColors(entry.activity_type);
                    return (
                      <Box
                        key={`${entry.activity_type}-${entry.event_time}-${i}`}
                        sx={{ position: "relative" }}
                      >
                        {/* Timeline dot */}
                        <Box
                          sx={{
                            position: "absolute",
                            left: -28,
                            top: 14,
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            bgcolor: cc.edge,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            zIndex: 1,
                          }}
                        >
                          <Box
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              bgcolor: cc.solid,
                            }}
                          />
                        </Box>

                        {/* Event card */}
                        <Box
                          sx={{
                            bgcolor: "background.paper",
                            border: 1,
                            borderColor: "divider",
                            borderRadius: 3,
                            boxShadow: 1,
                            px: 2,
                            py: 1.5,
                            display: "flex",
                            alignItems: "center",
                            gap: 1.5,
                          }}
                        >
                          {/* Icon */}
                          <Box
                            sx={{
                              color: cc.solid,
                              display: "flex",
                              alignItems: "center",
                              flexShrink: 0,
                            }}
                          >
                            {typeIcon(entry.activity_type)}
                          </Box>

                          {/* Title + meta */}
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                              variant="subtitle2"
                              noWrap
                              sx={{ fontWeight: 600, lineHeight: 1.3 }}
                            >
                              {entry.activity_type}
                            </Typography>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              noWrap
                              sx={{ textTransform: "capitalize" }}
                            >
                              {entry.detail}
                            </Typography>
                          </Box>

                          {/* Time */}
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              whiteSpace: "nowrap",
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                          >
                            {formatTime(entry.event_time)}
                          </Typography>
                        </Box>
                      </Box>
                    );
                  })}
                </Stack>
              </Box>
            </Box>
          ))}
        </Stack>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 2,
            mt: 3,
          }}
        >
          <Button
            size="small"
            startIcon={<ArrowBackIcon />}
            disabled={offset === 0}
            onClick={() => handlePageChange(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Typography variant="body2">
            Page {currentPage} of {totalPages}
          </Typography>
          <Button
            size="small"
            endIcon={<ArrowForwardIcon />}
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => handlePageChange(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </Box>
      )}
    </Box>
  );
}
