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
import type { DiaperChange } from "../types/models";

export default function DiapersPage() {
  const { selectedChild } = useChildren();
  const [diapers, setDiapers] = useState<DiaperChange[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ time: "", type: "wet", color: "", notes: "" });

  const load = async () => {
    if (!selectedChild) return;
    const data = await api.get<DiaperChange[]>(`/diaper-changes?child_id=${selectedChild.id}`);
    setDiapers(data);
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const handleSave = async () => {
    if (!selectedChild) return;
    await api.post("/diaper-changes", {
      child_id: selectedChild.id,
      time: new Date(form.time).toISOString(),
      type: form.type,
      color: form.color || null,
      notes: form.notes || null,
    });
    setDialogOpen(false);
    setForm({ time: "", type: "wet", color: "", notes: "" });
    await load();
  };

  const handleDelete = async (id: number) => {
    await api.delete(`/diaper-changes/${id}`);
    await load();
  };

  if (!selectedChild) {
    return <Typography color="text.secondary">Select a child first.</Typography>;
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Diaper Changes</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
          Add Change
        </Button>
      </Box>

      <Card>
        <CardContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Color</TableCell>
                  <TableCell>Notes</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {diapers.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{new Date(d.time).toLocaleString()}</TableCell>
                    <TableCell sx={{ textTransform: "capitalize" }}>{d.type}</TableCell>
                    <TableCell sx={{ textTransform: "capitalize" }}>{d.color || "—"}</TableCell>
                    <TableCell>{d.notes || "—"}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => handleDelete(d.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {diapers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography color="text.secondary">No diaper changes recorded.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Diaper Change</DialogTitle>
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
          <TextField
            select
            margin="dense"
            label="Type"
            fullWidth
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
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
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
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
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={!form.time}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
