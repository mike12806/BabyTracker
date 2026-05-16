import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
  Grid,
  IconButton,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import DeleteIcon from "@mui/icons-material/Delete";
import TimerIcon from "@mui/icons-material/Timer";
import RestaurantIcon from "@mui/icons-material/Restaurant";
import BedtimeIcon from "@mui/icons-material/Bedtime";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import ChildFriendlyIcon from "@mui/icons-material/ChildFriendly";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import { FAB_BOTTOM_OFFSET } from "../components/Layout";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import { buildCategoryColors } from "../theme/categoryColors";
import type { Timer } from "../types/models";

function humanDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const hr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min === 0 ? `${hr}h` : `${hr}h ${min}m`;
}

function liveElapsed(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  const totalSec = Math.floor(ms / 1000);
  const hr = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const mm = String(min).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return hr > 0 ? `${hr}:${mm}:${ss}` : `${mm}:${ss}`;
}

function relativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ActiveTimerCard({
  timer,
  onStop,
  onDelete,
  gradientFrom,
  gradientTo,
}: {
  timer: Timer;
  onStop: () => void;
  onDelete: () => void;
  gradientFrom: string;
  gradientTo: string;
}) {
  const [, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    intervalRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  return (
    <Card
      sx={{
        background: `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})`,
        border: 1,
        borderColor: "divider",
        borderRadius: 3,
        boxShadow: 2,
        overflow: "hidden",
      }}
    >
      <CardContent sx={{ p: 3 }}>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>{timer.name}</Typography>
        <Typography
          sx={{
            fontSize: "3rem",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.1,
            mb: 0.5,
          }}
        >
          {liveElapsed(timer.start_time)}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Started {relativeTime(timer.start_time)}
        </Typography>
        {timer.notes && (
          <Typography variant="body2" sx={{ mb: 2 }}>{timer.notes}</Typography>
        )}
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            variant="contained"
            color="error"
            size="large"
            startIcon={<StopIcon />}
            onClick={onStop}
            sx={{ flex: 1, minHeight: 48 }}
          >
            Stop
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            size="large"
            onClick={onDelete}
            sx={{ minHeight: 48, minWidth: 48 }}
          >
            <DeleteIcon />
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function TimersPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);

  const [timers, setTimers] = useState<Timer[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", notes: "" });

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<Timer[]>(`/timers?child_id=${selectedChild.id}`);
      setTimers(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load timers.", "error");
    }
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const handleStart = async () => {
    if (!selectedChild) return;
    try {
      await api.post("/timers", { child_id: selectedChild.id, name: form.name, notes: form.notes || null });
      setDialogOpen(false);
      setForm({ name: "", notes: "" });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to start timer.", "error");
    }
  };

  const handleQuickStart = async (name: string) => {
    if (!selectedChild) return;
    try {
      await api.post("/timers", { child_id: selectedChild.id, name, notes: null });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to start timer.", "error");
    }
  };

  const handleStop = async (id: number) => {
    try {
      await api.put(`/timers/${id}/stop`, {});
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to stop timer.", "error");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/timers/${id}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete timer.", "error");
    }
  };

  if (!selectedChild) return <NoChildPlaceholder />;

  const activeTimers = timers.filter((t) => t.is_active);
  const pastTimers = timers.filter((t) => !t.is_active);

  const quickTiles = [
    { name: "Feeding", icon: <RestaurantIcon sx={{ fontSize: 28 }} />, color: cat.feed },
    { name: "Nap", icon: <BedtimeIcon sx={{ fontSize: 28 }} />, color: cat.sleep },
    { name: "Pump", icon: <WaterDropIcon sx={{ fontSize: 28 }} />, color: cat.pump },
    { name: "Tummy Time", icon: <ChildFriendlyIcon sx={{ fontSize: 28 }} />, color: cat.tummy },
    { name: "Custom", icon: <MoreHorizIcon sx={{ fontSize: 28 }} />, color: cat.note },
  ];

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Timers</Typography>
        <Button
          variant="contained"
          startIcon={<PlayArrowIcon />}
          onClick={() => setDialogOpen(true)}
          sx={{ display: { xs: "none", md: "inline-flex" } }}
        >
          Start Timer
        </Button>
      </Box>

      {/* Active timers */}
      {activeTimers.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography
            sx={{
              fontSize: 12,
              color: "text.secondary",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              mb: 1.5,
            }}
          >
            Active
          </Typography>
          <Grid container spacing={2}>
            {activeTimers.map((t) => (
              <Grid key={t.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <ActiveTimerCard
                  timer={t}
                  onStop={() => handleStop(t.id)}
                  onDelete={() => handleDelete(t.id)}
                  gradientFrom={cat.sleep.tile}
                  gradientTo={cat.pump.tile}
                />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* Start a new timer grid */}
      <Typography
        sx={{
          fontSize: 12,
          color: "text.secondary",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          mb: 1.5,
        }}
      >
        Start a new timer
      </Typography>
      <Grid container spacing={1.5} sx={{ mb: 3 }}>
        {quickTiles.map((tile) => (
          <Grid key={tile.name} size={{ xs: 4, sm: 4, md: 2.4 }}>
            <Card
              sx={{
                bgcolor: tile.color.tile,
                border: 1,
                borderColor: tile.color.edge,
                borderRadius: 3,
                boxShadow: 1,
                cursor: "pointer",
                transition: "transform 0.1s, box-shadow 0.1s",
                "&:hover": { transform: "translateY(-2px)", boxShadow: 3 },
                "&:active": { transform: "translateY(0)" },
              }}
              onClick={() => {
                if (tile.name === "Custom") {
                  setDialogOpen(true);
                } else {
                  handleQuickStart(tile.name);
                }
              }}
            >
              <CardContent sx={{ textAlign: "center", py: 2.5, px: 1, "&:last-child": { pb: 2.5 } }}>
                <Box sx={{ color: tile.color.solid, mb: 1, display: "flex", justifyContent: "center" }}>
                  {tile.icon}
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                  {tile.name}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {timers.length === 0 && (
        <Box sx={{ textAlign: "center", py: 6, px: 3, color: "text.secondary" }}>
          <TimerIcon sx={{ fontSize: 72, opacity: 0.25, mb: 2 }} />
          <Typography variant="h6" gutterBottom>No timers yet</Typography>
          <Typography variant="body2">Pick a category above or tap + to start one.</Typography>
        </Box>
      )}

      {/* Past timers */}
      {pastTimers.length > 0 && (
        <>
          <Typography
            sx={{
              fontSize: 12,
              color: "text.secondary",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              mb: 1.5,
            }}
          >
            History
          </Typography>

          <Stack sx={{ gap: 1.5, pb: 12 }}>
            {pastTimers.map((t) => {
              const ms = t.end_time
                ? new Date(t.end_time).getTime() - new Date(t.start_time).getTime()
                : 0;
              return (
                <Card
                  key={t.id}
                  sx={{
                    bgcolor: "background.paper",
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 3,
                    boxShadow: 1,
                  }}
                >
                  <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
                          {t.name}
                        </Typography>
                        <Typography variant="h6" sx={{ fontVariantNumeric: "tabular-nums", color: "text.secondary" }}>
                          {humanDuration(ms)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "text.disabled", fontVariantNumeric: "tabular-nums" }}>
                          {relativeTime(t.start_time)}
                        </Typography>
                      </Box>
                      <IconButton
                        onClick={() => handleDelete(t.id)}
                        sx={{ minWidth: 44, minHeight: 44 }}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Box>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        </>
      )}

      <Fab
        color="primary"
        aria-label="Start timer"
        onClick={() => setDialogOpen(true)}
        sx={{ position: "fixed", bottom: { xs: FAB_BOTTOM_OFFSET, md: 24 }, right: 16, display: { xs: "flex", md: "none" } }}
      >
        <PlayArrowIcon />
      </Fab>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>Start Timer</DialogTitle>
        <DialogContent sx={{ p: 2 }}>
          <TextField
            autoFocus
            margin="dense"
            label="Name"
            fullWidth
            required
            placeholder="e.g. Feeding, Nap, Tummy Time"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <TextField
            margin="dense"
            label="Notes"
            fullWidth
            multiline
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleStart} variant="contained" disabled={!form.name}>
            Start
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
