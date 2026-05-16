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
import OpacityIcon from "@mui/icons-material/Opacity";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";
import { FAB_BOTTOM_OFFSET } from "../components/Layout";

import NoChildPlaceholder from "../components/NoChildPlaceholder";

import type { Pumping } from "../types/models";
import { isoToLocal } from "../utils/dateTime";
import { buildCategoryColors } from "../theme/categoryColors";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let phrase: string;
  if (mins < 1) phrase = "just now";
  else if (mins < 60) phrase = `${mins}m`;
  else if (hours < 24) phrase = `${hours}h`;
  else if (days < 7) phrase = `${days}d`;
  else phrase = new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (phrase === "just now") return phrase;
  return future ? `in ${phrase}` : `${phrase} ago`;
}

function humanDuration(startIso: string, endIso: string | null): string | null {
  if (!endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalMins = Math.round(ms / 60000);
  if (totalMins < 1) return "<1m";
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTimeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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

export default function PumpingPage() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);
  const c = cat.pump;
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [entries, setEntries] = useState<Pumping[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Pumping | null>(null);
  const [form, setForm] = useState({ start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuEntry, setMenuEntry] = useState<Pumping | null>(null);

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<Pumping[]>(`/pumping?child_id=${selectedChild.id}`);
      setEntries(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load pumping sessions.", "error");
    }
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const handleEdit = (entry: Pumping) => {
    setEditingEntry(entry);
    setForm({
      start_time: isoToLocal(entry.start_time),
      end_time: entry.end_time ? isoToLocal(entry.end_time) : "",
      amount: entry.amount != null ? String(entry.amount) : "",
      amount_unit: entry.amount_unit || "oz",
      notes: entry.notes || "",
    });
    setDialogOpen(true);
  };

  const openAdd = () => {
    setEditingEntry(null);
    setForm({ start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedChild) return;
    const payload = {
      start_time: new Date(form.start_time).toISOString(),
      end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
      amount: form.amount ? parseFloat(form.amount) : null,
      amount_unit: form.amount ? form.amount_unit : null,
      notes: form.notes || null,
    };
    try {
      if (editingEntry) {
        await api.put(`/pumping/${editingEntry.id}`, payload);
      } else {
        await api.post("/pumping", { child_id: selectedChild.id, ...payload });
      }
      setDialogOpen(false);
      setEditingEntry(null);
      setForm({ start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save pumping session.", "error");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/pumping/${id}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete pumping session.", "error");
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingEntry(null);
  };

  const openMenu = (e: React.MouseEvent<HTMLElement>, entry: Pumping) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuEntry(entry);
  };

  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuEntry(null);
  };

  const sortedEntries = useMemo(
    () =>
      [...entries].sort(
        (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
      ),
    [entries],
  );

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, Pumping[]>();
    for (const p of sortedEntries) {
      const key = dateKey(p.start_time);
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return map;
  }, [sortedEntries]);

  // Summary stats
  const todayEntries = useMemo(() => {
    const todayK = dateKey(new Date().toISOString());
    return sortedEntries.filter((p) => dateKey(p.start_time) === todayK);
  }, [sortedEntries]);

  const todayCount = todayEntries.length;
  const todayTotalOz = useMemo(() => {
    return todayEntries
      .filter((p) => p.amount != null && (p.amount_unit === "oz" || !p.amount_unit))
      .reduce((sum, p) => sum + (p.amount ?? 0), 0);
  }, [todayEntries]);
  const lastPump = sortedEntries.length > 0 ? relativeTime(sortedEntries[0].start_time) : "—";

  if (!selectedChild) {

    return <NoChildPlaceholder />;

  }

  return (
    <Box sx={{ pb: { xs: 12, md: 0 } }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: { xs: 2, md: 3 } }}>
        <Typography variant="h4">Pumping</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openAdd}
          sx={{ display: { xs: "none", md: "inline-flex" } }}
        >
          Add Pumping
        </Button>
      </Box>

      {/* Mobile card-row design */}
      <Box sx={{ display: { xs: "block", md: "none" } }}>
        {sortedEntries.length === 0 ? (
          <Box
            sx={{
              textAlign: "center",
              py: 8,
              px: 2,
              color: "text.secondary",
            }}
          >
            <OpacityIcon sx={{ fontSize: 64, color: "primary.light", opacity: 0.6, mb: 1 }} />
            <Typography variant="h6" sx={{ mb: 0.5 }}>
              No pumping sessions yet
            </Typography>
            <Typography variant="body2">
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
                <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0.125 }}>sessions</Typography>
              </Box>
              <Box sx={{
                bgcolor: "background.paper", border: 1, borderColor: "divider",
                borderRadius: 3, p: "10px 12px", position: "relative", overflow: "hidden", boxShadow: 1,
              }}>
                <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, bgcolor: c.solid }} />
                <Typography sx={{ fontSize: 10, color: "text.secondary", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Volume</Typography>
                <Typography sx={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.025em", mt: 0.125, fontVariantNumeric: "tabular-nums" }}>{todayTotalOz > 0 ? `${todayTotalOz}` : "—"}</Typography>
                <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0.125 }}>oz today</Typography>
              </Box>
              <Box sx={{
                bgcolor: "background.paper", border: 1, borderColor: "divider",
                borderRadius: 3, p: "10px 12px", position: "relative", overflow: "hidden", boxShadow: 1,
              }}>
                <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, bgcolor: c.solid }} />
                <Typography sx={{ fontSize: 10, color: "text.secondary", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Last</Typography>
                <Typography sx={{ fontSize: lastPump.length > 5 ? 15 : 20, fontWeight: 700, letterSpacing: "-0.025em", mt: 0.125, fontVariantNumeric: "tabular-nums" }} noWrap>{lastPump}</Typography>
                <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0.125 }}>session</Typography>
              </Box>
            </Box>

            {/* Grouped log rows */}
            {[...grouped.entries()].map(([key, items]) => (
              <Box key={key}>
                <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", py: "14px 2px 8px" }}>
                  <Typography sx={{ fontSize: 12, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {dateSectionLabel(items[0].start_time)}
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{items.length}</Typography>
                </Box>
                {items.map((p) => {
                  const duration = humanDuration(p.start_time, p.end_time);
                  const primary =
                    p.amount != null
                      ? `${p.amount} ${p.amount_unit ?? "oz"}`
                      : duration ?? "In progress";
                  const meta = duration && p.amount != null ? duration : (p.notes || "—");
                  return (
                    <Box
                      key={p.id}
                      onClick={() => handleEdit(p)}
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
                        <OpacityIcon sx={{ fontSize: 16 }} />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.005em" }} noWrap>{primary}</Typography>
                        <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.125 }} noWrap>{meta}</Typography>
                      </Box>
                      <Typography sx={{ fontSize: 12.5, color: "text.secondary", fontWeight: 500, fontVariantNumeric: "tabular-nums", flexShrink: 0, mr: 4 }}>
                        {formatTimeShort(p.start_time)}
                      </Typography>
                      <IconButton
                        aria-label="More actions"
                        onClick={(e) => openMenu(e, p)}
                        sx={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 36, height: 36 }}
                      >
                        <MoreVertIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Desktop table */}
      <Box sx={{ display: { xs: "none", md: "block" } }}>
        <Card>
          <CardContent>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Start</TableCell>
                    <TableCell>End</TableCell>
                    <TableCell>Duration</TableCell>
                    <TableCell>Amount</TableCell>
                    <TableCell>Notes</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedEntries.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.start_time).toLocaleString()}</TableCell>
                      <TableCell>{p.end_time ? new Date(p.end_time).toLocaleString() : "In progress"}</TableCell>
                      <TableCell>{humanDuration(p.start_time, p.end_time) ?? "—"}</TableCell>
                      <TableCell>{p.amount ? `${p.amount} ${p.amount_unit}` : "—"}</TableCell>
                      <TableCell>{p.notes || "—"}</TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => handleEdit(p)} aria-label="Edit">
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" onClick={() => handleDelete(p.id)} aria-label="Delete">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {sortedEntries.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} align="center">
                        <Typography color="text.secondary">No pumping sessions recorded.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Box>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem
          onClick={() => {
            if (menuEntry) handleEdit(menuEntry);
            closeMenu();
          }}
          sx={{ minHeight: 44 }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} />
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuEntry) handleDelete(menuEntry.id);
            closeMenu();
          }}
          sx={{ minHeight: 44, color: "error.main" }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>

      <Fab
        color="primary"
        aria-label="Add pumping"
        onClick={openAdd}
        sx={{
          position: "fixed",
          bottom: { xs: FAB_BOTTOM_OFFSET, md: 24 },
          right: 16,
          display: { xs: "flex", md: "none" },
          zIndex: (t) => t.zIndex.fab,
        }}
      >
        <AddIcon />
      </Fab>

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle>{editingEntry ? "Edit Pumping Session" : "Add Pumping Session"}</DialogTitle>
        <DialogContent>
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
          <Button onClick={closeDialog}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={!form.start_time}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
