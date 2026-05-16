import { useEffect, useMemo, useState, type MouseEvent } from "react";
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
import MedicationIcon from "@mui/icons-material/Medication";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";
import { FAB_BOTTOM_OFFSET } from "../components/Layout";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import type { Medication } from "../types/models";
import { isoToLocal } from "../utils/dateTime";
import { buildCategoryColors } from "../theme/categoryColors";

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

function formatTimeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDose(m: Medication): string {
  const parts: string[] = [];
  if (m.dosage !== null) {
    parts.push(`${m.dosage}${m.dosage_unit ? " " + m.dosage_unit : ""}`);
  }
  parts.push(m.name);
  return parts.join(" ");
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

export default function MedicationsPage() {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);
  const c = cat.med;
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

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, Medication[]>();
    for (const m of entries) {
      const key = dateKey(m.time);
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }
    return map;
  }, [entries]);

  // Summary stats
  const todayEntries = useMemo(() => {
    const todayK = dateKey(new Date().toISOString());
    return entries.filter((m) => dateKey(m.time) === todayK);
  }, [entries]);

  const todayCount = todayEntries.length;
  const uniqueMedsToday = useMemo(() => new Set(todayEntries.map((m) => m.name)).size, [todayEntries]);
  const lastMed = entries.length > 0 ? relativeTime(entries[0].time) : "—";

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

      {/* Mobile card-row design */}
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
                <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0.125 }}>doses</Typography>
              </Box>
              <Box sx={{
                bgcolor: "background.paper", border: 1, borderColor: "divider",
                borderRadius: 3, p: "10px 12px", position: "relative", overflow: "hidden", boxShadow: 1,
              }}>
                <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, bgcolor: c.solid }} />
                <Typography sx={{ fontSize: 10, color: "text.secondary", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Meds</Typography>
                <Typography sx={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.025em", mt: 0.125, fontVariantNumeric: "tabular-nums" }}>{uniqueMedsToday}</Typography>
                <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0.125 }}>unique today</Typography>
              </Box>
              <Box sx={{
                bgcolor: "background.paper", border: 1, borderColor: "divider",
                borderRadius: 3, p: "10px 12px", position: "relative", overflow: "hidden", boxShadow: 1,
              }}>
                <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, bgcolor: c.solid }} />
                <Typography sx={{ fontSize: 10, color: "text.secondary", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Last</Typography>
                <Typography sx={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.025em", mt: 0.125, fontVariantNumeric: "tabular-nums" }}>{lastMed}</Typography>
                <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0.125 }}>dose</Typography>
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
                {items.map((m) => (
                  <Box
                    key={m.id}
                    onClick={() => handleEdit(m)}
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
                      <MedicationIcon sx={{ fontSize: 16 }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.005em" }} noWrap>{formatDose(m)}</Typography>
                      <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.125 }} noWrap>{m.notes || "—"}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: 12.5, color: "text.secondary", fontWeight: 500, fontVariantNumeric: "tabular-nums", flexShrink: 0, mr: 4 }}>
                      {formatTimeShort(m.time)}
                    </Typography>
                    <IconButton
                      aria-label="more actions"
                      onClick={(e) => openMenu(e, m)}
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
          bottom: { xs: FAB_BOTTOM_OFFSET, md: 24 },
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
