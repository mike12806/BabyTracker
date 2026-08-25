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
import ThermostatIcon from "@mui/icons-material/Thermostat";
import MedicationIcon from "@mui/icons-material/Medication";
import ChecklistIcon from "@mui/icons-material/Checklist";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { api, API_BASE } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useDataRefresh } from "../hooks/useDataRefresh";
import { useNotification } from "../hooks/useNotification";
import ChildHero from "../components/ChildHero";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import QuickLogDialog, { type QuickLogCategory } from "../components/QuickLogDialog";
import { buildCategoryColors, type CategoryKey } from "../theme/categoryColors";
import type { BoopLinePool } from "../utils/childMoments";
import { editEntryPath } from "../utils/activityLinks";
import { mergePending } from "../api/outbox";
import { usePendingRows } from "../hooks/useOutbox";
import PendingChip from "../components/PendingChip";
import { formatRelativeTime } from "../utils/dateTime";
import { sideLabel } from "../utils/pumping";
import { amountTotals, formatAmountTotal, formatEntryAmount } from "../utils/feedingAmount";
import { useVolumeUnit } from "../hooks/useVolumeUnit";
import type {
  Feeding,
  DiaperChange,
  SleepEntry,
  Timer,
  TummyTime,
  Pumping,
  Temperature,
  Note,
  Medication,
  Todo,
} from "../types/models";

function formatDuration(start: string, end: string | null): string {
  const endMs = end ? new Date(end).getTime() : Date.now();
  const ms = endMs - new Date(start).getTime();
  if (ms <= 0) return "0m";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

// "" for entries logged today, otherwise the day they belong to.
function dayLabel(iso: string, todayStart: Date): string {
  const when = new Date(iso);
  if (when >= todayStart) return "";
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  if (when >= yesterdayStart) return "Yesterday";
  return when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function prettifyType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// How long a just-completed to-do stays visible (checked and struck through)
// before the refreshed data drops it out of the snapshot.
const TODO_COMPLETE_HOLD_MS = 450;

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
  temp: <ThermostatIcon sx={{ fontSize: 14 }} />,
  med: <MedicationIcon sx={{ fontSize: 14 }} />,
};

export default function Dashboard() {
  const { selectedChild } = useChildren();
  const { refreshKey, refreshData } = useDataRefresh();
  const { notify } = useNotification();
  const { unit } = useVolumeUnit();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [savedFeedings, setSavedFeedings] = useState<Feeding[]>([]);
  const [savedDiapers, setSavedDiapers] = useState<DiaperChange[]>([]);
  const [savedSleeps, setSavedSleeps] = useState<SleepEntry[]>([]);
  const [timers, setTimers] = useState<Timer[]>([]);
  const [savedTummyTimes, setSavedTummyTimes] = useState<TummyTime[]>([]);
  const [savedPumpings, setSavedPumpings] = useState<Pumping[]>([]);
  const [savedTemperatures, setSavedTemperatures] = useState<Temperature[]>([]);
  const [savedNotes, setSavedNotes] = useState<Note[]>([]);
  const [savedMedications, setSavedMedications] = useState<Medication[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [dailyNote, setDailyNote] = useState<string | null>(null);
  const [dailyNoteSource, setDailyNoteSource] = useState<"ai" | "fallback" | null>(null);
  // The AI-written boop lines (see server/src/scheduled/boopLines.ts) — not
  // per-child, so fetched once for the session rather than on every child
  // switch or refresh. Absent until the first cron run, and the hero card
  // works fine on just its own built-in lines until then.
  const [boopExtras, setBoopExtras] = useState<BoopLinePool | undefined>(undefined);

  const [quickLogCategory, setQuickLogCategory] = useState<QuickLogCategory | null>(null);
  // Ids ticked off from this page but not yet gone from `todos`. The snapshot only
  // lists active tasks, so without this the row would vanish the instant the
  // refetch lands and the tap would read as "nothing happened".
  const [completingTodos, setCompletingTodos] = useState<number[]>([]);

  const handleTodoToggle = async (todo: Todo) => {
    const completed = !todo.completed;
    if (completed) setCompletingTodos((prev) => [...prev, todo.id]);
    try {
      await api.put(`/todos/${todo.id}`, { completed });
      // Hold the checked + struck-through row on screen long enough to be seen.
      if (completed) await new Promise((resolve) => setTimeout(resolve, TODO_COMPLETE_HOLD_MS));
      refreshData();
    } catch (err) {
      setCompletingTodos((prev) => prev.filter((id) => id !== todo.id));
      notify(err instanceof Error ? err.message : "Failed to update todo.", "error");
    }
  };

  // Once per session, not per child — the pool isn't scoped to any one baby.
  // Caught rather than awaited: an older deploy or an empty table must not
  // stop the rest of the dashboard from loading, and the built-in lines in
  // childMoments.ts already cover the case where this never arrives.
  useEffect(() => {
    api
      .getOptional<BoopLinePool>("/boop-lines")
      .then((pool) => pool && setBoopExtras(pool))
      .catch(() => {});
  }, []);

  // Refetches on mount, when the child changes, and whenever `refreshKey` is
  // bumped — logging an entry from anywhere in the app (including the bottom-nav
  // FAB, which renders its dialog outside this page) updates these cards without
  // a page reload.
  useEffect(() => {
    if (!selectedChild) return;
    const childId = selectedChild.id;
    let cancelled = false;
    // Drop the outgoing child's note straight away rather than leaving it under
    // the new child's face until the refetch lands.
    setDailyNote(null);
    setDailyNoteSource(null);

    (async () => {
      try {
        const [f, d, s, t, tt, p, temp, n, m, td, note] = await Promise.all([
          api.get<Feeding[]>(`/feedings?child_id=${childId}&limit=500`),
          api.get<DiaperChange[]>(`/diaper-changes?child_id=${childId}&limit=500`),
          api.get<SleepEntry[]>(`/sleep?child_id=${childId}&limit=500`),
          api.get<Timer[]>(`/timers?child_id=${childId}&active=true`),
          api.get<TummyTime[]>(`/tummy-time?child_id=${childId}&limit=500`),
          api.get<Pumping[]>(`/pumping?child_id=${childId}&limit=500`),
          // Temperatures, notes and medications feed the recent-activity list
          // only — the tiles and today's totals above do not summarise them.
          api.get<Temperature[]>(`/temperature?child_id=${childId}&limit=50`),
          api.get<Note[]>(`/notes?child_id=${childId}&limit=50`),
          api.get<Medication[]>(`/medications?child_id=${childId}&limit=50`),
          api.get<Todo[]>(`/todos?child_id=${childId}&limit=200`),
          // Written once a day by the cron and cached server-side, so this is
          // a plain row read — opening the dashboard never costs a generation.
          //
          // Caught rather than awaited alongside the rest: the note is the one
          // thing on this page nobody needs, and a server that 404s it (an
          // older deploy, a failed migration) must not take the numbers down
          // with it.
          api
            .getOptional<{ note: { body: string; source: "ai" | "fallback" } | null }>(
              `/children/${childId}/daily-note`,
            )
            .catch(() => ({ note: null })),
        ]);
        if (cancelled) return;
        setSavedFeedings(f);
        setSavedDiapers(d);
        setSavedSleeps(s);
        setTimers(t);
        setSavedTummyTimes(tt);
        setSavedPumpings(p);
        setSavedTemperatures(temp);
        setSavedNotes(n);
        setSavedMedications(m);
        setTodos(td);
        setDailyNote(note.note?.body ?? null);
        setDailyNoteSource(note.note?.source ?? null);
      } catch (err) {
        if (!cancelled) notify(err instanceof Error ? err.message : "Failed to load data.", "error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedChild, refreshKey]);

  // Drop the pending markers once the refetched todos confirm the completion.
  useEffect(() => {
    setCompletingTodos((prev) => {
      if (prev.length === 0) return prev;
      const stillActive = prev.filter((id) => todos.some((t) => t.id === id && !t.completed));
      return stillActive.length === prev.length ? prev : stillActive;
    });
  }, [todos]);


  // Entries logged on this device that haven't reached the server yet, folded
  // into the same lists everything below reads. This screen exists to answer
  // "how long since she ate" and "has anyone changed her", and a feed logged
  // ten minutes ago in the corner of the house without signal is part of that
  // answer whether or not the server has heard about it. Each pending row
  // keeps a negative id, which is what stops the rows below linking to an edit
  // form for something the server has never seen — see `outbox.ts`.
  const pendingFeedings = usePendingRows<Feeding>("feedings", selectedChild?.id ?? null);
  const feedings = useMemo(
    () => mergePending(savedFeedings, pendingFeedings, "start_time"),
    [savedFeedings, pendingFeedings],
  );
  const pendingDiapers = usePendingRows<DiaperChange>("diaper_changes", selectedChild?.id ?? null);
  const diapers = useMemo(
    () => mergePending(savedDiapers, pendingDiapers, "time"),
    [savedDiapers, pendingDiapers],
  );
  const pendingSleeps = usePendingRows<SleepEntry>("sleep", selectedChild?.id ?? null);
  const sleeps = useMemo(
    () => mergePending(savedSleeps, pendingSleeps, "start_time"),
    [savedSleeps, pendingSleeps],
  );
  const pendingTummyTimes = usePendingRows<TummyTime>("tummy_time", selectedChild?.id ?? null);
  const tummyTimes = useMemo(
    () => mergePending(savedTummyTimes, pendingTummyTimes, "start_time"),
    [savedTummyTimes, pendingTummyTimes],
  );
  const pendingPumpings = usePendingRows<Pumping>("pumping", selectedChild?.id ?? null);
  const pumpings = useMemo(
    () => mergePending(savedPumpings, pendingPumpings, "start_time"),
    [savedPumpings, pendingPumpings],
  );
  const pendingTemperatures = usePendingRows<Temperature>("temperature", selectedChild?.id ?? null);
  const temperatures = useMemo(
    () => mergePending(savedTemperatures, pendingTemperatures, "time"),
    [savedTemperatures, pendingTemperatures],
  );
  const pendingNotes = usePendingRows<Note>("notes", selectedChild?.id ?? null);
  const notes = useMemo(
    () => mergePending(savedNotes, pendingNotes, "time"),
    [savedNotes, pendingNotes],
  );
  const pendingMedications = usePendingRows<Medication>("medications", selectedChild?.id ?? null);
  const medications = useMemo(
    () => mergePending(savedMedications, pendingMedications, "time"),
    [savedMedications, pendingMedications],
  );

  if (!selectedChild) return <NoChildPlaceholder />;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();
  const todayFeedings = feedings.filter((f) => f.start_time >= todayStartIso);
  const todayDiapers = diapers.filter((d) => d.time >= todayStartIso);
  const todayFeedAmounts = amountTotals(todayFeedings, unit);
  const todayPumpings = pumpings.filter((p) => p.start_time >= todayStartIso);
  const todayPumpAmounts = amountTotals(todayPumpings, unit);
  const todayPumpCount = todayPumpings.length;
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
      detail: lastFeeding ? `${formatEntryAmount(lastFeeding, unit) ?? ""} ${prettifyType(lastFeeding.type)}`.trim() : "",
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
      detail: lastPump ? formatEntryAmount(lastPump, unit) ?? "" : "",
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
    // Headline the amount fed when any was recorded, keeping the feed count as
    // the subtitle; breastfeeding-only days have no amount and stay a count.
    {
      cat: "feed",
      value: todayFeedAmounts.length > 0 ? formatAmountTotal(todayFeedAmounts[0]) : `${todayFeedings.length}`,
      label: todayFeedAmounts.length > 0 ? "fed" : "feeds",
      sub: todayFeedAmounts.length > 0
        ? [
            `${todayFeedings.length} feed${todayFeedings.length === 1 ? "" : "s"}`,
            // A gram total cannot be folded into the volume, so it rides along.
            ...todayFeedAmounts.slice(1).map(formatAmountTotal),
          ].join(" · ")
        : "today",
    },
    { cat: "diaper", value: `${todayDiapers.length}`, label: "diapers", sub: "today" },
    { cat: "sleep", value: formatDuration("", null).replace(/.*/, () => { const h = Math.floor(todaySleepMins / 60); const m = Math.round(todaySleepMins % 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; }), label: "asleep", sub: activeSleep ? "+ active" : "today" },
    {
      cat: "pump",
      value: todayPumpAmounts.length > 0 ? formatAmountTotal(todayPumpAmounts[0]) : `${todayPumpCount}`,
      label: "pumped",
      sub: todayPumpCount > 0 ? `${todayPumpCount} session${todayPumpCount === 1 ? "" : "s"}` : "today",
    },
  ];

  // Each row keeps the entry's real timestamp (`ts`) alongside the formatted
  // clock time it displays: sorting on the formatted string would compare
  // times of day with the date thrown away, which both misorders entries from
  // different days and fails outright in browsers that reject the non-standard
  // date string — leaving the feed in per-category insertion order, so only
  // feedings survived the cutoff.
  const recentActivity: { id: number; cat: CategoryKey; title: string; ts: string; time: string; meta: string; live?: boolean }[] = [];
  const cutoff = 6;
  const clockTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  // The row only shows a time of day, so anything before today says which day.
  const withDay = (meta: string, iso: string) => {
    const day = dayLabel(iso, todayStart);
    if (!day) return meta;
    return meta ? `${meta} · ${day}` : day;
  };
  const allEvents: typeof recentActivity = [];
  feedings.slice(0, 10).forEach((f) => allEvents.push({ id: f.id, cat: "feed", title: `${prettifyType(f.type)}${formatEntryAmount(f, unit) ? ` · ${formatEntryAmount(f, unit)}` : ""}`, ts: f.start_time, time: clockTime(f.start_time), meta: withDay(formatDuration(f.start_time, f.end_time), f.start_time) }));
  diapers.slice(0, 10).forEach((d) => allEvents.push({ id: d.id, cat: "diaper", title: `Diaper · ${prettifyType(d.type)}`, ts: d.time, time: clockTime(d.time), meta: withDay(d.color || "", d.time) }));
  sleeps.slice(0, 10).forEach((s) => allEvents.push({ id: s.id, cat: "sleep", title: s.is_nap ? "Nap" : "Sleep", ts: s.start_time, time: clockTime(s.start_time), meta: s.end_time ? withDay(formatDuration(s.start_time, s.end_time), s.start_time) : `Active · ${formatDuration(s.start_time, null)}`, live: !s.end_time }));
  pumpings.slice(0, 10).forEach((p) => allEvents.push({ id: p.id, cat: "pump", title: `Pump${sideLabel(p.side) ? ` · ${sideLabel(p.side)}` : ""}${formatEntryAmount(p, unit) ? ` · ${formatEntryAmount(p, unit)}` : ""}`, ts: p.start_time, time: clockTime(p.start_time), meta: withDay(formatDuration(p.start_time, p.end_time), p.start_time) }));
  tummyTimes.slice(0, 10).forEach((tt) => allEvents.push({ id: tt.id, cat: "tummy", title: "Tummy time", ts: tt.start_time, time: clockTime(tt.start_time), meta: withDay(formatDuration(tt.start_time, tt.end_time), tt.start_time) }));
  // Point-in-time entries: no duration to show, so the subtitle carries their
  // own detail (mirroring the wording the full activity feed uses).
  temperatures.slice(0, 10).forEach((t) => allEvents.push({ id: t.id, cat: "temp", title: `Temp · ${t.reading}°${t.reading_unit}`, ts: t.time, time: clockTime(t.time), meta: withDay("", t.time) }));
  notes.slice(0, 10).forEach((n) => allEvents.push({ id: n.id, cat: "note", title: `Note · ${n.title || n.content.slice(0, 60)}`, ts: n.time, time: clockTime(n.time), meta: withDay(n.title ? n.content.slice(0, 60) : "", n.time) }));
  medications.slice(0, 10).forEach((m) => allEvents.push({ id: m.id, cat: "med", title: `${m.name}${m.dosage ? ` · ${m.dosage}${m.dosage_unit ? ` ${m.dosage_unit}` : ""}` : ""}`, ts: m.time, time: clockTime(m.time), meta: withDay("", m.time) }));

  allEvents.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  recentActivity.push(...allEvents.slice(0, cutoff));

  const prioCatKey = (p: string): CategoryKey => p === "high" ? "temp" : p === "medium" ? "diaper" : "note";

  return (
    <Box>
      {/* Him, first — before any of the numbers about him. */}
      <ChildHero
        key={selectedChild.id}
        child={selectedChild}
        napping={!!activeSleep}
        cat={cat}
        isDark={isDark}
        dailyNote={dailyNote}
        dailyNoteSource={dailyNoteSource}
        boopExtras={boopExtras}
      />

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
            // A pending row has no server id, so there is no edit form on the
            // other end of a link — the row renders as plain text instead, and
            // the chip says why.
            const pendingRow = ev.id < 0;
            const editPath = pendingRow ? null : editEntryPath(ev.cat, ev.id);
            return (
              // Tapping a row opens that entry's edit form on its section page.
              <Box
                key={`${ev.cat}-${ev.id}`}
                component={editPath ? "button" : "div"}
                type={editPath ? "button" : undefined}
                onClick={editPath ? () => navigate(editPath) : undefined}
                aria-label={editPath ? `Edit ${ev.title} at ${ev.time}` : undefined}
                sx={{
                  display: "flex", alignItems: "center", gap: 1,
                  py: "6px",
                  width: "100%",
                  font: "inherit", color: "inherit", textAlign: "left",
                  bgcolor: "transparent",
                  border: 0,
                  borderBottom: i === recentActivity.length - 1 ? "none" : 1,
                  borderColor: "divider",
                  ...(editPath && { cursor: "pointer" }),
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
                  {pendingRow && <PendingChip compact />}
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
                {editPath && (
                  <ChevronRightIcon sx={{ fontSize: 13, color: "text.disabled", flexShrink: 0 }} />
                )}
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
            const completing = completingTodos.includes(t.id);
            return (
              <Box
                key={t.id}
                sx={{
                  display: "flex", alignItems: "center",
                  borderBottom: i === snapshotTodos.length - 1 ? "none" : 1,
                  borderColor: "divider",
                  opacity: completing ? 0.5 : 1,
                  transition: "opacity 160ms ease",
                }}
              >
                {/* 8px of padding around the 20px control keeps the tap target
                    finger-sized; the negative margin holds the original alignment. */}
                <Checkbox
                  checked={!!t.completed || completing}
                  onChange={() => handleTodoToggle(t)}
                  size="small"
                  slotProps={{ input: { "aria-label": `Mark "${t.title}" complete` } }}
                  sx={{
                    p: 1, ml: "-8px", mr: "-2px",
                    color: "text.disabled",
                    "&.Mui-checked": { color: cat.todo.solid },
                  }}
                />
                <ButtonBase
                  onClick={() => navigate("/todos")}
                  sx={{
                    flex: 1, minWidth: 0,
                    display: "flex", alignItems: "center", gap: 1,
                    py: "6px", px: "4px", borderRadius: 1,
                    textAlign: "left",
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontSize: 12.5, fontWeight: 500, letterSpacing: "-0.005em", lineHeight: 1.2,
                        textDecoration: completing ? "line-through" : "none",
                      }}
                      noWrap
                    >
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
                </ButtonBase>
              </Box>
            );
          })
        )}
      </Box>

      <QuickLogDialog
        category={quickLogCategory}
        onClose={() => setQuickLogCategory(null)}
      />
    </Box>
  );
}
