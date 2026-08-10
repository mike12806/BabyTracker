import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
  FormControlLabel,
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
import BedtimeIcon from "@mui/icons-material/Bedtime";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import NightlightIcon from "@mui/icons-material/Nightlight";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useDataRefresh } from "../hooks/useDataRefresh";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";
import { FAB_BOTTOM_OFFSET } from "../components/Layout";
import StatCard from "../components/StatCard";

import NoChildPlaceholder from "../components/NoChildPlaceholder";

import type { SleepEntry } from "../types/models";
import { isoToLocal } from "../utils/dateTime";
import { buildCategoryColors } from "../theme/categoryColors";
import { useEditEntryParam } from "../hooks/useEditEntryParam";

function humanDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayLabel(date: Date): string {
  const now = new Date();
  if (isSameDay(date, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Yesterday";
  const sixDaysAgo = new Date(now);
  sixDaysAgo.setDate(now.getDate() - 6);
  if (date >= sixDaysAgo) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTimeRange(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const startStr = start.toLocaleTimeString(undefined, timeFmt);
  if (!endIso) {
    return `${dayLabel(start)} ${startStr} – now`;
  }
  const end = new Date(endIso);
  const endStr = end.toLocaleTimeString(undefined, timeFmt);
  if (isSameDay(start, end)) {
    return `${dayLabel(start)} ${startStr} – ${endStr}`;
  }
  return `${dayLabel(start)} ${startStr} – ${dayLabel(end)} ${endStr}`;
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

export default function SleepPage() {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);
  const c = cat.sleep;
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isCompact = useMediaQuery(theme.breakpoints.down("md"));
  const { selectedChild } = useChildren();
  const { refreshKey } = useDataRefresh();
  const { notify } = useNotification();
  const [entries, setEntries] = useState<SleepEntry[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<SleepEntry | null>(null);
  const [form, setForm] = useState({ start_time: "", end_time: "", is_nap: false, notes: "" });
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuEntry, setMenuEntry] = useState<SleepEntry | null>(null);

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<SleepEntry[]>(`/sleep?child_id=${selectedChild.id}`);
      setEntries(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load sleep entries.", "error");
    }
  };

  useEffect(() => {
    load();
  }, [selectedChild, refreshKey]);

  const openAdd = () => {
    setEditingEntry(null);
    setForm({ start_time: "", end_time: "", is_nap: false, notes: "" });
    setDialogOpen(true);
  };

  const handleEdit = (entry: SleepEntry) => {
    setEditingEntry(entry);
    setForm({
      start_time: isoToLocal(entry.start_time),
      end_time: entry.end_time ? isoToLocal(entry.end_time) : "",
      is_nap: Boolean(entry.is_nap),
      notes: entry.notes || "",
    });
    setDialogOpen(true);
  };

  // Opening this page as `?edit=<id>` (from the dashboard or the activity
  // feed) drops straight into that entry's edit form.
  useEditEntryParam<SleepEntry>("sleep", handleEdit);

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingEntry(null);
  };

  const handleSave = async () => {
    if (!selectedChild) return;
    const payload = {
      start_time: new Date(form.start_time).toISOString(),
      end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
      is_nap: form.is_nap ? 1 : 0,
      notes: form.notes || null,
    };
    try {
      if (editingEntry) {
        await api.put(`/sleep/${editingEntry.id}`, payload);
      } else {
        await api.post("/sleep", { child_id: selectedChild.id, ...payload });
      }
      setDialogOpen(false);
      setEditingEntry(null);
      setForm({ start_time: "", end_time: "", is_nap: false, notes: "" });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save sleep entry.", "error");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/sleep/${id}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete sleep entry.", "error");
    }
  };

  const openMenu = (event: MouseEvent<HTMLElement>, entry: SleepEntry) => {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
    setMenuEntry(entry);
  };

  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuEntry(null);
  };

  const menuEdit = () => {
    if (menuEntry) handleEdit(menuEntry);
    closeMenu();
  };

  const menuDelete = () => {
    if (menuEntry) handleDelete(menuEntry.id);
    closeMenu();
  };

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, SleepEntry[]>();
    for (const s of entries) {
      const key = dateKey(s.start_time);
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return map;
  }, [entries]);

  // Summary stats
  const todayEntries = useMemo(() => {
    const todayK = dateKey(new Date().toISOString());
    return entries.filter((s) => dateKey(s.start_time) === todayK);
  }, [entries]);

  const todayTotalMs = useMemo(() => {
    return todayEntries.reduce((sum, s) => {
      const end = s.end_time ? new Date(s.end_time).getTime() : Date.now();
      return sum + Math.max(0, end - new Date(s.start_time).getTime());
    }, 0);
  }, [todayEntries]);

  const todayNaps = todayEntries.filter((s) => Boolean(s.is_nap)).length;
  const lastSleep = entries.length > 0 ? relativeTime(entries[0].start_time) : "—";

  // Below every hook — see the note in DiapersPage: `selectedChild` fills in
  // after the children load, so guarding above the hooks changes their count
  // between renders and blanks the app.
  if (!selectedChild) {
    return <NoChildPlaceholder />;
  }

  const renderTable = () => (
    <Card>
      <CardContent>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Start</TableCell>
                <TableCell>End</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Notes</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((s) => {
                const end = s.end_time ? new Date(s.end_time) : null;
                const start = new Date(s.start_time);
                const durationMs = end ? end.getTime() - start.getTime() : 0;
                return (
                  <TableRow
                    key={s.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => handleEdit(s)}
                  >
                    <TableCell>{start.toLocaleString()}</TableCell>
                    <TableCell>{end ? end.toLocaleString() : "In progress"}</TableCell>
                    <TableCell>{end ? humanDuration(durationMs) : "—"}</TableCell>
                    <TableCell>{s.is_nap ? "Nap" : "Night"}</TableCell>
                    <TableCell>{s.notes || "—"}</TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      <IconButton size="small" onClick={() => handleEdit(s)} aria-label="edit">
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDelete(s.id)} aria-label="delete">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );

  const renderEmpty = () => (
    <Box sx={{ textAlign: "center", py: { xs: 6, md: 8 } }}>
      <BedtimeIcon sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
      <Typography variant="h6" gutterBottom>
        No sleep recorded yet
      </Typography>
      <Typography color="text.secondary">
        Tap + to log the first one
      </Typography>
    </Box>
  );

  return (
    <Box sx={{ pb: { xs: 12, md: 0 } }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: { xs: 1.25, md: 2 },
        }}
      >
        <Typography variant="h4">Sleep</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openAdd}
          sx={{ display: { xs: "none", md: "inline-flex" } }}
        >
          Add Sleep
        </Button>
      </Box>

      {entries.length === 0 ? (
        <Card sx={{ borderRadius: 3 }}>
          <CardContent>{renderEmpty()}</CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Box sx={{ display: { xs: "none", md: "block" } }}>{renderTable()}</Box>

          {/* Mobile card-row design */}
          <Box sx={{ display: { xs: "block", md: "none" } }}>
            {/* Summary stat strip */}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0.75, mb: 1 }}>
              <StatCard accentColor={c.solid} label="Total" value={humanDuration(todayTotalMs)} sublabel="today" />
              <StatCard accentColor={c.solid} label="Naps" value={todayNaps} sublabel="today" />
              <StatCard accentColor={c.solid} label="Last" value={lastSleep} sublabel="sleep" />
            </Box>

            {/* Grouped log rows */}
            {[...grouped.entries()].map(([key, items]) => (
              <Box key={key}>
                <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", pt: 1, pb: 0.5 }}>
                  <Typography sx={{ fontSize: 10.5, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {dateSectionLabel(items[0].start_time)}
                  </Typography>
                  <Typography sx={{ fontSize: 10.5, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{items.length}</Typography>
                </Box>
                {items.map((s) => {
                  const isNap = Boolean(s.is_nap);
                  const end = s.end_time ? new Date(s.end_time) : null;
                  const durationMs = end ? end.getTime() - new Date(s.start_time).getTime() : Date.now() - new Date(s.start_time).getTime();
                  const inProgress = !end;
                  return (
                    <Box
                      key={s.id}
                      onClick={() => handleEdit(s)}
                      sx={{
                        display: "flex", alignItems: "center", gap: 1, p: "8px 10px",
                        bgcolor: "background.paper", border: 1, borderColor: "divider",
                        borderLeftWidth: 3, borderLeftColor: c.solid,
                        borderRadius: 2, position: "relative", overflow: "hidden",
                        boxShadow: 0, mb: 0.5, cursor: "pointer",
                      }}
                    >
                      <Box sx={{
                        width: 26, height: 26, borderRadius: "8px",
                        bgcolor: c.soft, color: c.ink,
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}>
                        {isNap ? <BedtimeIcon sx={{ fontSize: 14 }} /> : <NightlightIcon sx={{ fontSize: 14 }} />}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "-0.005em", color: inProgress ? "warning.main" : "text.primary", lineHeight: 1.2 }} noWrap>
                          {inProgress ? "In progress" : humanDuration(durationMs)} {isNap ? "(Nap)" : "(Night)"}
                        </Typography>
                        <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0, lineHeight: 1.2 }}>
                          {formatTimeRange(s.start_time, s.end_time)}
                        </Typography>
                      </Box>
                      <Typography sx={{ fontSize: 11, color: "text.secondary", fontWeight: 500, fontVariantNumeric: "tabular-nums", flexShrink: 0, mr: 3.25 }}>
                        {formatTimeShort(s.start_time)}
                      </Typography>
                      <IconButton
                        aria-label="more"
                        onClick={(e) => openMenu(e, s)}
                        sx={{ position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)", width: 28, height: 28, minWidth: 28, minHeight: 28 }}
                      >
                        <MoreVertIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>
        </>
      )}

      <Fab
        color="primary"
        aria-label="add sleep"
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

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={menuEdit} sx={{ minHeight: 44 }}>
          <EditIcon fontSize="small" sx={{ mr: 1.5 }} />
          Edit
        </MenuItem>
        <MenuItem onClick={menuDelete} sx={{ minHeight: 44, color: "error.main" }}>
          <DeleteIcon fontSize="small" sx={{ mr: 1.5 }} />
          Delete
        </MenuItem>
      </Menu>

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle>{editingEntry ? "Edit Sleep" : "Add Sleep"}</DialogTitle>
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
          <FormControlLabel
            control={
              <Checkbox
                checked={form.is_nap}
                onChange={(e) => setForm({ ...form, is_nap: e.target.checked })}
              />
            }
            label="Nap"
          />
          <TextField
            margin="dense"
            label="Notes"
            fullWidth
            multiline
            rows={isCompact ? 3 : 2}
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
