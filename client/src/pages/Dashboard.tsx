import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Checkbox,
  Chip,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import RestaurantIcon from "@mui/icons-material/Restaurant";
import BabyChangingStationIcon from "@mui/icons-material/BabyChangingStation";
import BedtimeIcon from "@mui/icons-material/Bedtime";
import TimerIcon from "@mui/icons-material/Timer";
import AccessibilityNewIcon from "@mui/icons-material/AccessibilityNew";
import OpacityIcon from "@mui/icons-material/Opacity";
import NoteIcon from "@mui/icons-material/Note";
import ChecklistIcon from "@mui/icons-material/Checklist";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { api, API_BASE } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import QuickLogDialog, { type QuickLogCategory } from "../components/QuickLogDialog";
import { buildCategoryColors, type CategoryKey } from "../theme/categoryColors";
import type {
  Feeding,
  DiaperChange,
  SleepEntry,
  Timer,
  TummyTime,
  Pumping,
  Todo,
} from "../types/models";

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return remMins > 0 ? `${hrs}h ${remMins}m ago` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDuration(start: string, end: string | null): string {
  const endMs = end ? new Date(end).getTime() : Date.now();
  const ms = endMs - new Date(start).getTime();
  if (ms <= 0) return "0m";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function prettifyType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTodoDueDate(dateStr: string): string {
  const due = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays < 7) return `In ${diffDays}d`;
  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isTodoOverdue(todo: Todo): boolean {
  if (!todo.due_date || todo.completed) return false;
  const due = new Date(todo.due_date + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function formatAge(birthDate: string): string {
  const birth = new Date(birthDate);
  const now = new Date();
  const diffMs = now.getTime() - birth.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 8) {
    if (diffWeeks < 1) return diffDays === 1 ? "1 day" : `${diffDays} days`;
    return diffWeeks === 1 ? "1 week" : `${diffWeeks} weeks`;
  }
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) months--;
  if (months < 12) return months === 1 ? "1 mo" : `${months} mo`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (remMonths === 0) return years === 1 ? "1 year" : `${years} years`;
  return `${years}y ${remMonths}m`;
}

type CatIcons = { [K in CategoryKey]?: React.ReactElement };
const CAT_ICONS: CatIcons = {
  feed: <RestaurantIcon sx={{ fontSize: 18 }} />,
  diaper: <BabyChangingStationIcon sx={{ fontSize: 18 }} />,
  sleep: <BedtimeIcon sx={{ fontSize: 18 }} />,
  pump: <OpacityIcon sx={{ fontSize: 18 }} />,
  tummy: <AccessibilityNewIcon sx={{ fontSize: 18 }} />,
  note: <NoteIcon sx={{ fontSize: 18 }} />,
};

const CAT_ICONS_SM: CatIcons = {
  feed: <RestaurantIcon sx={{ fontSize: 14 }} />,
  diaper: <BabyChangingStationIcon sx={{ fontSize: 14 }} />,
  sleep: <BedtimeIcon sx={{ fontSize: 14 }} />,
  pump: <OpacityIcon sx={{ fontSize: 14 }} />,
  tummy: <AccessibilityNewIcon sx={{ fontSize: 14 }} />,
  note: <NoteIcon sx={{ fontSize: 14 }} />,
};

export default function Dashboard() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [feedings, setFeedings] = useState<Feeding[]>([]);
  const [diapers, setDiapers] = useState<DiaperChange[]>([]);
  const [sleeps, setSleeps] = useState<SleepEntry[]>([]);
  const [timers, setTimers] = useState<Timer[]>([]);
  const [tummyTimes, setTummyTimes] = useState<TummyTime[]>([]);
  const [pumpings, setPumpings] = useState<Pumping[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);

  const [quickLogCategory, setQuickLogCategory] = useState<QuickLogCategory | null>(null);

  const reloadAll = async (childId: number) => {
    const [f, d, s, t, tt, p, td] = await Promise.all([
      api.get<Feeding[]>(`/feedings?child_id=${childId}&limit=500`),
      api.get<DiaperChange[]>(`/diaper-changes?child_id=${childId}&limit=500`),
      api.get<SleepEntry[]>(`/sleep?child_id=${childId}&limit=500`),
      api.get<Timer[]>(`/timers?child_id=${childId}&active=true`),
      api.get<TummyTime[]>(`/tummy-time?child_id=${childId}&limit=500`),
      api.get<Pumping[]>(`/pumping?child_id=${childId}&limit=500`),
      api.get<Todo[]>(`/todos?child_id=${childId}&limit=200`),
    ]);
    setFeedings(f);
    setDiapers(d);
    setSleeps(s);
    setTimers(t);
    setTummyTimes(tt);
    setPumpings(p);
    setTodos(td);
  };

  const handleTodoToggle = async (todo: Todo) => {
    try {
      await api.put(`/todos/${todo.id}`, { completed: !todo.completed });
      if (selectedChild) await reloadAll(selectedChild.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to update todo.", "error");
    }
  };

  useEffect(() => {
    if (!selectedChild) return;
    reloadAll(selectedChild.id);
  }, [selectedChild]);

  if (!selectedChild) return <NoChildPlaceholder />;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();
  const todayFeedings = feedings.filter((f) => f.start_time >= todayStartIso);
  const todayDiapers = diapers.filter((d) => d.time >= todayStartIso);
  const todayFeedingOz = todayFeedings.reduce((sum, f) => (f.amount && f.amount_unit === "oz" ? sum + f.amount : sum), 0);
  const todayPumpOz = pumpings.filter((p) => p.start_time >= todayStartIso).reduce((sum, p) => (p.amount && p.amount_unit === "oz" ? sum + p.amount : sum), 0);
  const todayPumpCount = pumpings.filter((p) => p.start_time >= todayStartIso).length;
  const lastFeeding = feedings[0] ?? null;
  const lastDiaper = diapers[0] ?? null;
  const activeSleep = sleeps.find((s) => !s.end_time) ?? null;
  const lastPump = pumpings[0] ?? null;
  const lastTummy = tummyTimes[0] ?? null;

  const todaySleepMins = sleeps
    .filter((s) => s.start_time >= todayStartIso)
    .reduce((sum, s) => {
      const end = s.end_time ? new Date(s.end_time).getTime() : Date.now();
      return sum + Math.max(0, (end - new Date(s.start_time).getTime()) / 60000);
    }, 0);

  const PRIORITY_RANK: Record<Todo["priority"], number> = { high: 0, medium: 1, low: 2 };
  const activeTodos = todos.filter((t) => !t.completed);
  const overdueCount = activeTodos.filter(isTodoOverdue).length;
  const snapshotTodos = [...activeTodos]
    .sort((a, b) => {
      const ao = isTodoOverdue(a) ? 0 : 1;
      const bo = isTodoOverdue(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    })
    .slice(0, 3);

  const tiles: { cat: CategoryKey; label: string; last: string; detail: string; live?: boolean; onClick: () => void }[] = [
    {
      cat: "feed", label: "Feeding",
      last: lastFeeding ? formatRelativeTime(lastFeeding.start_time) : "No data",
      detail: lastFeeding ? `${lastFeeding.amount ? `${lastFeeding.amount}${lastFeeding.amount_unit ? ` ${lastFeeding.amount_unit}` : ""}` : ""} ${prettifyType(lastFeeding.type)}`.trim() : "",
      onClick: () => setQuickLogCategory("feed"),
    },
    {
      cat: "diaper", label: "Diaper",
      last: lastDiaper ? formatRelativeTime(lastDiaper.time) : "No data",
      detail: lastDiaper ? prettifyType(lastDiaper.type) : "",
      onClick: () => setQuickLogCategory("diaper"),
    },
    {
      cat: "sleep", label: "Sleep",
      last: activeSleep ? "Now" : (sleeps[0] ? formatRelativeTime(sleeps[0].start_time) : "No data"),
      detail: activeSleep ? `Napping ${formatDuration(activeSleep.start_time, null)}` : (sleeps[0] ? formatDuration(sleeps[0].start_time, sleeps[0].end_time) : ""),
      live: !!activeSleep,
      onClick: () => setQuickLogCategory("sleep"),
    },
    {
      cat: "pump", label: "Pump",
      last: lastPump ? formatRelativeTime(lastPump.start_time) : "No data",
      detail: lastPump && lastPump.amount ? `${lastPump.amount}${lastPump.amount_unit ? ` ${lastPump.amount_unit}` : ""}` : "",
      onClick: () => setQuickLogCategory("pump"),
    },
    {
      cat: "tummy", label: "Tummy",
      last: lastTummy ? formatRelativeTime(lastTummy.start_time) : "No data",
      detail: lastTummy ? formatDuration(lastTummy.start_time, lastTummy.end_time) : "",
      onClick: () => setQuickLogCategory("tummy"),
    },
    {
      cat: "note", label: "Note",
      last: "",
      detail: "Quick journal",
      onClick: () => setQuickLogCategory("note"),
    },
  ];

  const todayTotals: { cat: CategoryKey; value: string; label: string; sub: string }[] = [
    { cat: "feed", value: `${todayFeedings.length}`, label: "feeds", sub: todayFeedingOz > 0 ? `${todayFeedingOz} oz` : "today" },
    { cat: "diaper", value: `${todayDiapers.length}`, label: "diapers", sub: "today" },
    { cat: "sleep", value: formatDuration("", null).replace(/.*/, () => { const h = Math.floor(todaySleepMins / 60); const m = Math.round(todaySleepMins % 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; }), label: "asleep", sub: activeSleep ? "+ active" : "today" },
    { cat: "pump", value: todayPumpOz > 0 ? `${todayPumpOz} oz` : `${todayPumpCount}`, label: "pumped", sub: todayPumpCount > 0 ? `${todayPumpCount} sessions` : "today" },
  ];

  const recentActivity: { cat: CategoryKey; title: string; time: string; meta: string; live?: boolean }[] = [];
  const cutoff = 6;
  const allEvents: typeof recentActivity = [];
  feedings.slice(0, 10).forEach((f) => allEvents.push({ cat: "feed", title: `${prettifyType(f.type)}${f.amount ? ` · ${f.amount}${f.amount_unit ? ` ${f.amount_unit}` : ""}` : ""}`, time: new Date(f.start_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), meta: formatDuration(f.start_time, f.end_time) }));
  diapers.slice(0, 10).forEach((d) => allEvents.push({ cat: "diaper", title: `Diaper · ${prettifyType(d.type)}`, time: new Date(d.time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), meta: d.color || "" }));
  sleeps.slice(0, 10).forEach((s) => allEvents.push({ cat: "sleep", title: s.is_nap ? "Nap" : "Sleep", time: new Date(s.start_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), meta: s.end_time ? formatDuration(s.start_time, s.end_time) : `Active · ${formatDuration(s.start_time, null)}`, live: !s.end_time }));
  pumpings.slice(0, 10).forEach((p) => allEvents.push({ cat: "pump", title: `Pump${p.amount ? ` · ${p.amount}${p.amount_unit ? ` ${p.amount_unit}` : ""}` : ""}`, time: new Date(p.start_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), meta: formatDuration(p.start_time, p.end_time) }));
  tummyTimes.slice(0, 10).forEach((tt) => allEvents.push({ cat: "tummy", title: "Tummy time", time: new Date(tt.start_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), meta: formatDuration(tt.start_time, tt.end_time) }));

  allEvents.sort((a, b) => {
    const ta = new Date(`1970-01-01 ${a.time}`).getTime();
    const tb = new Date(`1970-01-01 ${b.time}`).getTime();
    return tb - ta;
  });
  recentActivity.push(...allEvents.slice(0, cutoff));

  const now = new Date();
  const dayName = now.toLocaleDateString(undefined, { weekday: "long" });
  const timeStr = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const prioCatKey = (p: string): CategoryKey => p === "high" ? "temp" : p === "medium" ? "diaper" : "note";

  return (
    <Box>
      {/* Live status banner */}
      {activeSleep && (
        <Box
          sx={{
            p: "8px 10px",
            borderRadius: 2,
            background: `linear-gradient(135deg, ${cat.sleep.soft}, ${cat.pump.soft})`,
            border: `1px solid ${cat.sleep.edge}`,
            display: "flex",
            alignItems: "center",
            gap: 1,
            mb: 1.25,
          }}
        >
          <Box
            sx={{
              width: 28, height: 28, borderRadius: "9px",
              bgcolor: cat.sleep.solid, color: isDark ? "#0c1018" : "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 0 3px ${cat.sleep.solid}25`,
            }}
          >
            <BedtimeIcon sx={{ fontSize: 15 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: 10, color: cat.sleep.ink, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.1 }}>
              Napping
            </Typography>
            <Typography sx={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
              {formatDuration(activeSleep.start_time, null)}
            </Typography>
          </Box>
          <Button
            variant="outlined"
            size="small"
            sx={{
              borderColor: cat.sleep.edge,
              color: cat.sleep.ink,
              borderRadius: 99,
              fontWeight: 600,
              textTransform: "none",
              fontSize: 12,
              minHeight: 30,
              px: 1.5,
            }}
            onClick={() => navigate("/sleep")}
          >
            End nap
          </Button>
        </Box>
      )}

      {/* Active timers */}
      {timers.length > 0 && !activeSleep && (
        <Box sx={{ mb: 1.25 }}>
          {timers.map((t) => (
            <Box
              key={t.id}
              sx={{
                p: "8px 10px",
                borderRadius: 2,
                background: `linear-gradient(135deg, ${cat.feed.soft}, ${cat.pump.soft})`,
                border: `1px solid ${cat.feed.edge}`,
                display: "flex",
                alignItems: "center",
                gap: 1,
                mb: 0.75,
              }}
            >
              <Box
                sx={{
                  width: 28, height: 28, borderRadius: "9px",
                  bgcolor: cat.feed.solid, color: isDark ? "#0c1018" : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <TimerIcon sx={{ fontSize: 15 }} />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontSize: 10, color: cat.feed.ink, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.1 }}>
                  {t.name}
                </Typography>
                <Typography sx={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                  {formatDuration(t.start_time, null)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Section: Quick Log */}
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", px: 0.25, mb: 0.75 }}>
        <Typography sx={{ fontSize: 11, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Quick log
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
          <AddIcon sx={{ fontSize: 12, color: "text.secondary" }} />
          <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
            Tap to record
          </Typography>
        </Box>
      </Box>

      {/* Tile grid */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))" }, gap: 0.75, mb: 1.75 }}>
        {tiles.map((tile) => {
          const c = cat[tile.cat];
          return (
            <ButtonBase
              key={tile.cat}
              aria-label={tile.label}
              onClick={tile.onClick}
              sx={{
                position: "relative",
                borderRadius: "12px",
                p: { xs: "8px 10px", sm: "10px 12px" },
                bgcolor: c.tile,
                border: `1px solid ${c.edge}`,
                minHeight: { xs: 52, sm: 56 },
                display: "flex",
                flexDirection: "row",
                justifyContent: "flex-start",
                alignItems: "center",
                gap: { xs: 1, sm: 1.25 },
                overflow: "hidden",
                textAlign: "left",
              }}
            >
              {tile.live && (
                <Box
                  sx={{
                    position: "absolute", top: 7, right: 7, width: 6, height: 6,
                    borderRadius: 99, bgcolor: c.solid,
                    boxShadow: `0 0 0 3px ${c.solid}33`,
                  }}
                />
              )}
              <Box
                sx={{
                  width: { xs: 30, sm: 34 }, height: { xs: 30, sm: 34 }, borderRadius: "9px",
                  bgcolor: c.solid, color: isDark ? "#0c1018" : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}
              >
                {CAT_ICONS[tile.cat]}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: { xs: 12.5, sm: 13.5 }, fontWeight: 700, color: c.ink, letterSpacing: "-0.01em", lineHeight: 1.15 }} noWrap>
                  {tile.label}
                </Typography>
                <Typography sx={{ fontSize: { xs: 10.5, sm: 11.5 }, color: c.ink, opacity: 0.72, mt: 0.125, lineHeight: 1.2 }} noWrap>
                  {tile.last || tile.detail}
                </Typography>
              </Box>
              <AddIcon sx={{ fontSize: { xs: 15, sm: 16 }, color: c.solid, opacity: 0.55, flexShrink: 0 }} />
            </ButtonBase>
          );
        })}
      </Box>

      {/* Section: Today so far */}
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", px: 0.25, mb: 0.625 }}>
        <Typography sx={{ fontSize: 11, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Today so far
        </Typography>
        <Typography
          onClick={() => navigate("/charts")}
          sx={{ fontSize: 11, color: "text.secondary", display: "flex", alignItems: "center", gap: 0.25, cursor: "pointer" }}
        >
          View charts <ChevronRightIcon sx={{ fontSize: 13 }} />
        </Typography>
      </Box>

      {/* Today totals — horizontal scroll on mobile, equal-width grid on desktop */}
      <Box
        sx={{
          display: { xs: "flex", md: "grid" },
          gridTemplateColumns: { md: `repeat(${todayTotals.length}, minmax(0, 1fr))` },
          gap: { xs: 0.75, md: 1.25 },
          overflowX: { xs: "auto", md: "visible" },
          pb: { xs: 0.25, md: 0 },
          mb: 1.5,
          mx: { xs: -1.5, md: 0 },
          px: { xs: 1.5, md: 0 },
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {todayTotals.map((t) => {
          const c = cat[t.cat];
          return (
            <Box
              key={t.cat}
              sx={{
                flexShrink: 0,
                minWidth: { xs: 96, md: 0 },
                width: { md: "100%" },
                p: { xs: "6px 10px", md: "10px 14px" },
                borderRadius: 1.5,
                bgcolor: "background.paper",
                border: 1, borderColor: "divider",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Box sx={{ width: { xs: 5, md: 6 }, height: { xs: 5, md: 6 }, borderRadius: 99, bgcolor: c.solid }} />
                <Typography sx={{ fontSize: { xs: 9.5, md: 11 }, color: "text.secondary", fontWeight: 600, letterSpacing: "0.02em", textTransform: "uppercase" }}>
                  {t.label}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: { xs: 15, md: 22 }, fontWeight: 700, lineHeight: 1.1, mt: { xs: 0.25, md: 0.5 }, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }} noWrap>
                {t.value}
              </Typography>
              <Typography sx={{ fontSize: { xs: 9.5, md: 11 }, color: "text.secondary", mt: { xs: 0, md: 0.25 } }} noWrap>
                {t.sub}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* Section: Recent Activity */}
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", px: 0.25, mb: 0.5 }}>
        <Typography sx={{ fontSize: 11, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Recent activity
        </Typography>
        <Typography
          onClick={() => navigate("/activity")}
          sx={{ fontSize: 11, color: "text.secondary", cursor: "pointer" }}
        >
          See all
        </Typography>
      </Box>

      <Box
        sx={{
          bgcolor: "background.paper",
          borderRadius: 2,
          border: 1, borderColor: "divider",
          p: "2px 10px",
          boxShadow: 0,
          mb: 1.5,
        }}
      >
        {recentActivity.length === 0 ? (
          <Typography sx={{ py: 1.25, textAlign: "center", fontSize: 12, color: "text.secondary" }}>
            No activity recorded yet today.
          </Typography>
        ) : (
          recentActivity.map((ev, i) => {
            const c = cat[ev.cat];
            return (
              <Box
                key={i}
                sx={{
                  display: "flex", alignItems: "center", gap: 1,
                  py: "6px",
                  borderBottom: i === recentActivity.length - 1 ? "none" : 1,
                  borderColor: "divider",
                }}
              >
                <Box
                  sx={{
                    width: 24, height: 24, borderRadius: "8px",
                    bgcolor: c.soft, color: c.ink,
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}
                >
                  {CAT_ICONS_SM[ev.cat]}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.2 }} noWrap>
                    {ev.title}
                  </Typography>
                  <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0, lineHeight: 1.2 }}>
                    {ev.meta}
                  </Typography>
                </Box>
                <Typography
                  sx={{
                    fontSize: 11,
                    color: ev.live ? c.ink : "text.secondary",
                    fontWeight: ev.live ? 700 : 500,
                    fontVariantNumeric: "tabular-nums",
                    flexShrink: 0,
                  }}
                >
                  {ev.time}
                </Typography>
              </Box>
            );
          })
        )}
      </Box>

      {/* Section: To-do snapshot */}
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", px: 0.25, mb: 0.5 }}>
        <Typography sx={{ fontSize: 11, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          To-do · {activeTodos.length} active
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {overdueCount > 0 && (
            <Typography sx={{ fontSize: 11, color: cat.temp.solid, fontWeight: 600 }}>
              {overdueCount} overdue
            </Typography>
          )}
          <Typography
            onClick={() => navigate("/todos")}
            sx={{ fontSize: 11, color: "text.secondary", display: "flex", alignItems: "center", gap: 0.25, cursor: "pointer" }}
          >
            View to-dos <ChevronRightIcon sx={{ fontSize: 13 }} />
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          bgcolor: "background.paper",
          borderRadius: 2,
          border: 1, borderColor: "divider",
          p: "2px 10px",
          boxShadow: 0,
          mb: 1.25,
        }}
      >
        {snapshotTodos.length === 0 ? (
          <Box sx={{ py: 1.25, textAlign: "center" }}>
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
              {activeTodos.length === 0 && todos.length > 0
                ? "All caught up!"
                : "No tasks yet."}
            </Typography>
          </Box>
        ) : (
          snapshotTodos.map((t, i) => {
            const overdue = isTodoOverdue(t);
            const pc = cat[prioCatKey(t.priority)];
            return (
              <Box
                key={t.id}
                sx={{
                  display: "flex", alignItems: "center", gap: 1,
                  py: "6px",
                  borderBottom: i === snapshotTodos.length - 1 ? "none" : 1,
                  borderColor: "divider",
                }}
              >
                <Checkbox
                  checked={!!t.completed}
                  onChange={() => handleTodoToggle(t)}
                  size="small"
                  sx={{
                    p: 0, width: 18, height: 18,
                    color: "text.disabled",
                    "&.Mui-checked": { color: cat.todo.solid },
                  }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 500, letterSpacing: "-0.005em", lineHeight: 1.2 }} noWrap>
                    {t.title}
                  </Typography>
                  {t.due_date && (
                    <Typography sx={{ fontSize: 10.5, color: overdue ? cat.temp.solid : "text.secondary", fontWeight: overdue ? 600 : 500, mt: 0, lineHeight: 1.2 }}>
                      {formatTodoDueDate(t.due_date)}
                    </Typography>
                  )}
                </Box>
                <Box
                  sx={{
                    fontSize: 9.5, fontWeight: 700, px: "6px", py: "2px",
                    borderRadius: 99, textTransform: "uppercase", letterSpacing: "0.04em",
                    bgcolor: pc.soft, color: pc.ink, flexShrink: 0,
                  }}
                >
                  {t.priority}
                </Box>
              </Box>
            );
          })
        )}
      </Box>

      <QuickLogDialog
        category={quickLogCategory}
        onClose={() => setQuickLogCategory(null)}
        onLogged={() => {
          if (selectedChild) reloadAll(selectedChild.id);
        }}
      />
    </Box>
  );
}
