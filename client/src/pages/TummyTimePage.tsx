import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
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
import AccessibilityNewIcon from "@mui/icons-material/AccessibilityNew";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useDataRefresh } from "../hooks/useDataRefresh";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";
import { FAB_BOTTOM_OFFSET } from "../components/Layout";
import StatCard from "../components/StatCard";

import NoChildPlaceholder from "../components/NoChildPlaceholder";

import type { TummyTime } from "../types/models";
import { isoToLocal } from "../utils/dateTime";
import { buildCategoryColors } from "../theme/categoryColors";
import { useEditEntryParam } from "../hooks/useEditEntryParam";
import { useSaveGuard } from "../hooks/useSaveGuard";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function humanDuration(start: string, end: string | null): string {
  const endMs = end ? new Date(end).getTime() : Date.now();
  const ms = endMs - new Date(start).getTime();
  if (ms <= 0) return "0m";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

function formatTimeRange(start: string, end: string | null): string {
  const startDate = new Date(start);
  const now = new Date();
  const isToday = startDate.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = startDate.toDateString() === yesterday.toDateString();
  const dayLbl = isToday
    ? "Today"
    : isYesterday
      ? "Yesterday"
      : startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const startStr = startDate.toLocaleTimeString(undefined, timeOpts);
  if (!end) return `${dayLbl} ${startStr} – now`;
  const endStr = new Date(end).toLocaleTimeString(undefined, timeOpts);
  return `${dayLbl} ${startStr} – ${endStr}`;
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

export default function TummyTimePage() {
  const { selectedChild } = useChildren();
  const { refreshKey } = useDataRefresh();
  const { notify } = useNotification();
  const { saving, save } = useSaveGuard();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);
  const c = cat.tummy;
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isCompact = useMediaQuery(theme.breakpoints.down("md"));
  const [entries, setEntries] = useState<TummyTime[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TummyTime | null>(null);
  const [form, setForm] = useState({ start_time: "", end_time: "", milestone: "", notes: "" });
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuEntry, setMenuEntry] = useState<TummyTime | null>(null);

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<TummyTime[]>(`/tummy-time?child_id=${selectedChild.id}`);
      setEntries(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load tummy time entries.", "error");
    }
  };

  useEffect(() => {
    load();
  }, [selectedChild, refreshKey]);

  const openAdd = () => {
    setEditingEntry(null);
    setForm({ start_time: "", end_time: "", milestone: "", notes: "" });
    setDialogOpen(true);
  };

  const handleEdit = (entry: TummyTime) => {
    setEditingEntry(entry);
    setForm({
      start_time: isoToLocal(entry.start_time),
      end_time: entry.end_time ? isoToLocal(entry.end_time) : "",
      milestone: entry.milestone || "",
      notes: entry.notes || "",
    });
    setDialogOpen(true);
  };

  // Opening this page as `?edit=<id>` (from the dashboard or the activity
  // feed) drops straight into that entry's edit form.
  useEditEntryParam<TummyTime>("tummy-time", handleEdit);

  const handleSave = async () => {
    if (!selectedChild) return;
    const payload = {
      start_time: new Date(form.start_time).toISOString(),
      end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
      milestone: form.milestone || null,
      notes: form.notes || null,
    };
    await save(payload, async (idempotencyKey) => {
      try {
        if (editingEntry) {
          await api.put(`/tummy-time/${editingEntry.id}`, payload);
        } else {
          await api.post("/tummy-time", { child_id: selectedChild.id, ...payload, client_request_id: idempotencyKey });
        }
        setDialogOpen(false);
        setEditingEntry(null);
        setForm({ start_time: "", end_time: "", milestone: "", notes: "" });
        await load();
      } catch (err) {
        notify(err instanceof Error ? err.message : "Failed to save tummy time entry.", "error");
      }
    });
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/tummy-time/${id}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete tummy time entry.", "error");
    }
  };

  const openMenu = (e: MouseEvent<HTMLElement>, entry: TummyTime) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuEntry(entry);
  };

  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuEntry(null);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingEntry(null);
  };

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, TummyTime[]>();
    for (const t of entries) {
      const key = dateKey(t.start_time);
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [entries]);

  // Summary stats
  const todayEntries = useMemo(() => {
    const todayK = dateKey(new Date().toISOString());
    return entries.filter((t) => dateKey(t.start_time) === todayK);
  }, [entries]);

  const todayCount = todayEntries.length;
  const todayTotalMs = useMemo(() => {
    return todayEntries.reduce((sum, t) => {
      const end = t.end_time ? new Date(t.end_time).getTime() : Date.now();
      return sum + Math.max(0, end - new Date(t.start_time).getTime());
    }, 0);
  }, [todayEntries]);
  const todayTotalDuration = humanDuration(new Date(Date.now() - todayTotalMs).toISOString(), new Date().toISOString());
  const lastTummy = entries.length > 0 ? relativeTime(entries[0].start_time) : "—";

  // Below every hook — see the note in DiapersPage: `selectedChild` fills in
  // after the children load, so guarding above the hooks changes their count
  // between renders and blanks the app.
  if (!selectedChild) {
    return <NoChildPlaceholder />;
  }

  return (
    <Box sx={{ pb: { xs: 10, md: 0 } }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: { xs: 1.25, md: 2 } }}>
        <Typography variant="h4">Tummy Time</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openAdd}
          sx={{ display: { xs: "none", md: "inline-flex" } }}
        >
          Add Session
        </Button>
      </Box>

      {/* Desktop table */}
      <Card sx={{ display: { xs: "none", md: "block" } }}>
        <CardContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Start</TableCell>
                  <TableCell>End</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell>Milestone</TableCell>
                  <TableCell>Notes</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{new Date(t.start_time).toLocaleString()}</TableCell>
                    <TableCell>{t.end_time ? new Date(t.end_time).toLocaleString() : "In progress"}</TableCell>
                    <TableCell>{humanDuration(t.start_time, t.end_time)}</TableCell>
                    <TableCell>{t.milestone || "—"}</TableCell>
                    <TableCell>{t.notes || "—"}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => handleEdit(t)} aria-label="edit">
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDelete(t.id)} aria-label="delete">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography color="text.secondary">No tummy time recorded.</Typography>
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
              textAlign: "center",
              py: 8,
              px: 2,
              color: "text.secondary",
            }}
          >
            <AccessibilityNewIcon sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              No tummy time logged yet
            </Typography>
            <Typography variant="body2">Tap + to start tracking</Typography>
          </Box>
        ) : (
          <Box sx={{ pb: 12 }}>
            {/* Summary stat strip */}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0.75, mb: 1 }}>
              <StatCard accentColor={c.solid} label="Today" value={todayCount} sublabel="sessions" />
              <StatCard accentColor={c.solid} label="Total" value={todayTotalMs > 0 ? todayTotalDuration : "—"} sublabel="today" />
              <StatCard accentColor={c.solid} label="Last" value={lastTummy} sublabel="session" />
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
                {items.map((t) => {
                  const inProgress = !t.end_time;
                  const meta = t.milestone
                    ? t.milestone
                    : formatTimeRange(t.start_time, t.end_time);
                  return (
                    <Box
                      key={t.id}
                      onClick={() => handleEdit(t)}
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
                        {t.milestone ? <EmojiEventsIcon sx={{ fontSize: 14 }} /> : <AccessibilityNewIcon sx={{ fontSize: 14 }} />}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "-0.005em", color: inProgress ? "warning.main" : "text.primary", lineHeight: 1.2 }} noWrap>
                          {inProgress ? "In progress" : humanDuration(t.start_time, t.end_time)}
                        </Typography>
                        <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0, lineHeight: 1.2 }} noWrap>{meta}</Typography>
                      </Box>
                      <Typography sx={{ fontSize: 11, color: "text.secondary", fontWeight: 500, fontVariantNumeric: "tabular-nums", flexShrink: 0, mr: 3.25 }}>
                        {formatTimeShort(t.start_time)}
                      </Typography>
                      <IconButton
                        aria-label="more"
                        onClick={(e) => openMenu(e, t)}
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
        aria-label="add tummy time"
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
        onClose={closeDialog}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle>{editingEntry ? "Edit Tummy Time" : "Add Tummy Time"}</DialogTitle>
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
          <TextField
            margin="dense"
            label="Milestone"
            fullWidth
            value={form.milestone}
            onChange={(e) => setForm({ ...form, milestone: e.target.value })}
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
          <Button onClick={handleSave} variant="contained" disabled={saving || !form.start_time}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
