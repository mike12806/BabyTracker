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
import EditIcon from "@mui/icons-material/Edit";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import type { Medication } from "../types/models";
import { isoToLocal } from "../utils/dateTime";

export default function MedicationsPage() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const [entries, setEntries] = useState<Medication[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Medication | null>(null);
  const [form, setForm] = useState({ time: "", name: "", dosage: "", dosage_unit: "", notes: "" });

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<Medication[]>(`/medications?child_id=${selectedChild.id}`);
      setEntries(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load medications.", "error");
    }
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const openAdd = () => {
    setEditingEntry(null);
    setForm({ time: "", name: "", dosage: "", dosage_unit: "", notes: "" });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingEntry(null);
  };

  const handleEdit = (entry: Medication) => {
    setEditingEntry(entry);
    setForm({
      time: isoToLocal(entry.time),
      name: entry.name,
      dosage: entry.dosage !== null ? String(entry.dosage) : "",
      dosage_unit: entry.dosage_unit || "",
      notes: entry.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedChild) return;
    const payload = {
      time: new Date(form.time).toISOString(),
      name: form.name,
      dosage: form.dosage !== "" ? parseFloat(form.dosage) : null,
      dosage_unit: form.dosage_unit || null,
      notes: form.notes || null,
    };
    try {
      if (editingEntry) {
        await api.put(`/medications/${editingEntry.id}`, payload);
      } else {
        await api.post("/medications", { child_id: selectedChild.id, ...payload });
      }
      setDialogOpen(false);
      setEditingEntry(null);
      setForm({ time: "", name: "", dosage: "", dosage_unit: "", notes: "" });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save medication.", "error");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/medications/${id}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete medication.", "error");
    }
  };

  if (!selectedChild) {
    return <NoChildPlaceholder />;
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Medications</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
          Add Medication
        </Button>
      </Box>

      <Card>
        <CardContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Medication</TableCell>
                  <TableCell>Dosage</TableCell>
                  <TableCell>Notes</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{new Date(m.time).toLocaleString()}</TableCell>
                    <TableCell>{m.name}</TableCell>
                    <TableCell>
                      {m.dosage !== null ? `${m.dosage}${m.dosage_unit ? " " + m.dosage_unit : ""}` : "—"}
                    </TableCell>
                    <TableCell>{m.notes || "—"}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => handleEdit(m)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDelete(m.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography color="text.secondary">No medications recorded.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{editingEntry ? "Edit Medication" : "Add Medication"}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField
              margin="dense"
              label="Time"
              type="datetime-local"
              sx={{ flex: 1 }}
              required
              slotProps={{ inputLabel: { shrink: true } }}
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
            <NowButton onSetNow={(v) => setForm({ ...form, time: v })} />
          </Box>
          <TextField
            margin="dense"
            label="Medication Name"
            fullWidth
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              margin="dense"
              label="Dosage"
              type="number"
              sx={{ flex: 1 }}
              value={form.dosage}
              onChange={(e) => setForm({ ...form, dosage: e.target.value })}
            />
            <TextField
              select
              margin="dense"
              label="Unit"
              sx={{ flex: 1 }}
              value={form.dosage_unit}
              onChange={(e) => setForm({ ...form, dosage_unit: e.target.value })}
            >
              <MenuItem value="">—</MenuItem>
              <MenuItem value="mg">mg</MenuItem>
              <MenuItem value="mcg">mcg</MenuItem>
              <MenuItem value="g">g</MenuItem>
              <MenuItem value="ml">ml</MenuItem>
              <MenuItem value="oz">oz</MenuItem>
              <MenuItem value="tsp">tsp</MenuItem>
              <MenuItem value="tbsp">tbsp</MenuItem>
              <MenuItem value="IU">IU</MenuItem>
              <MenuItem value="units">units</MenuItem>
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
        <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={!form.time || !form.name}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
