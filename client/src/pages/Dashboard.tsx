import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
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
  Typography,
  Chip,
  Stack,
  Divider,
  IconButton,
  Paper,
  TextField,
  Tooltip,
  alpha,
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
import { api } from "../api/client";
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

export default function Dashboard() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const navigate = useNavigate();
  const theme = useTheme();
  const [feedings, setFeedings] = useState<Feeding[]>([]);
  const [diapers, setDiapers] = useState<DiaperChange[]>([]);
  const [sleeps, setSleeps] = useState<SleepEntry[]>([]);
  const [timers, setTimers] = useState<Timer[]>([]);
  const [tummyTimes, setTummyTimes] = useState<TummyTime[]>([]);
  const [pumpings, setPumpings] = useState<Pumping[]>([]);
  const [growths, setGrowths] = useState<Growth[]>([]);

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
    const [f, d, s, t, tt, p, g] = await Promise.all([
      api.get<Feeding[]>(`/feedings?child_id=${childId}&limit=500`),
      api.get<DiaperChange[]>(`/diaper-changes?child_id=${childId}&limit=500`),
      api.get<SleepEntry[]>(`/sleep?child_id=${childId}&limit=500`),
      api.get<Timer[]>(`/timers?child_id=${childId}&active=true`),
      api.get<TummyTime[]>(`/tummy-time?child_id=${childId}&limit=500`),
      api.get<Pumping[]>(`/pumping?child_id=${childId}&limit=500`),
      api.get<Growth[]>(`/growth?child_id=${childId}&limit=100`),
    ]);
    setFeedings(f);
    setDiapers(d);
    setSleeps(s);
    setTimers(t);
    setTummyTimes(tt);
    setPumpings(p);
    setGrowths(g);
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

  return (
    <Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5, mb: 2 }}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => {
              setFeedingForm({ type: "bottle", start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
              setFeedingDialogOpen(true);
            }}
          >
            Feeding
          </Button>
          <Button
            variant="contained"
            size="small"
            color="warning"
            startIcon={<AddIcon />}
            onClick={() => {
              setDiaperForm({ time: "", type: "wet", color: "", notes: "" });
              setDiaperDialogOpen(true);
            }}
          >
            Diaper
          </Button>
          <Button
            variant="contained"
            size="small"
            color="secondary"
            startIcon={<AddIcon />}
            onClick={() => {
              setSleepForm({ start_time: "", end_time: "", is_nap: false, notes: "" });
              setSleepDialogOpen(true);
            }}
          >
            Sleep
          </Button>
        </Stack>
      </Box>

      {/* Active Timers */}
      {timers.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
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
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 2, fontWeight: 500 }}>
        Today's Summary
      </Typography>

      {/* Today at a Glance */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {statCards.map((stat) => (
      <Grid key={stat.label} size={{ xs: 6, sm: 3 }}>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 1.5, sm: 2 },
                borderRadius: 3,
                bgcolor: alpha(stat.color, 0.1),
                border: `1px solid ${alpha(stat.color, 0.2)}`,
                height: "100%",
              }}
            >
              <Stack spacing={0.5}>
                <Box sx={{ color: stat.color }}>{stat.icon}</Box>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: "bold",
                    lineHeight: 1.2,
                    fontSize: { xs: "0.95rem", sm: "1.15rem" },
                  }}
                >
                  {stat.value}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {stat.label}
                </Typography>
                {stat.sub && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ opacity: 0.75 }}
                  >
                    {stat.sub}
                  </Typography>
                )}
              </Stack>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {/* Recent Activity Cards */}
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 2, fontWeight: 500 }}>
        Recent Activity
      </Typography>
      <Grid container spacing={3}>
        {/* Feedings */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: "center" }}>
                <RestaurantIcon color="primary" />
                <Typography variant="h6" sx={{ flex: 1 }}>
                  Feedings
                </Typography>
                <Tooltip title="View all feedings">
                  <IconButton size="small" onClick={() => navigate("/feedings")}>
                    <ArrowForwardIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              {recentFeedings.length === 0 ? (
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
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 0.75,
                          minWidth: 0,
                        }}
                      >
                        <Chip
                          label={prettifyType(f.type)}
                          size="small"
                          color={getFeedingChipColor(f.type)}
                          sx={{ flexShrink: 0, fontSize: "0.7rem" }}
                        />
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          noWrap
                        >
                          {formatRelativeTime(f.start_time)}
                        </Typography>
                      </Box>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ flexShrink: 0 }}
                      >
                        {f.amount != null
                          ? `${f.amount}${f.amount_unit ? ` ${f.amount_unit}` : ""} · ${formatDuration(f.start_time, f.end_time)}`
                          : formatDuration(f.start_time, f.end_time)}
                      </Typography>
                    </Box>
                  </Box>
                ))
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Diapers */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: "center" }}>
                <BabyChangingStationIcon color="primary" />
                <Typography variant="h6" sx={{ flex: 1 }}>
                  Diapers
                </Typography>
                <Tooltip title="View all diaper changes">
                  <IconButton size="small" onClick={() => navigate("/diapers")}>
                    <ArrowForwardIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              {recentDiapers.length === 0 ? (
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
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 0.75,
                          minWidth: 0,
                        }}
                      >
                        <Chip
                          label={prettifyType(d.type)}
                          size="small"
                          color={getDiaperChipColor(d.type)}
                          sx={{ flexShrink: 0, fontSize: "0.7rem" }}
                        />
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          noWrap
                        >
                          {formatRelativeTime(d.time)}
                        </Typography>
                      </Box>
                      {d.color && (
                        <Chip
                          label={d.color}
                          size="small"
                          variant="outlined"
                          sx={{ flexShrink: 0 }}
                        />
                      )}
                    </Box>
                  </Box>
                ))
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Sleep */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: "center" }}>
                <BedtimeIcon color="primary" />
                <Typography variant="h6" sx={{ flex: 1 }}>
                  Sleep
                </Typography>
                <Tooltip title="View all sleep entries">
                  <IconButton size="small" onClick={() => navigate("/sleep")}>
                    <ArrowForwardIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              {recentSleeps.length === 0 ? (
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
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 0.75,
                          minWidth: 0,
                        }}
                      >
                        <Chip
                          label={s.is_nap ? "Nap" : "Night"}
                          size="small"
                          color={s.is_nap ? "success" : "secondary"}
                          sx={{ flexShrink: 0, fontSize: "0.7rem" }}
                        />
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          noWrap
                        >
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
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Tummy Time (only if there are entries) */}
        {recentTummyTimes.length > 0 && (
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: "center" }}>
                  <AccessibilityNewIcon color="primary" />
                  <Typography variant="h6" sx={{ flex: 1 }}>
                    Tummy Time
                  </Typography>
                  <Tooltip title="View all tummy time">
                    <IconButton
                      size="small"
                      onClick={() => navigate("/tummy-time")}
                    >
                      <ArrowForwardIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                {recentTummyTimes.map((tt, idx) => (
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
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ flexShrink: 0 }}
                      >
                        {formatDuration(tt.start_time, tt.end_time)}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Pumping (only if there are entries) */}
        {recentPumpings.length > 0 && (
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: "center" }}>
                  <OpacityIcon color="primary" />
                  <Typography variant="h6" sx={{ flex: 1 }}>
                    Pumping
                  </Typography>
                  <Tooltip title="View all pumping">
                    <IconButton
                      size="small"
                      onClick={() => navigate("/pumping")}
                    >
                      <ArrowForwardIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                {recentPumpings.map((p, idx) => (
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
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ flexShrink: 0 }}
                      >
                        {p.amount != null
                          ? `${p.amount}${p.amount_unit ? ` ${p.amount_unit}` : ""} · ${formatDuration(p.start_time, p.end_time)}`
                          : formatDuration(p.start_time, p.end_time)}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {/* Charts Section */}
      <Typography variant="h5" sx={{ mt: 5, mb: 3 }}>
        Trends (Last 14 Days)
      </Typography>

      <Grid container spacing={3}>
        {/* Feeding Trends */}
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center" }}>
                <RestaurantIcon color="primary" />
                <Typography variant="h6">Feedings</Typography>
              </Stack>
              <FeedingChart feedings={feedings} />
            </CardContent>
          </Card>
        </Grid>

        {/* Diaper Trends */}
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center" }}>
                <BabyChangingStationIcon color="primary" />
                <Typography variant="h6">Diapers</Typography>
              </Stack>
              <DiaperChart diapers={diapers} />
            </CardContent>
          </Card>
        </Grid>

        {/* Sleep Trends */}
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center" }}>
                <BedtimeIcon color="primary" />
                <Typography variant="h6">Sleep</Typography>
              </Stack>
              <SleepChart sleeps={sleeps} />
            </CardContent>
          </Card>
        </Grid>

        {/* Tummy Time Trends */}
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center" }}>
                <AccessibilityNewIcon color="primary" />
                <Typography variant="h6">Tummy Time</Typography>
              </Stack>
              <TummyTimeChart tummyTimes={tummyTimes} />
            </CardContent>
          </Card>
        </Grid>

        {/* Pumping Trends */}
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center" }}>
                <OpacityIcon color="primary" />
                <Typography variant="h6">Pumping</Typography>
              </Stack>
              <PumpingChart pumpings={pumpings} />
            </CardContent>
          </Card>
        </Grid>

        {/* Growth Trends */}
        {growths.length > 0 && (
          <Grid size={{ xs: 12, lg: 6 }}>
            <Card>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center" }}>
                  <MonitorWeightIcon color="primary" />
                  <Typography variant="h6">Growth</Typography>
                </Stack>
                <GrowthChart growths={growths} />
              </CardContent>
            </Card>
          </Grid>
        )}
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
