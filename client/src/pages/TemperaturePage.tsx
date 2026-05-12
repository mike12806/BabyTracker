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
  Fab,
  IconButton,
  ListItemIcon,
  ListItemText,
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
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ThermostatIcon from "@mui/icons-material/Thermostat";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";

import NoChildPlaceholder from "../components/NoChildPlaceholder";

import type { Temperature } from "../types/models";
import { isoToLocal } from "../utils/dateTime";

type FeverLevel = "normal" | "lowFever" | "highFever";
type FeverColor = "success" | "warning" | "error";

function feverLevel(reading: number, unit: "F" | "C"): FeverLevel {
  const f = unit === "C" ? (reading * 9) / 5 + 32 : reading;
  if (f >= 102.2) return "highFever";
  if (f >= 100.4) return "lowFever";
  return "normal";
}

function feverColor(reading: number, unit: "F" | "C"): FeverColor {
  const level = feverLevel(reading, unit);
  if (level === "highFever") return "error";
  if (level === "lowFever") return "warning";
  return "success";
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return diffMin >= 0 ? `${diffMin}m ago` : `in ${-diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return diffHr >= 0 ? `${diffHr}h ago` : `in ${-diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 7) return diffDay >= 0 ? `${diffDay}d ago` : `in ${-diffDay}d`;
  const diffWk = Math.round(diffDay / 7);
  return diffWk >= 0 ? `${diffWk}w ago` : `in ${-diffWk}w`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString([], sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
  return `${date} ${time}`;
}

export default function TemperaturePage() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [entries, setEntries] = useState<Temperature[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Temperature | null>(null);
  const [form, setForm] = useState({ time: "", reading: "", reading_unit: "F", notes: "" });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuEntry, setMenuEntry] = useState<Temperature | null>(null);

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<Temperature[]>(`/temperature?child_id=${selectedChild.id}`);
      setEntries(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load temperature readings.", "error");
    }
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const openAdd = () => {
    setEditingEntry(null);
    setForm({ time: "", reading: "", reading_unit: "F", notes: "" });
    setDialogOpen(true);
  };

  const handleEdit = (entry: Temperature) => {
    setEditingEntry(entry);
    setForm({
      time: isoToLocal(entry.time),
      reading: String(entry.reading),
      reading_unit: entry.reading_unit,
      notes: entry.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedChild) return;
    const payload = {
      time: new Date(form.time).toISOString(),
      reading: parseFloat(form.reading),
      reading_unit: form.reading_unit,
      notes: form.notes || null,
    };
    try {
      if (editingEntry) {
        await api.put(`/temperature/${editingEntry.id}`, payload);
      } else {
        await api.post("/temperature", { child_id: selectedChild.id, ...payload });
      }
      setDialogOpen(false);
      setEditingEntry(null);
      setForm({ time: "", reading: "", reading_unit: "F", notes: "" });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save temperature reading.", "error");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/temperature/${id}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete temperature reading.", "error");
    }
  };

  const openMenu = (e: React.MouseEvent<HTMLElement>, entry: Temperature) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuEntry(entry);
  };

  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuEntry(null);
  };

  if (!selectedChild) {
    return <NoChildPlaceholder />;
  }

  const renderChip = (entry: Temperature) => (
    <Chip
      color={feverColor(entry.reading, entry.reading_unit)}
      icon={<ThermostatIcon />}
      label={`${entry.reading}°${entry.reading_unit}`}
      sx={{ fontWeight: 700 }}
    />
  );

  return (
    <Box sx={{ pb: { xs: 10, md: 0 } }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Temperature</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openAdd}
          sx={{ display: { xs: "none", md: "inline-flex" } }}
        >
          Add Reading
        </Button>
      </Box>

      {/* Desktop table view */}
      <Card sx={{ display: { xs: "none", md: "block" } }}>
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
                    <TableCell>{renderChip(t)}</TableCell>
                    <TableCell>{t.notes || "—"}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => handleEdit(t)} aria-label="Edit">
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDelete(t.id)} aria-label="Delete">
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

      {/* Mobile card list */}
      <Box sx={{ display: { xs: "block", md: "none" } }}>
        {entries.length === 0 ? (
          <Box sx={{ textAlign: "center", mt: 8, px: 2 }}>
            <ThermostatIcon sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              No temperature readings yet
            </Typography>
            <Typography color="text.secondary">
              Tap + to log the first one
            </Typography>
          </Box>
        ) : (
          <Stack spacing={1.5}>
            {entries.map((t) => (
              <Card
                key={t.id}
                onClick={() => handleEdit(t)}
                sx={{
                  cursor: "pointer",
                  minHeight: 44,
                  transition: "transform 120ms ease, box-shadow 120ms ease",
                  "&:active": { transform: "scale(0.99)" },
                }}
              >
                <CardContent sx={{ p: 2, "&:last-child": { pb: 2 }, display: "flex", gap: 1.5, alignItems: "flex-start" }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1 }}>
                      {renderChip(t)}
                      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                        {relativeTime(t.time)}
                      </Typography>
                    </Box>
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {formatTime(t.time)}
                    </Typography>
                    {t.notes && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          mt: 0.5,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {t.notes}
                      </Typography>
                    )}
                  </Box>
                  <IconButton
                    onClick={(e) => openMenu(e, t)}
                    aria-label="More actions"
                    sx={{ width: 44, height: 44, flexShrink: 0 }}
                  >
                    <MoreVertIcon />
                  </IconButton>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Box>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem
          onClick={() => {
            if (menuEntry) handleEdit(menuEntry);
            closeMenu();
          }}
          sx={{ minHeight: 44 }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuEntry) handleDelete(menuEntry.id);
            closeMenu();
          }}
          sx={{ minHeight: 44 }}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      <Fab
        color="primary"
        aria-label="Add temperature reading"
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
        onClose={() => { setDialogOpen(false); setEditingEntry(null); }}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle>{editingEntry ? "Edit Temperature Reading" : "Add Temperature Reading"}</DialogTitle>
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
          <Button onClick={() => { setDialogOpen(false); setEditingEntry(null); }}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={!form.time || !form.reading}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
