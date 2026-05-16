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
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
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

type Scope = "day" | "week" | "month" | "all";

const SCOPE_PILLS: { label: string; value: Scope }[] = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
  { label: "All time", value: "all" },
];

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
  startOfWeek.setHours(0, 0, 0, 0);
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

function isSameWeek(a: Date, b: Date): boolean {
  const startA = new Date(a);
  startA.setDate(a.getDate() - a.getDay());
  startA.setHours(0, 0, 0, 0);
  const startB = new Date(b);
  startB.setDate(b.getDate() - b.getDay());
  startB.setHours(0, 0, 0, 0);
  return startA.getTime() === startB.getTime();
}

/** Compute the [from, to] date range covered by a given scope/anchor. */
function rangeForScope(
  scope: Scope,
  anchor: Date,
): { from: Date | null; to: Date | null } {
  if (scope === "all") return { from: null, to: null };
  if (scope === "day") {
    const from = new Date(anchor);
    from.setHours(0, 0, 0, 0);
    const to = new Date(anchor);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }
  if (scope === "week") {
    const from = new Date(anchor);
    from.setDate(anchor.getDate() - anchor.getDay());
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }
  // month
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(
    anchor.getFullYear(),
    anchor.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  return { from, to };
}

/** Human-readable label for the current scope/anchor. */
function rangeLabel(scope: Scope, anchor: Date): string {
  if (scope === "all") return "All time";
  if (scope === "day") {
    return anchor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  if (scope === "month") {
    return anchor.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }
  // week
  const { from, to } = rangeForScope("week", anchor);
  if (!from || !to) return "";
  const sameMonth = from.getMonth() === to.getMonth();
  const fromStr = from.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const toStr = sameMonth
    ? to.toLocaleDateString(undefined, { day: "numeric" })
    : to.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fromStr} – ${toStr}, ${to.getFullYear()}`;
}

/** Group entries by period of day (single-day view) or by date (multi-day). */
function periodLabel(iso: string, today: Date, groupByDay: boolean): string {
  const d = new Date(iso);
  if (groupByDay) {
    if (isSameDay(d, today)) return "Today";
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
    });
  }
  if (!isSameDay(d, today)) {
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
  const [scope, setScope] = useState<Scope>("day");

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
        const { from, to } = rangeForScope(scope, selectedDate);
        if (from && to) {
          params.set("date_from", from.toISOString());
          params.set("date_to", to.toISOString());
        }

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
    [selectedDate, scope, notify],
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

  /* ---- Navigation handlers ---- */

  const shiftAnchor = (direction: -1 | 1) => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      if (scope === "day") {
        next.setDate(prev.getDate() + direction);
      } else if (scope === "week") {
        next.setDate(prev.getDate() + direction * 7);
      } else if (scope === "month") {
        next.setMonth(prev.getMonth() + direction);
      }
      return next;
    });
  };

  const shiftWeek = (direction: -1 | 1) => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + direction * 7);
      return next;
    });
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
    const groupByDay = scope !== "day";
    const groups: { label: string; items: ActivityEntry[] }[] = [];
    for (const entry of filteredEntries) {
      const lbl = periodLabel(entry.event_time, today, groupByDay);
      const last = groups[groups.length - 1];
      if (last && last.label === lbl) {
        last.items.push(entry);
      } else {
        groups.push({ label: lbl, items: [entry] });
      }
    }
    return groups;
  }, [filteredEntries, today, scope]);

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
          mb: { xs: 1.25, md: 1.5 },
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
          gap: 0.75,
          overflowX: "auto",
          pb: 0.5,
          mb: 1.25,
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

      {/* ── Scope picker ── */}
      <Box
        sx={{
          display: "flex",
          gap: 0.75,
          overflowX: "auto",
          pb: 0.5,
          mb: 1.25,
          "&::-webkit-scrollbar": { display: "none" },
          scrollbarWidth: "none",
        }}
      >
        {SCOPE_PILLS.map(({ label, value }) => {
          const isActive = scope === value;
          return (
            <Box
              key={value}
              onClick={() => setScope(value)}
              sx={{
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
                      bgcolor: "primary.main",
                      color: "primary.contrastText",
                    }
                  : {
                      bgcolor: "background.paper",
                      color: "text.primary",
                      border: 1,
                      borderColor: "divider",
                    }),
              }}
            >
              {label}
            </Box>
          );
        })}
      </Box>

      {/* ── Range navigator ── */}
      {scope !== "all" && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            mb: 1,
          }}
        >
          <IconButton
            size="small"
            onClick={() => shiftAnchor(-1)}
            aria-label={`Previous ${scope}`}
          >
            <ChevronLeftIcon />
          </IconButton>
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 600, textAlign: "center", flex: 1 }}
          >
            {rangeLabel(scope, selectedDate)}
          </Typography>
          <IconButton
            size="small"
            onClick={() => shiftAnchor(1)}
            aria-label={`Next ${scope}`}
          >
            <ChevronRightIcon />
          </IconButton>
        </Box>
      )}

      {/* ── Date strip (Day / Week scopes only) ── */}
      {(scope === "day" || scope === "week") && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mb: 1.5,
          }}
        >
          <IconButton
            size="small"
            onClick={() => shiftWeek(-1)}
            aria-label="Previous week"
            sx={{ flexShrink: 0 }}
          >
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
          <Box
            sx={{
              display: "flex",
              gap: 0.75,
              flex: 1,
              overflowX: "auto",
              pb: 0.5,
              "&::-webkit-scrollbar": { display: "none" },
              scrollbarWidth: "none",
            }}
          >
            {weekDates.map((d) => {
              const isToday = isSameDay(d, today);
              const isInWeek = isSameWeek(d, selectedDate);
              const isSelected =
                scope === "week" ? isInWeek : isSameDay(d, selectedDate);
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
          <IconButton
            size="small"
            onClick={() => shiftWeek(1)}
            aria-label="Next week"
            sx={{ flexShrink: 0 }}
          >
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

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
