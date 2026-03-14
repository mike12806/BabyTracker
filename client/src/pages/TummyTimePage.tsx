import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import type { TummyTime } from "../types/models";

export default function TummyTimePage() {
  const { selectedChild } = useChildren();
  const [entries, setEntries] = useState<TummyTime[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ start_time: "", end_time: "", milestone: "", notes: "" });

  const load = async () => {
    if (!selectedChild) return;
    const data = await api.get<TummyTime[]>(`/tummy-time?child_id=${selectedChild.id}`);
    setEntries(data);
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const handleSave = async () => {
    if (!selectedChild) return;
    await api.post("/tummy-time", {
      child_id: selectedChild.id,
      start_time: new Date(form.start_time).toISOString(),
      end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
      milestone: form.milestone || null,
      notes: form.notes || null,
    });
    setDialogOpen(false);
    setForm({ start_time: "", end_time: "", milestone: "", notes: "" });
    await load();
  };

  const handleDelete = async (id: number) => {
    await api.delete(`/tummy-time/${id}`);
    await load();
  };

  if (!selectedChild) {
    return <Typography color="text.secondary">Select a child first.</Typography>;
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Tummy Time</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
          Add Session
        </Button>
      </Box>

      <Card>
        <CardContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Start</TableCell>
                  <TableCell>End</TableCell>
                  <TableCell>Milestone</TableCell>
                  <TableCell>Notes</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{new Date(t.start_time).toLocaleString()}</TableCell>
                    <TableCell>{t.end_time ? new Date(t.end_time).toLocaleString() : "In progress"}</TableCell>
                    <TableCell>{t.milestone || "—"}</TableCell>
                    <TableCell>{t.notes || "—"}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => handleDelete(t.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography color="text.secondary">No tummy time recorded.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Tummy Time</DialogTitle>
        <DialogContent>
          <TextField
            margin="dense"
            label="Start Time"
            type="datetime-local"
            fullWidth
            required
            slotProps={{ inputLabel: { shrink: true } }}
            value={form.start_time}
            onChange={(e) => setForm({ ...form, start_time: e.target.value })}
          />
          <TextField
            margin="dense"
            label="End Time"
            type="datetime-local"
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
            value={form.end_time}
            onChange={(e) => setForm({ ...form, end_time: e.target.value })}
          />
          <TextField
            margin="dense"
            label="Milestone"
            fullWidth
            value={form.milestone}
            onChange={(e) => setForm({ ...form, milestone: e.target.value })}
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
          <Button onClick={handleSave} variant="contained" disabled={!form.start_time}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
