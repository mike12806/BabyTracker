import { useEffect, useState, type MouseEvent } from "react";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import MedicationIcon from "@mui/icons-material/Medication";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import type { Medication } from "../types/models";
import { isoToLocal } from "../utils/dateTime";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function formatDose(m: Medication): string {
  const parts: string[] = [];
  if (m.dosage !== null) {
    parts.push(`${m.dosage}${m.dosage_unit ? " " + m.dosage_unit : ""}`);
  }
  parts.push(m.name);
  return parts.join(" ");
}

export default function MedicationsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const [entries, setEntries] = useState<Medication[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Medication | null>(null);
  const [form, setForm] = useState({ time: "", name: "", dosage: "", dosage_unit: "", notes: "" });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuEntry, setMenuEntry] = useState<Medication | null>(null);

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

  const openMenu = (e: MouseEvent<HTMLElement>, entry: Medication) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuEntry(entry);
  };

  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuEntry(null);
  };

  const handleMenuEdit = () => {
    if (menuEntry) handleEdit(menuEntry);
    closeMenu();
  };

  const handleMenuDelete = () => {
    if (menuEntry) handleDelete(menuEntry.id);
    closeMenu();
  };

  if (!selectedChild) {
    return <NoChildPlaceholder />;
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Medications</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openAdd}
          sx={{ display: { xs: "none", md: "inline-flex" } }}
        >
          Add Medication
        </Button>
      </Box>

      {/* Desktop / md+ table */}
      <Card sx={{ display: { xs: "none", md: "block" } }}>
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

      {/* Mobile card stack */}
      <Box sx={{ display: { xs: "block", md: "none" } }}>
        {entries.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              py: 8,
              px: 3,
              color: "text.secondary",
            }}
          >
            <MedicationIcon sx={{ fontSize: 64, mb: 2, color: "info.main", opacity: 0.6 }} />
            <Typography variant="h6" sx={{ mb: 0.5 }}>
              No medications recorded yet
            </Typography>
            <Typography variant="body2">Tap + to log the first one</Typography>
          </Box>
        ) : (
          <Stack spacing={1.5} sx={{ pb: 12 }}>
            {entries.map((m) => (
              <Card key={m.id} sx={{ position: "relative", borderRadius: 2 }}>
                <CardActionArea onClick={() => handleEdit(m)} sx={{ minHeight: 44 }}>
                  <CardContent sx={{ pr: 7 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1, gap: 1 }}>
                      <Chip
                        color="info"
                        icon={<MedicationIcon />}
                        label={m.name}
                        size="small"
                        sx={{ maxWidth: "70%", fontWeight: 600 }}
                      />
                      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                        {relativeTime(m.time)}
                      </Typography>
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: 600, lineHeight: 1.2, mb: 0.5 }}>
                      {formatDose(m)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatTime(m.time)}
                    </Typography>
                    {m.notes && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          mt: 0.75,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {m.notes}
                      </Typography>
                    )}
                  </CardContent>
                </CardActionArea>
                <IconButton
                  aria-label="more actions"
                  onClick={(e) => openMenu(e, m)}
                  sx={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 44,
                    height: 44,
                  }}
                >
                  <MoreVertIcon />
                </IconButton>
              </Card>
            ))}
          </Stack>
        )}
      </Box>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={handleMenuEdit} sx={{ minHeight: 44 }}>
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem onClick={handleMenuDelete} sx={{ minHeight: 44, color: "error.main" }}>
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      <Fab
        color="primary"
        aria-label="add medication"
        onClick={openAdd}
        sx={{
          position: "fixed",
          bottom: { xs: "calc(56px + env(safe-area-inset-bottom) + 16px)", md: 24 },
          right: 16,
          display: { xs: "flex", md: "none" },
        }}
      >
        <AddIcon />
      </Fab>

      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
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
