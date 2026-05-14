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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  MenuItem,
  Tab,
  Tabs,
  Typography,
  Chip,
  Stack,
  Divider,
  IconButton,
  Paper,
  TextField,
  Tooltip,
  alpha,
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
import MonitorWeightIcon from "@mui/icons-material/MonitorWeight";
import ThermostatIcon from "@mui/icons-material/Thermostat";
import NoteIcon from "@mui/icons-material/Note";
import ChecklistIcon from "@mui/icons-material/Checklist";
import { api, API_BASE } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import {
  FeedingChart,
  DiaperChart,
  SleepChart,
  TummyTimeChart,
  PumpingChart,
  GrowthChart,
} from "../components/Charts";
import type {
  Feeding,
  DiaperChange,
  SleepEntry,
  Timer,
  TummyTime,
  Pumping,
  Growth,
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

type ChipColor =
  | "default"
  | "primary"
  | "secondary"
  | "error"
  | "info"
  | "success"
  | "warning";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  return formatTime(iso);
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

const TODO_PRIORITY_COLORS: Record<Todo["priority"], "default" | "warning" | "error"> = {
  low: "default",
  medium: "warning",
  high: "error",
};

function todoPriorityLabel(p: Todo["priority"]): string {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function getFeedingChipColor(type: string): ChipColor {
  if (type === "bottle") return "primary";
  if (type.startsWith("breast") || type === "fortified_breast_milk")
    return "secondary";
  if (type === "solid") return "success";
  return "default";
}

function getDiaperChipColor(type: string): ChipColor {
  if (type === "wet") return "info";
  if (type === "solid") return "warning";
  if (type === "both") return "secondary";
  return "default";
}

function getGreeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

function formatAge(birthDate: string): string {
  const birth = new Date(birthDate);
  const now = new Date();
  const diffMs = now.getTime() - birth.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 8) {
    if (diffWeeks < 1) return diffDays === 1 ? "1 day old" : `${diffDays} days old`;
    return diffWeeks === 1 ? "1 week old" : `${diffWeeks} weeks old`;
  }
  // Months calculation: use calendar months
  let months =
    (now.getFullYear() - birth.getFullYear()) * 12 +
    (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) months--;
  if (months < 12) return months === 1 ? "1 month old" : `${months} months old`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (remMonths === 0) return years === 1 ? "1 year old" : `${years} years old`;
  return `${years}y ${remMonths}m old`;
}

export default function Dashboard() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [feedings, setFeedings] = useState<Feeding[]>([]);
  const [diapers, setDiapers] = useState<DiaperChange[]>([]);
  const [sleeps, setSleeps] = useState<SleepEntry[]>([]);
  const [timers, setTimers] = useState<Timer[]>([]);
  const [tummyTimes, setTummyTimes] = useState<TummyTime[]>([]);
  const [pumpings, setPumpings] = useState<Pumping[]>([]);
  const [growths, setGrowths] = useState<Growth[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [activityTab, setActivityTab] = useState(0);

  // Quick action dialog state
  const [feedingDialogOpen, setFeedingDialogOpen] = useState(false);
  const [feedingForm, setFeedingForm] = useState({
    type: "bottle",
    start_time: "",
    end_time: "",
    amount: "",
    amount_unit: "oz",
    notes: "",
  });

  const [diaperDialogOpen, setDiaperDialogOpen] = useState(false);
  const [diaperForm, setDiaperForm] = useState({ time: "", type: "wet", color: "", notes: "" });

  const [sleepDialogOpen, setSleepDialogOpen] = useState(false);
  const [sleepForm, setSleepForm] = useState({ start_time: "", end_time: "", is_nap: false, notes: "" });

  const reloadAll = async (childId: number) => {
    const [f, d, s, t, tt, p, g, td] = await Promise.all([
      api.get<Feeding[]>(`/feedings?child_id=${childId}&limit=500`),
      api.get<DiaperChange[]>(`/diaper-changes?child_id=${childId}&limit=500`),
      api.get<SleepEntry[]>(`/sleep?child_id=${childId}&limit=500`),
      api.get<Timer[]>(`/timers?child_id=${childId}&active=true`),
      api.get<TummyTime[]>(`/tummy-time?child_id=${childId}&limit=500`),
      api.get<Pumping[]>(`/pumping?child_id=${childId}&limit=500`),
      api.get<Growth[]>(`/growth?child_id=${childId}&limit=100`),
      api.get<Todo[]>(`/todos?child_id=${childId}&limit=200`),
    ]);
    setFeedings(f);
    setDiapers(d);
    setSleeps(s);
    setTimers(t);
    setTummyTimes(tt);
    setPumpings(p);
    setGrowths(g);
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
    const payload = {
      type: feedingForm.type,
      start_time: new Date(feedingForm.start_time).toISOString(),
      end_time: feedingForm.end_time ? new Date(feedingForm.end_time).toISOString() : null,
      amount: feedingForm.amount ? parseFloat(feedingForm.amount) : null,
      amount_unit: feedingForm.amount ? feedingForm.amount_unit : null,
      notes: feedingForm.notes || null,
    };
    try {
      await api.post("/feedings", { child_id: selectedChild.id, ...payload });
      setFeedingDialogOpen(false);
      setFeedingForm({ type: "bottle", start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
      await reloadAll(selectedChild.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save feeding.", "error");
    }
  };

  const handleDiaperSave = async () => {
    if (!selectedChild) return;
    const payload = {
      time: new Date(diaperForm.time).toISOString(),
      type: diaperForm.type,
      color: diaperForm.color || null,
      notes: diaperForm.notes || null,
    };
    try {
      await api.post("/diaper-changes", { child_id: selectedChild.id, ...payload });
      setDiaperDialogOpen(false);
      setDiaperForm({ time: "", type: "wet", color: "", notes: "" });
      await reloadAll(selectedChild.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save diaper change.", "error");
    }
  };

  const handleSleepSave = async () => {
    if (!selectedChild) return;
    const payload = {
      start_time: new Date(sleepForm.start_time).toISOString(),
      end_time: sleepForm.end_time ? new Date(sleepForm.end_time).toISOString() : null,
      is_nap: sleepForm.is_nap ? 1 : 0,
      notes: sleepForm.notes || null,
    };
    try {
      await api.post("/sleep", { child_id: selectedChild.id, ...payload });
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

  const greeting = useMemo(() => getGreeting(new Date().getHours()), []);

  if (!selectedChild) {
    return <NoChildPlaceholder />;
  }

  // Today's stats
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();
  const todayFeedings = feedings.filter((f) => f.start_time >= todayStartIso);
  const todayDiapers = diapers.filter((d) => d.time >= todayStartIso);
  const todayFeedingOz = todayFeedings.reduce(
    (sum, f) => (f.amount && f.amount_unit === "oz" ? sum + f.amount : sum),
    0
  );
  const lastFeeding = feedings[0] ?? null;
  const activeSleep = sleeps.find((s) => !s.end_time) ?? null;
  const lastCompletedSleep = sleeps.find((s) => s.end_time) ?? null;

  const recentFeedings = feedings.slice(0, 5);
  const recentDiapers = diapers.slice(0, 5);
  const recentSleeps = sleeps.slice(0, 5);
  const recentTummyTimes = tummyTimes.slice(0, 5);
  const recentPumpings = pumpings.slice(0, 5);
  const recentGrowths = growths.slice(0, 5);

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
    .slice(0, 4);

  const childPhotoUrl = selectedChild.picture_content_type
    ? `${API_BASE}/children/${selectedChild.id}/photo?v=${encodeURIComponent(selectedChild.updated_at)}`
    : undefined;

  const statCards = [
    {
      icon: <RestaurantIcon />,
      color: theme.palette.primary.main,
      value: lastFeeding ? formatRelativeTime(lastFeeding.start_time) : "—",
      label: "Last feeding",
      sub: lastFeeding ? prettifyType(lastFeeding.type) : undefined,
    },
    {
      icon: <RestaurantIcon />,
      color: theme.palette.info.main,
      value: String(todayFeedings.length),
      label: "Feedings today",
      sub: todayFeedingOz > 0 ? `${todayFeedingOz} oz` : undefined,
    },
    {
      icon: <BabyChangingStationIcon />,
      color: theme.palette.warning.main,
      value: String(todayDiapers.length),
      label: "Diapers today",
      sub: undefined,
    },
    {
      icon: <BedtimeIcon />,
      color: theme.palette.secondary.main,
      value: activeSleep
        ? formatDuration(activeSleep.start_time, null)
        : lastCompletedSleep
        ? formatDuration(lastCompletedSleep.start_time, lastCompletedSleep.end_time)
        : "—",
      label: activeSleep
        ? "Sleeping now"
        : lastCompletedSleep
        ? lastCompletedSleep.is_nap
          ? "Last nap"
          : "Last night"
        : "Last sleep",
      sub: activeSleep
        ? `Since ${formatRelativeTime(activeSleep.start_time)}`
        : lastCompletedSleep?.end_time
        ? `Ended ${formatRelativeTime(lastCompletedSleep.end_time)}`
        : undefined,
    },
  ];

  type QuickLogTile = {
    name: string;
    label: string;
    icon: typeof RestaurantIcon;
    color: string;
    onClick: () => void;
  };

  const quickLogTiles: QuickLogTile[] = [
    {
      name: "Feeding",
      label: "Feeding",
      icon: RestaurantIcon,
      color: theme.palette.primary.main,
      onClick: () => {
        setFeedingForm({ type: "bottle", start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
        setFeedingDialogOpen(true);
      },
    },
    {
      name: "Diaper",
      label: "Diaper",
      icon: BabyChangingStationIcon,
      color: theme.palette.warning.main,
      onClick: () => {
        setDiaperForm({ time: "", type: "wet", color: "", notes: "" });
        setDiaperDialogOpen(true);
      },
    },
    {
      name: "Sleep",
      label: "Sleep",
      icon: BedtimeIcon,
      color: theme.palette.secondary.main,
      onClick: () => {
        setSleepForm({ start_time: "", end_time: "", is_nap: false, notes: "" });
        setSleepDialogOpen(true);
      },
    },
    {
      name: "Tummy Time",
      label: "Tummy Time",
      icon: AccessibilityNewIcon,
      color: theme.palette.success.main,
      onClick: () => navigate("/tummy-time"),
    },
    {
      name: "Pumping",
      label: "Pumping",
      icon: OpacityIcon,
      color: theme.palette.info.main,
      onClick: () => navigate("/pumping"),
    },
    {
      name: "Temperature",
      label: "Temperature",
      icon: ThermostatIcon,
      color: theme.palette.error.main,
      onClick: () => navigate("/temperature"),
    },
    {
      name: "Notes",
      label: "Notes",
      icon: NoteIcon,
      color: theme.palette.text.secondary,
      onClick: () => navigate("/notes"),
    },
    {
      name: "Timer",
      label: "Timer",
      icon: TimerIcon,
      color: theme.palette.primary.main,
      onClick: () => navigate("/timers"),
    },
  ];

  // ── Recent activity sections (reused by mobile tabs + desktop grid) ──
  const renderFeedingList = () =>
    recentFeedings.length === 0 ? (
      <Typography color="text.secondary" variant="body2">
        No feedings recorded yet.
      </Typography>
    ) : (
      recentFeedings.map((f, idx) => (
        <Box key={f.id}>
          {idx > 0 && <Divider />}
          <Box
            sx={{
              py: 0.75,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
              <Chip
                label={prettifyType(f.type)}
                size="small"
                color={getFeedingChipColor(f.type)}
                sx={{ flexShrink: 0, fontSize: "0.7rem" }}
              />
              <Typography variant="body2" color="text.secondary" noWrap>
                {formatRelativeTime(f.start_time)}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
              {f.amount != null
                ? `${f.amount}${f.amount_unit ? ` ${f.amount_unit}` : ""} · ${formatDuration(f.start_time, f.end_time)}`
                : formatDuration(f.start_time, f.end_time)}
            </Typography>
          </Box>
        </Box>
      ))
    );

  const renderDiaperList = () =>
    recentDiapers.length === 0 ? (
      <Typography color="text.secondary" variant="body2">
        No diaper changes recorded yet.
      </Typography>
    ) : (
      recentDiapers.map((d, idx) => (
        <Box key={d.id}>
          {idx > 0 && <Divider />}
          <Box
            sx={{
              py: 0.75,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
              <Chip
                label={prettifyType(d.type)}
                size="small"
                color={getDiaperChipColor(d.type)}
                sx={{ flexShrink: 0, fontSize: "0.7rem" }}
              />
              <Typography variant="body2" color="text.secondary" noWrap>
                {formatRelativeTime(d.time)}
              </Typography>
            </Box>
            {d.color && (
              <Chip label={d.color} size="small" variant="outlined" sx={{ flexShrink: 0 }} />
            )}
          </Box>
        </Box>
      ))
    );

  const renderSleepList = () =>
    recentSleeps.length === 0 ? (
      <Typography color="text.secondary" variant="body2">
        No sleep recorded yet.
      </Typography>
    ) : (
      recentSleeps.map((s, idx) => (
        <Box key={s.id}>
          {idx > 0 && <Divider />}
          <Box
            sx={{
              py: 0.75,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
              <Chip
                label={s.is_nap ? "Nap" : "Night"}
                size="small"
                color={s.is_nap ? "success" : "secondary"}
                sx={{ flexShrink: 0, fontSize: "0.7rem" }}
              />
              <Typography variant="body2" color="text.secondary" noWrap>
                {formatRelativeTime(s.start_time)}
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, alignItems: "center" }}>
              {!s.end_time && (
                <Chip
                  label="Active"
                  size="small"
                  color="success"
                  variant="outlined"
                  sx={{ fontSize: "0.65rem", height: 20 }}
                />
              )}
              <Typography variant="body2" color="text.secondary">
                {formatDuration(s.start_time, s.end_time)}
              </Typography>
            </Stack>
          </Box>
        </Box>
      ))
    );

  const renderTummyTimeList = () =>
    recentTummyTimes.length === 0 ? (
      <Typography color="text.secondary" variant="body2">
        No tummy time recorded yet.
      </Typography>
    ) : (
      recentTummyTimes.map((tt, idx) => (
        <Box key={tt.id}>
          {idx > 0 && <Divider />}
          <Box
            sx={{
              py: 0.75,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {formatRelativeTime(tt.start_time)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
              {formatDuration(tt.start_time, tt.end_time)}
            </Typography>
          </Box>
        </Box>
      ))
    );

  const renderPumpingList = () =>
    recentPumpings.length === 0 ? (
      <Typography color="text.secondary" variant="body2">
        No pumping recorded yet.
      </Typography>
    ) : (
      recentPumpings.map((p, idx) => (
        <Box key={p.id}>
          {idx > 0 && <Divider />}
          <Box
            sx={{
              py: 0.75,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {formatRelativeTime(p.start_time)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
              {p.amount != null
                ? `${p.amount}${p.amount_unit ? ` ${p.amount_unit}` : ""} · ${formatDuration(p.start_time, p.end_time)}`
                : formatDuration(p.start_time, p.end_time)}
            </Typography>
          </Box>
        </Box>
      ))
    );

  const renderGrowthList = () =>
    recentGrowths.length === 0 ? (
      <Typography color="text.secondary" variant="body2">
        No growth records yet.
      </Typography>
    ) : (
      recentGrowths.map((g, idx) => (
        <Box key={g.id}>
          {idx > 0 && <Divider />}
          <Box
            sx={{
              py: 0.75,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {formatTime(g.date)}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexShrink: 0, flexWrap: "wrap" }}>
              {g.weight != null && (
                <Typography variant="body2" color="text.secondary">
                  {g.weight}
                  {g.weight_unit ?? ""}
                </Typography>
              )}
              {g.height != null && (
                <Typography variant="body2" color="text.secondary">
                  {g.height}
                  {g.height_unit ?? ""}
                </Typography>
              )}
            </Stack>
          </Box>
        </Box>
      ))
    );

  const activitySections = [
    { key: "feedings", label: "Feedings", icon: <RestaurantIcon fontSize="small" />, path: "/feedings", render: renderFeedingList },
    { key: "diapers", label: "Diapers", icon: <BabyChangingStationIcon fontSize="small" />, path: "/diapers", render: renderDiaperList },
    { key: "sleep", label: "Sleep", icon: <BedtimeIcon fontSize="small" />, path: "/sleep", render: renderSleepList },
    { key: "tummy", label: "Tummy Time", icon: <AccessibilityNewIcon fontSize="small" />, path: "/tummy-time", render: renderTummyTimeList },
    { key: "pumping", label: "Pumping", icon: <OpacityIcon fontSize="small" />, path: "/pumping", render: renderPumpingList },
    { key: "growth", label: "Growth", icon: <MonitorWeightIcon fontSize="small" />, path: "/growth", render: renderGrowthList },
  ];

  const activeActivity = activitySections[activityTab] ?? activitySections[0];

  // Chart sections: shared rendering for mobile + desktop
  const chartSections: { key: string; label: string; icon: React.ReactNode; node: React.ReactNode }[] = [
    { key: "feedings", label: "Feedings", icon: <RestaurantIcon color="primary" />, node: <FeedingChart feedings={feedings} /> },
    { key: "diapers", label: "Diapers", icon: <BabyChangingStationIcon color="primary" />, node: <DiaperChart diapers={diapers} /> },
    { key: "sleep", label: "Sleep", icon: <BedtimeIcon color="primary" />, node: <SleepChart sleeps={sleeps} /> },
    { key: "tummy", label: "Tummy Time", icon: <AccessibilityNewIcon color="primary" />, node: <TummyTimeChart tummyTimes={tummyTimes} /> },
    { key: "pumping", label: "Pumping", icon: <OpacityIcon color="primary" />, node: <PumpingChart pumpings={pumpings} /> },
    ...(growths.length > 0
      ? [{ key: "growth", label: "Growth", icon: <MonitorWeightIcon color="primary" />, node: <GrowthChart growths={growths} /> }]
      : []),
  ];

  // Override the Charts.tsx fixed 300px height on mobile to keep the page compact.
  // ResponsiveContainer renders an inline height style — only !important wins.
  const chartHeightSx = {
    "& .recharts-responsive-container": {
      height: { xs: "200px !important", md: "300px !important" },
    },
  };

  return (
    <Box>
      {/* Hero greeting card */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, sm: 2.5 },
          mb: { xs: 2, sm: 3 },
          borderRadius: 3,
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.18)} 0%, ${alpha(theme.palette.secondary.main, 0.18)} 100%)`,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
        }}
      >
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Avatar
            src={childPhotoUrl}
            sx={{
              width: { xs: 56, sm: 64 },
              height: { xs: 56, sm: 64 },
              fontSize: { xs: 24, sm: 28 },
              bgcolor: alpha(theme.palette.primary.main, 0.25),
              color: theme.palette.primary.main,
              border: `2px solid ${alpha(theme.palette.background.paper, 0.6)}`,
            }}
          >
            {selectedChild.first_name[0]}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                lineHeight: 1.15,
                fontSize: { xs: "1.25rem", sm: "1.5rem" },
              }}
              noWrap
            >
              {greeting}, {selectedChild.first_name}!
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {formatAge(selectedChild.birth_date)}
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {/* Active Timers */}
      {timers.length > 0 && (
        <Box sx={{ mb: { xs: 2, sm: 3 } }}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            {timers.map((t) => (
              <Chip
                key={t.id}
                icon={<TimerIcon />}
                label={`${t.name} — started ${formatTime(t.start_time)}`}
                color="primary"
                variant="outlined"
              />
            ))}
          </Stack>
        </Box>
      )}

      {/* Today's Summary */}
      <Typography
        variant="subtitle1"
        color="text.secondary"
        sx={{ mb: { xs: 1.5, sm: 2 }, fontWeight: 500 }}
      >
        Today's Summary
      </Typography>

      <Grid container spacing={{ xs: 1.5, sm: 2 }} sx={{ mb: { xs: 2, sm: 3 } }}>
        {statCards.map((stat) => (
          <Grid key={stat.label} size={{ xs: 6, sm: 3 }}>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 1.75, sm: 2 },
                borderRadius: 3,
                bgcolor: alpha(stat.color, 0.08),
                minHeight: { xs: 100, sm: 110 },
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <Box sx={{ color: stat.color, display: "flex" }}>{stat.icon}</Box>
              <Box>
                <Typography
                  sx={{
                    fontWeight: 700,
                    lineHeight: 1.15,
                    fontSize: { xs: "1.75rem", sm: "1.4rem" },
                    color: stat.color,
                  }}
                >
                  {stat.value}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block" }}
                >
                  {stat.label}
                </Typography>
                {stat.sub && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ opacity: 0.75, display: "block" }}
                  >
                    {stat.sub}
                  </Typography>
                )}
              </Box>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {/* To-Do Snapshot */}
      <Card sx={{ mb: { xs: 2, sm: 3 }, borderRadius: 3 }}>
        <CardContent>
          <Stack
            direction="row"
            spacing={1}
            sx={{ mb: snapshotTodos.length > 0 ? 1.5 : 0, alignItems: "center", flexWrap: "wrap", gap: 1 }}
          >
            <ChecklistIcon color="primary" />
            <Typography variant="h6" sx={{ flexShrink: 0 }}>
              To-Do
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
              <Chip
                label={`${activeTodos.length} active`}
                size="small"
                color="primary"
                variant={activeTodos.length > 0 ? "filled" : "outlined"}
              />
              {overdueCount > 0 && (
                <Chip
                  label={`${overdueCount} overdue`}
                  size="small"
                  color="error"
                />
              )}
            </Stack>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => navigate("/todos")}
              sx={{ display: { xs: "none", sm: "inline-flex" } }}
            >
              Add task
            </Button>
            <Tooltip title="View all tasks">
              <IconButton size="small" onClick={() => navigate("/todos")}>
                <ArrowForwardIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          {snapshotTodos.length === 0 ? (
            <Box sx={{ py: 1.5, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary">
                {activeTodos.length === 0 && todos.length > 0
                  ? "All caught up — no active tasks."
                  : "No tasks yet. Tap Add task to create one."}
              </Typography>
            </Box>
          ) : (
            <Grid container spacing={{ xs: 0, sm: 2 }} columnSpacing={{ sm: 4 }}>
              {snapshotTodos.map((t, idx) => {
                const overdue = isTodoOverdue(t);
                return (
                  <Grid key={t.id} size={{ xs: 12, sm: 6 }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        py: 0.75,
                        borderTop: {
                          xs: idx === 0 ? "none" : 1,
                          sm: idx < 2 ? "none" : 1,
                        },
                        borderColor: "divider",
                      }}
                    >
                      <Checkbox
                        checked={!!t.completed}
                        onChange={() => handleTodoToggle(t)}
                        color="primary"
                        size="small"
                        sx={{ ml: -1 }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 500, lineHeight: 1.3 }}
                          noWrap
                        >
                          {t.title}
                        </Typography>
                        {t.due_date && (
                          <Typography
                            variant="caption"
                            color={overdue ? "error" : "text.secondary"}
                            sx={{ fontWeight: overdue ? 600 : 400 }}
                          >
                            {formatTodoDueDate(t.due_date)}
                          </Typography>
                        )}
                      </Box>
                      <Chip
                        label={todoPriorityLabel(t.priority)}
                        size="small"
                        variant="outlined"
                        color={TODO_PRIORITY_COLORS[t.priority]}
                        sx={{ flexShrink: 0, fontSize: "0.7rem" }}
                      />
                    </Box>
                  </Grid>
                );
              })}
            </Grid>
          )}
        </CardContent>
      </Card>

      {/* Quick Log */}
      <Typography
        variant="subtitle1"
        color="text.secondary"
        sx={{ mb: { xs: 1.5, sm: 2 }, fontWeight: 500 }}
      >
        Quick Log
      </Typography>
      <Box
        sx={{
          mb: { xs: 2, sm: 3 },
          display: { xs: "flex", md: "grid" },
          gridTemplateColumns: { md: "repeat(8, 1fr)" },
          gap: { xs: 1.5, sm: 2 },
          overflowX: { xs: "auto", md: "visible" },
          pb: { xs: 1, md: 0 },
          mx: { xs: -2, md: 0 },
          px: { xs: 2, md: 0 },
          // Hide scrollbar but keep scrolling
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {quickLogTiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <ButtonBase
              key={tile.name}
              onClick={tile.onClick}
              aria-label={tile.name}
              sx={{
                flexShrink: 0,
                width: { xs: 100, md: "auto" },
                minWidth: { xs: 100, md: 0 },
                height: 100,
                borderRadius: 3,
                p: 1,
                bgcolor: alpha(tile.color, 0.1),
                border: `1px solid ${alpha(tile.color, 0.2)}`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 0.75,
                transition: "transform 0.15s ease, background-color 0.15s ease",
                "&:hover": {
                  bgcolor: alpha(tile.color, 0.18),
                },
                "&:active": {
                  transform: "scale(0.96)",
                },
              }}
            >
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  bgcolor: alpha(tile.color, 0.2),
                  color: tile.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon fontSize="small" />
              </Box>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 600,
                  color: "text.primary",
                  textAlign: "center",
                  lineHeight: 1.1,
                }}
              >
                {tile.label}
              </Typography>
            </ButtonBase>
          );
        })}
      </Box>

      {/* Recent Activity */}
      <Typography
        variant="subtitle1"
        color="text.secondary"
        sx={{ mb: { xs: 1.5, sm: 2 }, fontWeight: 500 }}
      >
        Recent Activity
      </Typography>

      {isMobile ? (
        <Card sx={{ mb: { xs: 2, sm: 3 }, borderRadius: 3 }}>
          <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Tabs
              value={activityTab}
              onChange={(_, v: number) => setActivityTab(v)}
              variant="scrollable"
              scrollButtons={false}
              sx={{ minHeight: 44 }}
            >
              {activitySections.map((sec) => (
                <Tab
                  key={sec.key}
                  label={sec.label}
                  sx={{ minHeight: 44, textTransform: "none", fontWeight: 500 }}
                />
              ))}
            </Tabs>
          </Box>
          <CardContent>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: "center" }}>
              {activeActivity.icon}
              <Typography variant="h6" sx={{ flex: 1 }}>
                {activeActivity.label}
              </Typography>
              <Tooltip title={`View all ${activeActivity.label.toLowerCase()}`}>
                <IconButton size="small" onClick={() => navigate(activeActivity.path)}>
                  <ArrowForwardIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            {activeActivity.render()}
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={{ xs: 2, sm: 3 }} sx={{ mb: { xs: 2, sm: 3 } }}>
          {activitySections
            // On desktop, skip empty Tummy Time/Pumping/Growth sections like before.
            .filter((sec) => {
              if (sec.key === "tummy") return recentTummyTimes.length > 0;
              if (sec.key === "pumping") return recentPumpings.length > 0;
              if (sec.key === "growth") return recentGrowths.length > 0;
              return true;
            })
            .map((sec) => (
              <Grid key={sec.key} size={{ xs: 12, md: 6 }}>
                <Card sx={{ borderRadius: 3, height: "100%" }}>
                  <CardContent>
                    <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: "center" }}>
                      {sec.icon}
                      <Typography variant="h6" sx={{ flex: 1 }}>
                        {sec.label}
                      </Typography>
                      <Tooltip title={`View all ${sec.label.toLowerCase()}`}>
                        <IconButton size="small" onClick={() => navigate(sec.path)}>
                          <ArrowForwardIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                    {sec.render()}
                  </CardContent>
                </Card>
              </Grid>
            ))}
        </Grid>
      )}

      {/* Charts Section */}
      <Typography variant="h5" sx={{ mt: { xs: 3, sm: 5 }, mb: { xs: 2, sm: 3 } }}>
        Trends (Last 14 Days)
      </Typography>

      <Grid container spacing={{ xs: 1.5, sm: 3 }}>
        {chartSections.map((c) => (
          <Grid key={c.key} size={{ xs: 12, lg: 6 }}>
            <Card sx={{ borderRadius: 3 }}>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center" }}>
                  {c.icon}
                  <Typography variant="h6">{c.label}</Typography>
                </Stack>
                <Box sx={chartHeightSx}>{c.node}</Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Quick Action Dialogs */}

      {/* Add Feeding Dialog */}
      <Dialog open={feedingDialogOpen} onClose={() => setFeedingDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Feeding</DialogTitle>
        <DialogContent>
          <TextField
            select
            margin="dense"
            label="Type"
            fullWidth
            value={feedingForm.type}
            onChange={(e) => setFeedingForm({ ...feedingForm, type: e.target.value })}
          >
            {FEEDING_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>
                {t.label}
              </MenuItem>
            ))}
          </TextField>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField
              margin="dense"
              label="Start Time"
              type="datetime-local"
              sx={{ flex: 1 }}
              required
              slotProps={{ inputLabel: { shrink: true } }}
              value={feedingForm.start_time}
              onChange={(e) => setFeedingForm({ ...feedingForm, start_time: e.target.value })}
            />
            <NowButton onSetNow={(v) => setFeedingForm({ ...feedingForm, start_time: v })} />
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField
              margin="dense"
              label="End Time"
              type="datetime-local"
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
              value={feedingForm.end_time}
              onChange={(e) => setFeedingForm({ ...feedingForm, end_time: e.target.value })}
            />
            <NowButton onSetNow={(v) => setFeedingForm({ ...feedingForm, end_time: v })} />
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              margin="dense"
              label="Amount"
              type="number"
              sx={{ flex: 1 }}
              value={feedingForm.amount}
              onChange={(e) => setFeedingForm({ ...feedingForm, amount: e.target.value })}
            />
            <TextField
              select
              margin="dense"
              label="Unit"
              sx={{ width: 100 }}
              value={feedingForm.amount_unit}
              onChange={(e) => setFeedingForm({ ...feedingForm, amount_unit: e.target.value })}
            >
              <MenuItem value="oz">oz</MenuItem>
              <MenuItem value="ml">ml</MenuItem>
              <MenuItem value="g">g</MenuItem>
            </TextField>
          </Box>
          <TextField
            margin="dense"
            label="Notes"
            fullWidth
            multiline
            rows={2}
            value={feedingForm.notes}
            onChange={(e) => setFeedingForm({ ...feedingForm, notes: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFeedingDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleFeedingSave} variant="contained" disabled={!feedingForm.start_time}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Diaper Dialog */}
      <Dialog open={diaperDialogOpen} onClose={() => setDiaperDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Diaper Change</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField
              margin="dense"
              label="Time"
              type="datetime-local"
              sx={{ flex: 1 }}
              required
              slotProps={{ inputLabel: { shrink: true } }}
              value={diaperForm.time}
              onChange={(e) => setDiaperForm({ ...diaperForm, time: e.target.value })}
            />
            <NowButton onSetNow={(v) => setDiaperForm({ ...diaperForm, time: v })} />
          </Box>
          <TextField
            select
            margin="dense"
            label="Type"
            fullWidth
            value={diaperForm.type}
            onChange={(e) => setDiaperForm({ ...diaperForm, type: e.target.value })}
          >
            <MenuItem value="wet">Wet</MenuItem>
            <MenuItem value="solid">Solid</MenuItem>
            <MenuItem value="both">Both</MenuItem>
          </TextField>
          <TextField
            select
            margin="dense"
            label="Color"
            fullWidth
            value={diaperForm.color}
            onChange={(e) => setDiaperForm({ ...diaperForm, color: e.target.value })}
          >
            <MenuItem value="">None</MenuItem>
            <MenuItem value="black">Black</MenuItem>
            <MenuItem value="brown">Brown</MenuItem>
            <MenuItem value="green">Green</MenuItem>
            <MenuItem value="yellow">Yellow</MenuItem>
            <MenuItem value="white">White</MenuItem>
          </TextField>
          <TextField
            margin="dense"
            label="Notes"
            fullWidth
            multiline
            rows={2}
            value={diaperForm.notes}
            onChange={(e) => setDiaperForm({ ...diaperForm, notes: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDiaperDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDiaperSave} variant="contained" color="warning" disabled={!diaperForm.time}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Sleep Dialog */}
      <Dialog open={sleepDialogOpen} onClose={() => setSleepDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Sleep</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField
              margin="dense"
              label="Start Time"
              type="datetime-local"
              sx={{ flex: 1 }}
              required
              slotProps={{ inputLabel: { shrink: true } }}
              value={sleepForm.start_time}
              onChange={(e) => setSleepForm({ ...sleepForm, start_time: e.target.value })}
            />
            <NowButton onSetNow={(v) => setSleepForm({ ...sleepForm, start_time: v })} />
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField
              margin="dense"
              label="End Time"
              type="datetime-local"
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
              value={sleepForm.end_time}
              onChange={(e) => setSleepForm({ ...sleepForm, end_time: e.target.value })}
            />
            <NowButton onSetNow={(v) => setSleepForm({ ...sleepForm, end_time: v })} />
          </Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={sleepForm.is_nap}
                onChange={(e) => setSleepForm({ ...sleepForm, is_nap: e.target.checked })}
              />
            }
            label="Nap"
          />
          <TextField
            margin="dense"
            label="Notes"
            fullWidth
            multiline
            rows={2}
            value={sleepForm.notes}
            onChange={(e) => setSleepForm({ ...sleepForm, notes: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSleepDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSleepSave} variant="contained" color="secondary" disabled={!sleepForm.start_time}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
