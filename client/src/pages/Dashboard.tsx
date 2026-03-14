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
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import type { Feeding, DiaperChange, SleepEntry, Timer } from "../types/models";

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

  useEffect(() => {
    if (!selectedChild) return;
    const childId = selectedChild.id;
    Promise.all([
      api.get<Feeding[]>(`/feedings?child_id=${childId}&limit=5`),
      api.get<DiaperChange[]>(`/diaper-changes?child_id=${childId}&limit=5`),
      api.get<SleepEntry[]>(`/sleep?child_id=${childId}&limit=5`),
      api.get<Timer[]>(`/timers?child_id=${childId}&active=true`),
    ]).then(([f, d, s, t]) => {
      setFeedings(f);
      setDiapers(d);
      setSleeps(s);
      setTimers(t);
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

      <Grid container spacing={3}>
        {/* Recent Feedings */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <RestaurantIcon color="primary" />
                <Typography variant="h6">Recent Feedings</Typography>
              </Stack>
              {feedings.length === 0 ? (
                <Typography color="text.secondary">No feedings recorded yet.</Typography>
              ) : (
                feedings.map((f) => (
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

        {/* Recent Diapers */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <BabyChangingStationIcon color="primary" />
                <Typography variant="h6">Recent Diapers</Typography>
              </Stack>
              {diapers.length === 0 ? (
                <Typography color="text.secondary">No diaper changes recorded yet.</Typography>
              ) : (
                diapers.map((d) => (
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

        {/* Recent Sleep */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <BedtimeIcon color="primary" />
                <Typography variant="h6">Recent Sleep</Typography>
              </Stack>
              {sleeps.length === 0 ? (
                <Typography color="text.secondary">No sleep recorded yet.</Typography>
              ) : (
                sleeps.map((s) => (
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
    </Box>
  );
}
