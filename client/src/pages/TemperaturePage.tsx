import { useEffect, useMemo, useState } from "react";
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
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
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
import { FAB_BOTTOM_OFFSET } from "../components/Layout";

import NoChildPlaceholder from "../components/NoChildPlaceholder";

import type { Temperature } from "../types/models";
import { isoToLocal } from "../utils/dateTime";
import { buildCategoryColors } from "../theme/categoryColors";
import type { Chip as _Chip } from "@mui/material";

type FeverLevel = "normal" | "lowFever" | "highFever";

function feverLevel(reading: number, unit: "F" | "C"): FeverLevel {
  const f = unit === "C" ? (reading * 9) / 5 + 32 : reading;
  if (f >= 102.2) return "highFever";
  if (f >= 100.4) return "lowFever";
  return "normal";
}

function feverLabel(reading: number, unit: "F" | "C"): string {
  const level = feverLevel(reading, unit);
  if (level === "highFever") return "High Fever";
  if (level === "lowFever") return "Low Fever";
  return "Normal";
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

function formatTimeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dateSectionLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (isSameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function TemperaturePage() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);
  const c = cat.temp;
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

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, Temperature[]>();
    for (const t of entries) {
      const key = dateKey(t.time);
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [entries]);

  // Summary stats
  const todayEntries = useMemo(() => {
    const todayK = dateKey(new Date().toISOString());
    return entries.filter((t) => dateKey(t.time) === todayK);
  }, [entries]);

  const todayCount = todayEntries.length;
  const latestReading = entries.length > 0 ? `${entries[0].reading}°${entries[0].reading_unit}` : "—";
  const lastTime = entries.length > 0 ? relativeTime(entries[0].time) : "—";

  // Chip-like rendering for desktop table
  const renderChipInTable = (entry: Temperature) => {
    const level = feverLevel(entry.reading, entry.reading_unit);
    const color = level === "highFever" ? "error.main" : level === "lowFever" ? "warning.main" : "success.main";
    return (
      <Typography sx={{ fontWeight: 700, color }}>{entry.reading}&deg;{entry.reading_unit}</Typography>
    );
  };

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
                    <TableCell>{renderChipInTable(t)}</TableCell>
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

      {/* Mobile card-row design */}
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
          <Box sx={{ pb: 12 }}>
            {/* Summary stat strip */}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, mb: 1.75 }}>
              <Box sx={{
                bgcolor: "background.paper", border: 1, borderColor: "divider",
                borderRadius: 3, p: "10px 12px", position: "relative", overflow: "hidden", boxShadow: 1,
              }}>
                <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, bgcolor: c.solid }} />
                <Typography sx={{ fontSize: 10, color: "text.secondary", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Today</Typography>
                <Typography sx={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.025em", mt: 0.125, fontVariantNumeric: "tabular-nums" }}>{todayCount}</Typography>
                <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0.125 }}>readings</Typography>
              </Box>
              <Box sx={{
                bgcolor: "background.paper", border: 1, borderColor: "divider",
                borderRadius: 3, p: "10px 12px", position: "relative", overflow: "hidden", boxShadow: 1,
              }}>
                <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, bgcolor: c.solid }} />
                <Typography sx={{ fontSize: 10, color: "text.secondary", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Latest</Typography>
                <Typography sx={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.025em", mt: 0.125, fontVariantNumeric: "tabular-nums" }}>{latestReading}</Typography>
                <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0.125 }}>reading</Typography>
              </Box>
              <Box sx={{
                bgcolor: "background.paper", border: 1, borderColor: "divider",
                borderRadius: 3, p: "10px 12px", position: "relative", overflow: "hidden", boxShadow: 1,
              }}>
                <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, bgcolor: c.solid }} />
                <Typography sx={{ fontSize: 10, color: "text.secondary", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Last</Typography>
                <Typography sx={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.025em", mt: 0.125, fontVariantNumeric: "tabular-nums" }}>{lastTime}</Typography>
                <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0.125 }}>check</Typography>
              </Box>
            </Box>

            {/* Grouped log rows */}
            {[...grouped.entries()].map(([key, items]) => (
              <Box key={key}>
                <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", py: "14px 2px 8px" }}>
                  <Typography sx={{ fontSize: 12, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {dateSectionLabel(items[0].time)}
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{items.length}</Typography>
                </Box>
                {items.map((t) => (
                  <Box
                    key={t.id}
                    onClick={() => handleEdit(t)}
                    sx={{
                      display: "flex", alignItems: "center", gap: 1.5, p: "12px 14px",
                      bgcolor: "background.paper", border: 1, borderColor: "divider",
                      borderRadius: 3, position: "relative", overflow: "hidden",
                      boxShadow: 1, mb: 0.75, cursor: "pointer",
                    }}
                  >
                    <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, bgcolor: c.solid }} />
                    <Box sx={{
                      width: 36, height: 36, borderRadius: "11px",
                      bgcolor: c.soft, color: c.ink,
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <ThermostatIcon sx={{ fontSize: 16 }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.005em" }} noWrap>
                        {t.reading}&deg;{t.reading_unit}
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.125 }}>
                        {feverLabel(t.reading, t.reading_unit)}{t.notes ? ` · ${t.notes}` : ""}
                      </Typography>
                    </Box>
                    <Typography sx={{ fontSize: 12.5, color: "text.secondary", fontWeight: 500, fontVariantNumeric: "tabular-nums", flexShrink: 0, mr: 4 }}>
                      {formatTimeShort(t.time)}
                    </Typography>
                    <IconButton
                      onClick={(e) => openMenu(e, t)}
                      aria-label="More actions"
                      sx={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 36, height: 36 }}
                    >
                      <MoreVertIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
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
          bottom: { xs: FAB_BOTTOM_OFFSET, md: 24 },
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
              <MenuItem value="F">&deg;F</MenuItem>
              <MenuItem value="C">&deg;C</MenuItem>
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
