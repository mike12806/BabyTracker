import { useEffect, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Grid2 as Grid,
  Typography,
  Chip,
  Stack,
} from "@mui/material";
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "In progress";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export default function Dashboard() {
  const { selectedChild } = useChildren();
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

  const recentFeedings = feedings.slice(0, 5);
  const recentDiapers = diapers.slice(0, 5);
  const recentSleeps = sleeps.slice(0, 5);

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

      {/* Recent Activity Cards */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <RestaurantIcon color="primary" />
                <Typography variant="h6">Recent Feedings</Typography>
              </Stack>
              {recentFeedings.length === 0 ? (
                <Typography color="text.secondary">No feedings recorded yet.</Typography>
              ) : (
                recentFeedings.map((f) => (
                  <Box key={f.id} sx={{ mb: 1, display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">
                      {f.type.replace(/_/g, " ")} — {formatTime(f.start_time)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatDuration(f.start_time, f.end_time)}
                    </Typography>
                  </Box>
                ))
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <BabyChangingStationIcon color="primary" />
                <Typography variant="h6">Recent Diapers</Typography>
              </Stack>
              {recentDiapers.length === 0 ? (
                <Typography color="text.secondary">No diaper changes recorded yet.</Typography>
              ) : (
                recentDiapers.map((d) => (
                  <Box key={d.id} sx={{ mb: 1, display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">
                      {d.type} — {formatTime(d.time)}
                    </Typography>
                    {d.color && (
                      <Chip label={d.color} size="small" variant="outlined" />
                    )}
                  </Box>
                ))
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <BedtimeIcon color="primary" />
                <Typography variant="h6">Recent Sleep</Typography>
              </Stack>
              {recentSleeps.length === 0 ? (
                <Typography color="text.secondary">No sleep recorded yet.</Typography>
              ) : (
                recentSleeps.map((s) => (
                  <Box key={s.id} sx={{ mb: 1, display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">
                      {s.is_nap ? "Nap" : "Night"} — {formatTime(s.start_time)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatDuration(s.start_time, s.end_time)}
                    </Typography>
                  </Box>
                ))
              )}
            </CardContent>
          </Card>
        </Grid>
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
