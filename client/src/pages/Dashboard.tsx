import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  Chip,
  Stack,
  Divider,
  IconButton,
  Paper,
  Tooltip,
  alpha,
  useTheme,
} from "@mui/material";
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
  const navigate = useNavigate();
  const theme = useTheme();
  const [feedings, setFeedings] = useState<Feeding[]>([]);
  const [diapers, setDiapers] = useState<DiaperChange[]>([]);
  const [sleeps, setSleeps] = useState<SleepEntry[]>([]);
  const [timers, setTimers] = useState<Timer[]>([]);
  const [tummyTimes, setTummyTimes] = useState<TummyTime[]>([]);
  const [pumpings, setPumpings] = useState<Pumping[]>([]);
  const [growths, setGrowths] = useState<Growth[]>([]);

  useEffect(() => {
    if (!selectedChild) return;
    const childId = selectedChild.id;
    // Fetch recent items for cards + enough history for charts (last 14 days)
    Promise.all([
      api.get<Feeding[]>(`/feedings?child_id=${childId}&limit=500`),
      api.get<DiaperChange[]>(`/diaper-changes?child_id=${childId}&limit=500`),
      api.get<SleepEntry[]>(`/sleep?child_id=${childId}&limit=500`),
      api.get<Timer[]>(`/timers?child_id=${childId}&active=true`),
      api.get<TummyTime[]>(`/tummy-time?child_id=${childId}&limit=500`),
      api.get<Pumping[]>(`/pumping?child_id=${childId}&limit=500`),
      api.get<Growth[]>(`/growth?child_id=${childId}&limit=100`),
    ]).then(([f, d, s, t, tt, p, g]) => {
      setFeedings(f);
      setDiapers(d);
      setSleeps(s);
      setTimers(t);
      setTummyTimes(tt);
      setPumpings(p);
      setGrowths(g);
    });
  }, [selectedChild]);

  if (!selectedChild) {
    return (
      <Box sx={{ textAlign: "center", mt: 8 }}>
        <Typography variant="h5" gutterBottom>
          Welcome to Baby Tracker
        </Typography>
        <Typography color="text.secondary">
          Add a child to get started.
        </Typography>
      </Box>
    );
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
      <Typography variant="h4" gutterBottom>
        {selectedChild.first_name}'s Dashboard
      </Typography>

      {/* Active Timers */}
      {timers.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Stack direction="row" spacing={1} flexWrap="wrap">
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
                  fontWeight="bold"
                  sx={{
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
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
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
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
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
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
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
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
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
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
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
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
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
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
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
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
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
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
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
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
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
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
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
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                  <MonitorWeightIcon color="primary" />
                  <Typography variant="h6">Growth</Typography>
                </Stack>
                <GrowthChart growths={growths} />
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
