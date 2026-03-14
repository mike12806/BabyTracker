import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import DeleteIcon from "@mui/icons-material/Delete";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import type { Timer } from "../types/models";

export default function TimersPage() {
  const { selectedChild } = useChildren();
  const [timers, setTimers] = useState<Timer[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", notes: "" });

  const load = async () => {
    if (!selectedChild) return;
    const data = await api.get<Timer[]>(`/timers?child_id=${selectedChild.id}`);
    setTimers(data);
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const handleStart = async () => {
    if (!selectedChild) return;
    await api.post("/timers", {
      child_id: selectedChild.id,
      name: form.name,
      notes: form.notes || null,
    });
    setDialogOpen(false);
    setForm({ name: "", notes: "" });
    await load();
  };

  const handleStop = async (id: number) => {
    await api.put(`/timers/${id}/stop`, {});
    await load();
  };

  const handleDelete = async (id: number) => {
    await api.delete(`/timers/${id}`);
    await load();
  };

  if (!selectedChild) {
    return <Typography color="text.secondary">Select a child first.</Typography>;
  }

  const activeTimers = timers.filter((t) => t.is_active);
  const pastTimers = timers.filter((t) => !t.is_active);

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Timers</Typography>
        <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => setDialogOpen(true)}>
          Start Timer
        </Button>
      </Box>

      {/* Active Timers */}
      {activeTimers.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Active
          </Typography>
          <Stack spacing={2}>
            {activeTimers.map((t) => (
              <Card key={t.id} sx={{ borderLeft: 4, borderColor: "primary.main" }}>
                <CardContent sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Box>
                    <Typography variant="h6">{t.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Started {new Date(t.start_time).toLocaleString()}
                    </Typography>
                    {t.notes && (
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {t.notes}
                      </Typography>
                    )}
                  </Box>
                  <Box>
                    <Chip label="Active" color="primary" size="small" sx={{ mr: 1 }} />
                    <IconButton color="error" onClick={() => handleStop(t.id)}>
                      <StopIcon />
                    </IconButton>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Box>
      )}

      {/* Past Timers */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            History
          </Typography>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Start</TableCell>
                  <TableCell>End</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {pastTimers.map((t) => {
                  const ms = t.end_time
                    ? new Date(t.end_time).getTime() - new Date(t.start_time).getTime()
                    : 0;
                  const mins = Math.round(ms / 60000);
                  const duration = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;

                  return (
                    <TableRow key={t.id}>
                      <TableCell>{t.name}</TableCell>
                      <TableCell>{new Date(t.start_time).toLocaleString()}</TableCell>
                      <TableCell>{t.end_time ? new Date(t.end_time).toLocaleString() : "—"}</TableCell>
                      <TableCell>{duration}</TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => handleDelete(t.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {pastTimers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography color="text.secondary">No timer history.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Start Timer</DialogTitle>
        <DialogContent>
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
