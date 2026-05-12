import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
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
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AccessibilityNewIcon from "@mui/icons-material/AccessibilityNew";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";

import NoChildPlaceholder from "../components/NoChildPlaceholder";

import type { TummyTime } from "../types/models";
import { isoToLocal } from "../utils/dateTime";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return remMins > 0 ? `${hrs}h ${remMins}m ago` : `${hrs}h ago`;
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
  const dayLabel = isToday
    ? "Today"
    : isYesterday
      ? "Yesterday"
      : startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const startStr = startDate.toLocaleTimeString(undefined, timeOpts);
  if (!end) return `${dayLabel} ${startStr} – now`;
  const endStr = new Date(end).toLocaleTimeString(undefined, timeOpts);
  return `${dayLabel} ${startStr} – ${endStr}`;
}

export default function TummyTimePage() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const theme = useTheme();
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
  }, [selectedChild]);

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

  const handleSave = async () => {
    if (!selectedChild) return;
    const payload = {
      start_time: new Date(form.start_time).toISOString(),
      end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
      milestone: form.milestone || null,
      notes: form.notes || null,
    };
    try {
      if (editingEntry) {
        await api.put(`/tummy-time/${editingEntry.id}`, payload);
      } else {
        await api.post("/tummy-time", { child_id: selectedChild.id, ...payload });
      }
      setDialogOpen(false);
      setEditingEntry(null);
      setForm({ start_time: "", end_time: "", milestone: "", notes: "" });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save tummy time entry.", "error");
    }
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

  if (!selectedChild) {

    return <NoChildPlaceholder />;

  }

  return (
    <Box sx={{ pb: { xs: 10, md: 0 } }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
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

      {/* Mobile/tablet card stack */}
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
          <Stack spacing={1.5}>
            {entries.map((t) => {
              const inProgress = !t.end_time;
              return (
                <Card key={t.id} elevation={1} sx={{ borderRadius: 2, overflow: "visible" }}>
                  <Box sx={{ display: "flex", alignItems: "stretch" }}>
                    <CardActionArea
                      onClick={() => handleEdit(t)}
                      sx={{ flex: 1, p: 2, minHeight: 44, borderRadius: 2 }}
                    >
                      <Stack spacing={1}>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 1,
                          }}
                        >
                          <Chip
                            color="success"
                            size="small"
                            icon={<AccessibilityNewIcon />}
                            label="Tummy Time"
                            sx={{ fontWeight: 600 }}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {relativeTime(t.start_time)}
                          </Typography>
                        </Box>
                        <Typography
                          variant="h5"
                          sx={{ fontWeight: 700, color: inProgress ? "success.main" : "text.primary" }}
                        >
                          {inProgress
                            ? `Active — started ${relativeTime(t.start_time)}`
                            : humanDuration(t.start_time, t.end_time)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {formatTimeRange(t.start_time, t.end_time)}
                        </Typography>
                        {t.milestone && (
                          <Box>
                            <Chip
                              variant="outlined"
                              size="small"
                              color="warning"
                              icon={<EmojiEventsIcon />}
                              label={t.milestone}
                              sx={{ maxWidth: "100%", "& .MuiChip-label": { whiteSpace: "normal" } }}
                            />
                          </Box>
                        )}
                        {t.notes && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {t.notes}
                          </Typography>
                        )}
                      </Stack>
                    </CardActionArea>
                    <Box sx={{ display: "flex", alignItems: "flex-start", p: 0.5 }}>
                      <IconButton
                        aria-label="more"
                        onClick={(e) => openMenu(e, t)}
                        sx={{ width: 44, height: 44 }}
                      >
                        <MoreVertIcon />
                      </IconButton>
                    </Box>
                  </Box>
                </Card>
              );
            })}
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
          bottom: { xs: 80, md: 24 },
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
          <Button onClick={handleSave} variant="contained" disabled={!form.start_time}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
