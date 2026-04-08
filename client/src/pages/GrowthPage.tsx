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
import NoChildSelected from "../components/NoChildSelected";
import type { Growth } from "../types/models";

export default function GrowthPage() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const [entries, setEntries] = useState<Growth[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Growth | null>(null);
  const [form, setForm] = useState({
    date: "",
    weight: "",
    weight_unit: "lb",
    height: "",
    height_unit: "in",
    head_circumference: "",
    head_circumference_unit: "in",
    notes: "",
  });

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<Growth[]>(`/growth?child_id=${selectedChild.id}`);
      setEntries(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load growth measurements.", "error");
    }
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const handleEdit = (entry: Growth) => {
    setEditingEntry(entry);
    setForm({
      date: entry.date,
      weight: entry.weight != null ? String(entry.weight) : "",
      weight_unit: entry.weight_unit || "lb",
      height: entry.height != null ? String(entry.height) : "",
      height_unit: entry.height_unit || "in",
      head_circumference: entry.head_circumference != null ? String(entry.head_circumference) : "",
      head_circumference_unit: entry.head_circumference_unit || "in",
      notes: entry.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedChild) return;
    const payload = {
      date: form.date,
      weight: form.weight ? parseFloat(form.weight) : null,
      weight_unit: form.weight ? form.weight_unit : null,
      height: form.height ? parseFloat(form.height) : null,
      height_unit: form.height ? form.height_unit : null,
      head_circumference: form.head_circumference ? parseFloat(form.head_circumference) : null,
      head_circumference_unit: form.head_circumference ? form.head_circumference_unit : null,
      notes: form.notes || null,
    };
    try {
      if (editingEntry) {
        await api.put(`/growth/${editingEntry.id}`, payload);
      } else {
        await api.post("/growth", { child_id: selectedChild.id, ...payload });
      }
      setDialogOpen(false);
      setEditingEntry(null);
      setForm({ date: "", weight: "", weight_unit: "lb", height: "", height_unit: "in", head_circumference: "", head_circumference_unit: "in", notes: "" });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save growth measurement.", "error");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/growth/${id}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete growth measurement.", "error");
    }
  };

  if (!selectedChild) {
    return <NoChildSelected />;
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Growth</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingEntry(null);
            setForm({ date: "", weight: "", weight_unit: "lb", height: "", height_unit: "in", head_circumference: "", head_circumference_unit: "in", notes: "" });
            setDialogOpen(true);
          }}
        >
          Add Measurement
        </Button>
      </Box>

      <Card>
        <CardContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Weight</TableCell>
                  <TableCell>Height</TableCell>
                  <TableCell>Head</TableCell>
                  <TableCell>Notes</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>{new Date(g.date).toLocaleDateString()}</TableCell>
                    <TableCell>{g.weight ? `${g.weight} ${g.weight_unit}` : "—"}</TableCell>
                    <TableCell>{g.height ? `${g.height} ${g.height_unit}` : "—"}</TableCell>
                    <TableCell>{g.head_circumference ? `${g.head_circumference} ${g.head_circumference_unit}` : "—"}</TableCell>
                    <TableCell>{g.notes || "—"}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => handleEdit(g)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDelete(g.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography color="text.secondary">No growth measurements recorded.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditingEntry(null); }} maxWidth="sm" fullWidth>
        <DialogTitle>{editingEntry ? "Edit Growth Measurement" : "Add Growth Measurement"}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField
              margin="dense"
              label="Date"
              type="date"
              sx={{ flex: 1 }}
              required
              slotProps={{ inputLabel: { shrink: true } }}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
            <NowButton type="date" onSetNow={(v) => setForm({ ...form, date: v })} />
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              margin="dense"
              label="Weight"
              type="number"
              sx={{ flex: 1 }}
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: e.target.value })}
            />
            <TextField
              select
              margin="dense"
              label="Unit"
              sx={{ width: 100 }}
              value={form.weight_unit}
              onChange={(e) => setForm({ ...form, weight_unit: e.target.value })}
            >
              <MenuItem value="lb">lb</MenuItem>
              <MenuItem value="kg">kg</MenuItem>
              <MenuItem value="oz">oz</MenuItem>
              <MenuItem value="g">g</MenuItem>
            </TextField>
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              margin="dense"
              label="Height"
              type="number"
              sx={{ flex: 1 }}
              value={form.height}
              onChange={(e) => setForm({ ...form, height: e.target.value })}
            />
            <TextField
              select
              margin="dense"
              label="Unit"
              sx={{ width: 100 }}
              value={form.height_unit}
              onChange={(e) => setForm({ ...form, height_unit: e.target.value })}
            >
              <MenuItem value="in">in</MenuItem>
              <MenuItem value="cm">cm</MenuItem>
            </TextField>
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              margin="dense"
              label="Head Circumference"
              type="number"
              sx={{ flex: 1 }}
              value={form.head_circumference}
              onChange={(e) => setForm({ ...form, head_circumference: e.target.value })}
            />
            <TextField
              select
              margin="dense"
              label="Unit"
              sx={{ width: 100 }}
              value={form.head_circumference_unit}
              onChange={(e) => setForm({ ...form, head_circumference_unit: e.target.value })}
            >
              <MenuItem value="in">in</MenuItem>
              <MenuItem value="cm">cm</MenuItem>
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
          <Button onClick={handleSave} variant="contained" disabled={!form.date}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
