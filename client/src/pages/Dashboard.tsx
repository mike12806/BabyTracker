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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
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
import NowButton from "../components/NowButton";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
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

const FEEDING_TYPES = [
  { value: "breast_left", label: "Breast (Left)" },
  { value: "breast_right", label: "Breast (Right)" },
  { value: "both_breasts", label: "Both Breasts" },
  { value: "bottle", label: "Bottle" },
  { value: "solid", label: "Solid Food" },
  { value: "fortified_breast_milk", label: "Fortified Breast Milk" },
];

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
  feed: <RestaurantIcon sx={{ fontSize: 22 }} />,
  diaper: <BabyChangingStationIcon sx={{ fontSize: 22 }} />,
  sleep: <BedtimeIcon sx={{ fontSize: 22 }} />,
  pump: <OpacityIcon sx={{ fontSize: 22 }} />,
  tummy: <AccessibilityNewIcon sx={{ fontSize: 22 }} />,
  note: <NoteIcon sx={{ fontSize: 22 }} />,
};

const CAT_ICONS_SM: CatIcons = {
  feed: <RestaurantIcon sx={{ fontSize: 16 }} />,
  diaper: <BabyChangingStationIcon sx={{ fontSize: 16 }} />,
  sleep: <BedtimeIcon sx={{ fontSize: 16 }} />,
  pump: <OpacityIcon sx={{ fontSize: 16 }} />,
  tummy: <AccessibilityNewIcon sx={{ fontSize: 16 }} />,
  note: <NoteIcon sx={{ fontSize: 16 }} />,
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

  const [feedingDialogOpen, setFeedingDialogOpen] = useState(false);
  const [feedingForm, setFeedingForm] = useState({ type: "bottle", start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
  const [diaperDialogOpen, setDiaperDialogOpen] = useState(false);
  const [diaperForm, setDiaperForm] = useState({ time: "", type: "wet", color: "", notes: "" });
  const [sleepDialogOpen, setSleepDialogOpen] = useState(false);
  const [sleepForm, setSleepForm] = useState({ start_time: "", end_time: "", is_nap: false, notes: "" });

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

  const handleFeedingSave = async () => {
    if (!selectedChild) return;
    try {
      await api.post("/feedings", {
        child_id: selectedChild.id,
        type: feedingForm.type,
        start_time: new Date(feedingForm.start_time).toISOString(),
        end_time: feedingForm.end_time ? new Date(feedingForm.end_time).toISOString() : null,
        amount: feedingForm.amount ? parseFloat(feedingForm.amount) : null,
        amount_unit: feedingForm.amount ? feedingForm.amount_unit : null,
        notes: feedingForm.notes || null,
      });
      setFeedingDialogOpen(false);
      setFeedingForm({ type: "bottle", start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
      await reloadAll(selectedChild.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save feeding.", "error");
    }
  };

  const handleDiaperSave = async () => {
    if (!selectedChild) return;
    try {
      await api.post("/diaper-changes", {
        child_id: selectedChild.id,
        time: new Date(diaperForm.time).toISOString(),
        type: diaperForm.type,
        color: diaperForm.color || null,
        notes: diaperForm.notes || null,
      });
      setDiaperDialogOpen(false);
      setDiaperForm({ time: "", type: "wet", color: "", notes: "" });
      await reloadAll(selectedChild.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save diaper change.", "error");
    }
  };

  const handleSleepSave = async () => {
    if (!selectedChild) return;
    try {
      await api.post("/sleep", {
        child_id: selectedChild.id,
        start_time: new Date(sleepForm.start_time).toISOString(),
        end_time: sleepForm.end_time ? new Date(sleepForm.end_time).toISOString() : null,
        is_nap: sleepForm.is_nap ? 1 : 0,
        notes: sleepForm.notes || null,
      });
      setSleepDialogOpen(false);
      setSleepForm({ start_time: "", end_time: "", is_nap: false, notes: "" });
      await reloadAll(selectedChild.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save sleep entry.", "error");
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
      onClick: () => { setFeedingForm({ type: "bottle", start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" }); setFeedingDialogOpen(true); },
    },
    {
      cat: "diaper", label: "Diaper",
      last: lastDiaper ? formatRelativeTime(lastDiaper.time) : "No data",
      detail: lastDiaper ? prettifyType(lastDiaper.type) : "",
      onClick: () => { setDiaperForm({ time: "", type: "wet", color: "", notes: "" }); setDiaperDialogOpen(true); },
    },
    {
      cat: "sleep", label: "Sleep",
      last: activeSleep ? "Now" : (sleeps[0] ? formatRelativeTime(sleeps[0].start_time) : "No data"),
      detail: activeSleep ? `Napping ${formatDuration(activeSleep.start_time, null)}` : (sleeps[0] ? formatDuration(sleeps[0].start_time, sleeps[0].end_time) : ""),
      live: !!activeSleep,
      onClick: () => { setSleepForm({ start_time: "", end_time: "", is_nap: false, notes: "" }); setSleepDialogOpen(true); },
    },
    {
      cat: "pump", label: "Pump",
      last: lastPump ? formatRelativeTime(lastPump.start_time) : "No data",
      detail: lastPump && lastPump.amount ? `${lastPump.amount}${lastPump.amount_unit ? ` ${lastPump.amount_unit}` : ""}` : "",
      onClick: () => navigate("/pumping"),
    },
    {
      cat: "tummy", label: "Tummy",
      last: lastTummy ? formatRelativeTime(lastTummy.start_time) : "No data",
      detail: lastTummy ? formatDuration(lastTummy.start_time, lastTummy.end_time) : "",
      onClick: () => navigate("/tummy-time"),
    },
    {
      cat: "note", label: "Note",
      last: "",
      detail: "Quick journal",
      onClick: () => navigate("/notes"),
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
            p: "12px 14px",
            borderRadius: 3.5,
            background: `linear-gradient(135deg, ${cat.sleep.soft}, ${cat.pump.soft})`,
            border: `1px solid ${cat.sleep.edge}`,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            mb: 2,
          }}
        >
          <Box
            sx={{
              width: 38, height: 38, borderRadius: "12px",
              bgcolor: cat.sleep.solid, color: isDark ? "#0c1018" : "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 0 4px ${cat.sleep.solid}25`,
            }}
          >
            <BedtimeIcon sx={{ fontSize: 20 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: 11.5, color: cat.sleep.ink, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Napping
            </Typography>
            <Typography sx={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
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
            }}
            onClick={() => navigate("/sleep")}
          >
            End nap
          </Button>
        </Box>
      )}

      {/* Active timers */}
      {timers.length > 0 && !activeSleep && (
        <Box sx={{ mb: 2 }}>
          {timers.map((t) => (
            <Box
              key={t.id}
              sx={{
                p: "12px 14px",
                borderRadius: 3.5,
                background: `linear-gradient(135deg, ${cat.feed.soft}, ${cat.pump.soft})`,
                border: `1px solid ${cat.feed.edge}`,
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                mb: 1,
              }}
            >
              <Box
                sx={{
                  width: 38, height: 38, borderRadius: "12px",
                  bgcolor: cat.feed.solid, color: isDark ? "#0c1018" : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <TimerIcon sx={{ fontSize: 20 }} />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontSize: 11.5, color: cat.feed.ink, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {t.name}
                </Typography>
                <Typography sx={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                  {formatDuration(t.start_time, null)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Section: Quick Log */}
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", px: 0.25, mb: 1.25 }}>
        <Typography sx={{ fontSize: 12, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Quick log
        </Typography>
        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
          Tap to record
        </Typography>
      </Box>

      {/* Tile grid */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))" }, gap: 1, mb: 2.5 }}>
        {tiles.map((tile) => {
          const c = cat[tile.cat];
          return (
            <ButtonBase
              key={tile.cat}
              aria-label={tile.label}
              onClick={tile.onClick}
              sx={{
                position: "relative",
                borderRadius: 3.5,
                p: 1.5,
                bgcolor: c.tile,
                border: `1px solid ${c.edge}`,
                minHeight: 110,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                alignItems: "flex-start",
                overflow: "hidden",
                textAlign: "left",
              }}
            >
              {tile.live && (
                <Box
                  sx={{
                    position: "absolute", top: 10, right: 10, width: 8, height: 8,
                    borderRadius: 99, bgcolor: c.solid,
                    boxShadow: `0 0 0 4px ${c.solid}33`,
                  }}
                />
              )}
              <Box
                sx={{
                  width: 40, height: 40, borderRadius: "12px",
                  bgcolor: c.solid, color: isDark ? "#0c1018" : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}
              >
                {CAT_ICONS[tile.cat]}
              </Box>
              <Box sx={{ minWidth: 0, width: "100%" }}>
                <Typography sx={{ fontSize: 15, fontWeight: 700, color: c.ink, letterSpacing: "-0.01em" }} noWrap>
                  {tile.label}
                </Typography>
                <Typography sx={{ fontSize: 12, color: c.ink, opacity: 0.72, mt: 0.25 }} noWrap>
                  {tile.last}
                </Typography>
              </Box>
            </ButtonBase>
          );
        })}
      </Box>

      {/* Section: Today so far */}
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", px: 0.25, mb: 1 }}>
        <Typography sx={{ fontSize: 12, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Today so far
        </Typography>
        <Typography
          onClick={() => navigate("/charts")}
          sx={{ fontSize: 12, color: "text.secondary", display: "flex", alignItems: "center", gap: 0.25, cursor: "pointer" }}
        >
          View charts <ChevronRightIcon sx={{ fontSize: 14 }} />
        </Typography>
      </Box>

      {/* Today totals — horizontal scroll */}
      <Box
        sx={{
          display: "flex", gap: 1, overflowX: "auto", pb: 0.5, mb: 2,
          mx: { xs: -2, md: 0 }, px: { xs: 2, md: 0 },
          scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {todayTotals.map((t) => {
          const c = cat[t.cat];
          return (
            <Box
              key={t.cat}
              sx={{
                flexShrink: 0, minWidth: 116, p: "10px 12px",
                borderRadius: 2.5,
                bgcolor: "background.paper",
                border: 1, borderColor: "divider",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <Box sx={{ width: 6, height: 6, borderRadius: 99, bgcolor: c.solid }} />
                <Typography sx={{ fontSize: 11, color: "text.secondary", fontWeight: 600, letterSpacing: "0.02em", textTransform: "uppercase" }}>
                  {t.label}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.15, mt: 0.5, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                {t.value}
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.125 }}>
                {t.sub}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* Section: Recent Activity */}
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", px: 0.25, mb: 0.75 }}>
        <Typography sx={{ fontSize: 12, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Recent activity
        </Typography>
        <Typography
          onClick={() => navigate("/activity")}
          sx={{ fontSize: 12, color: "text.secondary", cursor: "pointer" }}
        >
          See all
        </Typography>
      </Box>

      <Box
        sx={{
          bgcolor: "background.paper",
          borderRadius: 3,
          border: 1, borderColor: "divider",
          p: "4px 14px",
          boxShadow: 1,
          mb: 2.5,
        }}
      >
        {recentActivity.length === 0 ? (
          <Typography sx={{ py: 2, textAlign: "center", fontSize: 13.5, color: "text.secondary" }}>
            No activity recorded yet today.
          </Typography>
        ) : (
          recentActivity.map((ev, i) => {
            const c = cat[ev.cat];
            return (
              <Box
                key={i}
                sx={{
                  display: "flex", alignItems: "center", gap: 1.5,
                  py: "10px",
                  borderBottom: i === recentActivity.length - 1 ? "none" : 1,
                  borderColor: "divider",
                }}
              >
                <Box
                  sx={{
                    width: 32, height: 32, borderRadius: "10px",
                    bgcolor: c.soft, color: c.ink,
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}
                >
                  {CAT_ICONS_SM[ev.cat]}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.005em" }} noWrap>
                    {ev.title}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.125 }}>
                    {ev.meta}
                  </Typography>
                </Box>
                <Typography
                  sx={{
                    fontSize: 12.5,
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
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", px: 0.25, mb: 0.75 }}>
        <Typography sx={{ fontSize: 12, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          To-do · {activeTodos.length} active
        </Typography>
        {overdueCount > 0 && (
          <Typography sx={{ fontSize: 12, color: cat.temp.solid, fontWeight: 600 }}>
            {overdueCount} overdue
          </Typography>
        )}
      </Box>

      <Box
        sx={{
          bgcolor: "background.paper",
          borderRadius: 3,
          border: 1, borderColor: "divider",
          p: "4px 14px",
          boxShadow: 1,
          mb: 2,
        }}
      >
        {snapshotTodos.length === 0 ? (
          <Box sx={{ py: 2, textAlign: "center" }}>
            <Typography sx={{ fontSize: 13.5, color: "text.secondary" }}>
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
                  display: "flex", alignItems: "center", gap: 1.25,
                  py: "10px",
                  borderBottom: i === snapshotTodos.length - 1 ? "none" : 1,
                  borderColor: "divider",
                }}
              >
                <Checkbox
                  checked={!!t.completed}
                  onChange={() => handleTodoToggle(t)}
                  size="small"
                  sx={{
                    p: 0, width: 22, height: 22,
                    color: "text.disabled",
                    "&.Mui-checked": { color: cat.todo.solid },
                  }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 500, letterSpacing: "-0.005em" }} noWrap>
                    {t.title}
                  </Typography>
                  {t.due_date && (
                    <Typography sx={{ fontSize: 12, color: overdue ? cat.temp.solid : "text.secondary", fontWeight: overdue ? 600 : 500, mt: 0.125 }}>
                      {formatTodoDueDate(t.due_date)}
                    </Typography>
                  )}
                </Box>
                <Box
                  sx={{
                    fontSize: 10.5, fontWeight: 700, px: "7px", py: "3px",
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

      {/* Quick Action Dialogs */}
      <Dialog open={feedingDialogOpen} onClose={() => setFeedingDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Feeding</DialogTitle>
        <DialogContent>
          <TextField select margin="dense" label="Type" fullWidth value={feedingForm.type} onChange={(e) => setFeedingForm({ ...feedingForm, type: e.target.value })}>
            {FEEDING_TYPES.map((t) => (<MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>))}
          </TextField>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField margin="dense" label="Start Time" type="datetime-local" sx={{ flex: 1, minWidth: 0 }} required slotProps={{ inputLabel: { shrink: true } }} value={feedingForm.start_time} onChange={(e) => setFeedingForm({ ...feedingForm, start_time: e.target.value })} />
            <NowButton onSetNow={(v) => setFeedingForm({ ...feedingForm, start_time: v })} />
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField margin="dense" label="End Time" type="datetime-local" sx={{ flex: 1, minWidth: 0 }} slotProps={{ inputLabel: { shrink: true } }} value={feedingForm.end_time} onChange={(e) => setFeedingForm({ ...feedingForm, end_time: e.target.value })} />
            <NowButton onSetNow={(v) => setFeedingForm({ ...feedingForm, end_time: v })} />
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField margin="dense" label="Amount" type="number" sx={{ flex: 1 }} value={feedingForm.amount} onChange={(e) => setFeedingForm({ ...feedingForm, amount: e.target.value })} />
            <TextField select margin="dense" label="Unit" sx={{ width: 100 }} value={feedingForm.amount_unit} onChange={(e) => setFeedingForm({ ...feedingForm, amount_unit: e.target.value })}>
              <MenuItem value="oz">oz</MenuItem>
              <MenuItem value="ml">ml</MenuItem>
              <MenuItem value="g">g</MenuItem>
            </TextField>
          </Box>
          <TextField margin="dense" label="Notes" fullWidth multiline rows={2} value={feedingForm.notes} onChange={(e) => setFeedingForm({ ...feedingForm, notes: e.target.value })} />
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1, "& > :not(style) ~ :not(style)": { ml: 0 } }}>
          <Button onClick={() => setFeedingDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleFeedingSave} variant="contained" disabled={!feedingForm.start_time}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={diaperDialogOpen} onClose={() => setDiaperDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Diaper Change</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField margin="dense" label="Time" type="datetime-local" sx={{ flex: 1, minWidth: 0 }} required slotProps={{ inputLabel: { shrink: true } }} value={diaperForm.time} onChange={(e) => setDiaperForm({ ...diaperForm, time: e.target.value })} />
            <NowButton onSetNow={(v) => setDiaperForm({ ...diaperForm, time: v })} />
          </Box>
          <TextField select margin="dense" label="Type" fullWidth value={diaperForm.type} onChange={(e) => setDiaperForm({ ...diaperForm, type: e.target.value })}>
            <MenuItem value="wet">Wet</MenuItem>
            <MenuItem value="solid">Solid</MenuItem>
            <MenuItem value="both">Both</MenuItem>
          </TextField>
          <TextField select margin="dense" label="Color" fullWidth value={diaperForm.color} onChange={(e) => setDiaperForm({ ...diaperForm, color: e.target.value })}>
            <MenuItem value="">None</MenuItem>
            <MenuItem value="black">Black</MenuItem>
            <MenuItem value="brown">Brown</MenuItem>
            <MenuItem value="green">Green</MenuItem>
            <MenuItem value="yellow">Yellow</MenuItem>
            <MenuItem value="white">White</MenuItem>
          </TextField>
          <TextField margin="dense" label="Notes" fullWidth multiline rows={2} value={diaperForm.notes} onChange={(e) => setDiaperForm({ ...diaperForm, notes: e.target.value })} />
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1, "& > :not(style) ~ :not(style)": { ml: 0 } }}>
          <Button onClick={() => setDiaperDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDiaperSave} variant="contained" color="warning" disabled={!diaperForm.time}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={sleepDialogOpen} onClose={() => setSleepDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Sleep</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField margin="dense" label="Start Time" type="datetime-local" sx={{ flex: 1, minWidth: 0 }} required slotProps={{ inputLabel: { shrink: true } }} value={sleepForm.start_time} onChange={(e) => setSleepForm({ ...sleepForm, start_time: e.target.value })} />
            <NowButton onSetNow={(v) => setSleepForm({ ...sleepForm, start_time: v })} />
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField margin="dense" label="End Time" type="datetime-local" sx={{ flex: 1, minWidth: 0 }} slotProps={{ inputLabel: { shrink: true } }} value={sleepForm.end_time} onChange={(e) => setSleepForm({ ...sleepForm, end_time: e.target.value })} />
            <NowButton onSetNow={(v) => setSleepForm({ ...sleepForm, end_time: v })} />
          </Box>
          <FormControlLabel control={<Checkbox checked={sleepForm.is_nap} onChange={(e) => setSleepForm({ ...sleepForm, is_nap: e.target.checked })} />} label="Nap" />
          <TextField margin="dense" label="Notes" fullWidth multiline rows={2} value={sleepForm.notes} onChange={(e) => setSleepForm({ ...sleepForm, notes: e.target.value })} />
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1, "& > :not(style) ~ :not(style)": { ml: 0 } }}>
          <Button onClick={() => setSleepDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSleepSave} variant="contained" color="secondary" disabled={!sleepForm.start_time}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
