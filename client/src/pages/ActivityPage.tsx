import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
  useTheme,
  alpha,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import RestaurantIcon from "@mui/icons-material/Restaurant";
import BabyChangingStationIcon from "@mui/icons-material/BabyChangingStation";
import BedtimeIcon from "@mui/icons-material/Bedtime";
import AccessibilityNewIcon from "@mui/icons-material/AccessibilityNew";
import OpacityIcon from "@mui/icons-material/Opacity";
import ThermostatIcon from "@mui/icons-material/Thermostat";
import NoteIcon from "@mui/icons-material/Note";
import MedicationIcon from "@mui/icons-material/Medication";
import HistoryIcon from "@mui/icons-material/History";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NoChildPlaceholder from "../components/NoChildPlaceholder";

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

const PAGE_SIZE = 50;

type ChipColor = "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning";

const TYPE_COLORS: Record<string, ChipColor> = {
  Feeding: "primary",
  "Diaper Change": "warning",
  Sleep: "info",
  "Tummy Time": "success",
  Pumping: "secondary",
  Temperature: "error",
  Note: "default",
  Medication: "warning",
};

function typeIcon(activityType: string): React.ReactElement {
  switch (activityType) {
    case "Feeding": return <RestaurantIcon fontSize="small" />;
    case "Diaper Change": return <BabyChangingStationIcon fontSize="small" />;
    case "Sleep": return <BedtimeIcon fontSize="small" />;
    case "Tummy Time": return <AccessibilityNewIcon fontSize="small" />;
    case "Pumping": return <OpacityIcon fontSize="small" />;
    case "Temperature": return <ThermostatIcon fontSize="small" />;
    case "Note": return <NoteIcon fontSize="small" />;
    case "Medication": return <MedicationIcon fontSize="small" />;
    default: return <HistoryIcon fontSize="small" />;
  }
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const dayDiff = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86400000,
  );
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function dateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function ActivityPage() {
  const theme = useTheme();
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async (childId: number, off: number) => {
    try {
      const params = new URLSearchParams({
        child_id: String(childId),
        limit: String(PAGE_SIZE),
        offset: String(off),
      });
      if (dateFrom) params.set("date_from", new Date(dateFrom).toISOString());
      if (dateTo) params.set("date_to", new Date(dateTo + "T23:59:59").toISOString());
      const data = await api.get<ActivityResponse>(`/activity?${params}`);
      setEntries(data.results);
      setTotal(data.total);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load activity.", "error");
    }
  }, [dateFrom, dateTo, notify]);

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

  const handleFilter = () => {
    if (!selectedChild) return;
    setOffset(0);
    load(selectedChild.id, 0);
  };

  const handleClearFilter = () => {
    setDateFrom("");
    setDateTo("");
  };

  useEffect(() => {
    if (!dateFrom && !dateTo && selectedChild) {
      load(selectedChild.id, 0);
    }
  }, [dateFrom, dateTo, selectedChild, load]);

  if (!selectedChild) return <NoChildPlaceholder />;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  // Group by day for the timeline view
  const grouped: { key: string; label: string; items: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const key = dateKey(entry.event_time);
    const last = grouped[grouped.length - 1];
    if (last && last.key === key) {
      last.items.push(entry);
    } else {
      grouped.push({ key, label: dayLabel(entry.event_time), items: [entry] });
    }
  }

  return (
    <Box sx={{ maxWidth: { xs: "100%", md: 700 }, mx: "auto" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">All Activity</Typography>
        <Typography variant="body2" color="text.secondary">
          {total} {total === 1 ? "entry" : "entries"}
        </Typography>
      </Box>

      {/* Filter bar */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-end" }}>
            <TextField
              label="From"
              type="date"
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <TextField
              label="To"
              type="date"
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
            <Button variant="contained" onClick={handleFilter} disabled={!dateFrom && !dateTo}>
              Filter
            </Button>
            {(dateFrom || dateTo) && (
              <Button variant="outlined" onClick={handleClearFilter}>Clear</Button>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* Timeline */}
      {entries.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 8, px: 3, color: "text.secondary" }}>
          <HistoryIcon sx={{ fontSize: 72, opacity: 0.25, mb: 2 }} />
          <Typography variant="h6" gutterBottom>No activity yet</Typography>
          <Typography variant="body2">Logged entries will appear here.</Typography>
        </Box>
      ) : (
        <Stack sx={{ gap: 3, pb: 4 }}>
          {grouped.map(({ key, label, items }) => (
            <Box key={key}>
              {/* Sticky day header */}
              <Box
                sx={{
                  position: "sticky",
                  top: 64,
                  zIndex: 1,
                  backgroundColor: "background.default",
                  backdropFilter: "blur(8px)",
                  py: 0.75,
                  px: 0.5,
                  mb: 1,
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }} color="text.secondary">
                  {label}
                </Typography>
              </Box>

              <Stack sx={{ gap: 1 }}>
                {items.map((entry, i) => {
                  const color = TYPE_COLORS[entry.activity_type] ?? "default";
                  const iconColor = color === "default"
                    ? theme.palette.text.secondary
                    : theme.palette[color as keyof typeof theme.palette] && (theme.palette[color as keyof typeof theme.palette] as { main: string }).main;
                  return (
                    <Box
                      key={`${entry.activity_type}-${entry.event_time}-${i}`}
                      sx={{ display: "flex", alignItems: "center", gap: 1.5 }}
                    >
                      {/* Icon dot */}
                      <Box
                        sx={{
                          width: 36,
                          height: 36,
                          borderRadius: 2,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          backgroundColor: iconColor
                            ? alpha(iconColor as string, 0.12)
                            : alpha(theme.palette.text.secondary, 0.1),
                          color: iconColor || "text.secondary",
                        }}
                      >
                        {typeIcon(entry.activity_type)}
                      </Box>

                      {/* Content */}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
                          <Typography variant="subtitle2" noWrap sx={{ flex: 1 }}>
                            {entry.activity_type}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                            {formatTime(entry.event_time)}
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary" noWrap sx={{ textTransform: "capitalize" }}>
                          {entry.detail}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          ))}
        </Stack>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 2, mt: 2, mb: 4 }}>
          <Button
            size="small"
            startIcon={<ArrowBackIcon />}
            disabled={offset === 0}
            onClick={() => handlePageChange(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Typography variant="body2">Page {currentPage} of {totalPages}</Typography>
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
