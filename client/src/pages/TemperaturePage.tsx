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
  MenuItem,
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
import type { Temperature } from "../types/models";

export default function TemperaturePage() {
  const { selectedChild } = useChildren();
  const [entries, setEntries] = useState<Temperature[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ time: "", reading: "", reading_unit: "F", notes: "" });

  const load = async () => {
    if (!selectedChild) return;
    const data = await api.get<Temperature[]>(`/temperature?child_id=${selectedChild.id}`);
    setEntries(data);
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const handleSave = async () => {
    if (!selectedChild) return;
    await api.post("/temperature", {
      child_id: selectedChild.id,
      time: new Date(form.time).toISOString(),
      reading: parseFloat(form.reading),
      reading_unit: form.reading_unit,
      notes: form.notes || null,
    });
    setDialogOpen(false);
    setForm({ time: "", reading: "", reading_unit: "F", notes: "" });
    await load();
  };

  const handleDelete = async (id: number) => {
    await api.delete(`/temperature/${id}`);
    await load();
  };

  if (!selectedChild) {
    return <Typography color="text.secondary">Select a child first.</Typography>;
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Temperature</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
          Add Reading
        </Button>
      </Box>

      <Card>
        <CardContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Reading</TableCell>
                  <TableCell>Notes</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{new Date(t.time).toLocaleString()}</TableCell>
                    <TableCell>{t.reading}°{t.reading_unit}</TableCell>
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
                    <TableCell colSpan={4} align="center">
                      <Typography color="text.secondary">No temperature readings recorded.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Temperature Reading</DialogTitle>
        <DialogContent>
          <TextField
            margin="dense"
            label="Time"
            type="datetime-local"
            fullWidth
            required
            slotProps={{ inputLabel: { shrink: true } }}
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
          />
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              margin="dense"
              label="Temperature"
              type="number"
              required
              sx={{ flex: 1 }}
              value={form.reading}
              onChange={(e) => setForm({ ...form, reading: e.target.value })}
            />
            <TextField
              select
              margin="dense"
              label="Unit"
              sx={{ width: 100 }}
              value={form.reading_unit}
              onChange={(e) => setForm({ ...form, reading_unit: e.target.value })}
            >
              <MenuItem value="F">°F</MenuItem>
              <MenuItem value="C">°C</MenuItem>
            </TextField>
          </Box>
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
          <Button onClick={handleSave} variant="contained" disabled={!form.time || !form.reading}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
