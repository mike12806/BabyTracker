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

import type { Feeding } from "../types/models";
import { isoToLocal } from "../utils/dateTime";

const FEEDING_TYPES = [
  { value: "breast_left", label: "Breast (Left)" },
  { value: "breast_right", label: "Breast (Right)" },
  { value: "both_breasts", label: "Both Breasts" },
  { value: "bottle", label: "Bottle" },
  { value: "solid", label: "Solid Food" },
  { value: "fortified_breast_milk", label: "Fortified Breast Milk" },
];

export default function FeedingsPage() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const [feedings, setFeedings] = useState<Feeding[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Feeding | null>(null);
  const [form, setForm] = useState({
    type: "bottle",
    start_time: "",
    end_time: "",
    amount: "",
    amount_unit: "oz",
    notes: "",
  });

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<Feeding[]>(`/feedings?child_id=${selectedChild.id}`);
      setFeedings(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load feedings.", "error");
    }
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const handleEdit = (entry: Feeding) => {
    setEditingEntry(entry);
    setForm({
      type: entry.type,
      start_time: isoToLocal(entry.start_time),
      end_time: entry.end_time ? isoToLocal(entry.end_time) : "",
      amount: entry.amount != null ? String(entry.amount) : "",
      amount_unit: entry.amount_unit || "oz",
      notes: entry.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedChild) return;
    const payload = {
      type: form.type,
      start_time: new Date(form.start_time).toISOString(),
      end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
      amount: form.amount ? parseFloat(form.amount) : null,
      amount_unit: form.amount ? form.amount_unit : null,
      notes: form.notes || null,
    };
    try {
      if (editingEntry) {
        await api.put(`/feedings/${editingEntry.id}`, payload);
      } else {
        await api.post("/feedings", { child_id: selectedChild.id, ...payload });
      }
      setDialogOpen(false);
      setEditingEntry(null);
      setForm({ type: "bottle", start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save feeding.", "error");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/feedings/${id}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete feeding.", "error");
    }
  };

  if (!selectedChild) {

    return <NoChildPlaceholder />;

  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Feedings</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingEntry(null);
            setForm({ type: "bottle", start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
            setDialogOpen(true);
          }}
        >
          Add Feeding
        </Button>
      </Box>

      <Card>
        <CardContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Start</TableCell>
                  <TableCell>End</TableCell>
                  <TableCell>Amount</TableCell>
                  <TableCell>Notes</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {feedings.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>{f.type.replace(/_/g, " ")}</TableCell>
                    <TableCell>{new Date(f.start_time).toLocaleString()}</TableCell>
                    <TableCell>{f.end_time ? new Date(f.end_time).toLocaleString() : "—"}</TableCell>
                    <TableCell>{f.amount ? `${f.amount} ${f.amount_unit}` : "—"}</TableCell>
                    <TableCell>{f.notes || "—"}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => handleEdit(f)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDelete(f.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {feedings.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography color="text.secondary">No feedings recorded.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditingEntry(null); }} maxWidth="sm" fullWidth>
        <DialogTitle>{editingEntry ? "Edit Feeding" : "Add Feeding"}</DialogTitle>
        <DialogContent>
          <TextField
            select
            margin="dense"
            label="Type"
            fullWidth
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
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
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            />
            <NowButton onSetNow={(v) => setForm({ ...form, start_time: v })} />
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField
              margin="dense"
              label="End Time"
              type="datetime-local"
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
              value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            />
            <NowButton onSetNow={(v) => setForm({ ...form, end_time: v })} />
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              margin="dense"
              label="Amount"
              type="number"
              sx={{ flex: 1 }}
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
            <TextField
              select
              margin="dense"
              label="Unit"
              sx={{ width: 100 }}
              value={form.amount_unit}
              onChange={(e) => setForm({ ...form, amount_unit: e.target.value })}
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
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDialogOpen(false); setEditingEntry(null); }}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={!form.start_time}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
