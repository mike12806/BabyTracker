import { useEffect, useMemo, useState } from "react";
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
import OpacityIcon from "@mui/icons-material/Opacity";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";

import NoChildPlaceholder from "../components/NoChildPlaceholder";

import type { Pumping } from "../types/models";
import { isoToLocal } from "../utils/dateTime";

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
  else phrase = new Date(iso).toLocaleDateString();
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

function dayLabel(d: Date): string {
  const now = new Date();
  if (isSameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatTimeRange(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  const startStr = `${dayLabel(start)} ${formatTime(start)}`;
  if (!endIso) return `${startStr} - in progress`;
  const end = new Date(endIso);
  if (isSameDay(start, end)) return `${startStr} - ${formatTime(end)}`;
  return `${startStr} - ${dayLabel(end)} ${formatTime(end)}`;
}

interface PumpingCardProps {
  entry: Pumping;
  onEdit: (entry: Pumping) => void;
  onDelete: (id: number) => void;
}

function PumpingCard({ entry, onEdit, onDelete }: PumpingCardProps) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const duration = humanDuration(entry.start_time, entry.end_time);
  const primary =
    entry.amount != null
      ? `${entry.amount} ${entry.amount_unit ?? "oz"}`
      : duration ?? "In progress";

  const closeMenu = () => setAnchor(null);

  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 3,
        border: 1,
        borderColor: "divider",
        position: "relative",
        overflow: "hidden",
        transition: "transform 120ms ease, box-shadow 120ms ease",
        "&:active": { transform: "scale(0.99)" },
      }}
    >
      <CardActionArea
        onClick={() => onEdit(entry)}
        sx={{ borderRadius: 3, p: 0 }}
      >
        <CardContent sx={{ p: 2, pr: 7 }}>
          <Stack
            direction="row"
            sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
          >
            <Chip
              color="primary"
              icon={<OpacityIcon />}
              label="Pumping"
              size="small"
              sx={{ fontWeight: 600 }}
            />
            <Typography variant="caption" color="text.secondary">
              {relativeTime(entry.start_time)}
            </Typography>
          </Stack>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {primary}
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 0.5, flexWrap: "wrap", alignItems: "center" }}
          >
            {duration && (
              <Chip
                size="small"
                variant="outlined"
                label={duration}
                sx={{ height: 22 }}
              />
            )}
            <Typography variant="body2" color="text.secondary">
              {formatTimeRange(entry.start_time, entry.end_time)}
            </Typography>
          </Stack>
          {entry.notes && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mt: 1,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {entry.notes}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
      <IconButton
        aria-label="More actions"
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
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
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={closeMenu}>
        <MenuItem
          onClick={() => {
            closeMenu();
            onEdit(entry);
          }}
          sx={{ minHeight: 44 }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} />
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            onDelete(entry.id);
          }}
          sx={{ minHeight: 44, color: "error.main" }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>
    </Card>
  );
}

export default function PumpingPage() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [entries, setEntries] = useState<Pumping[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Pumping | null>(null);
  const [form, setForm] = useState({ start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });

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

  const sortedEntries = useMemo(
    () =>
      [...entries].sort(
        (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
      ),
    [entries],
  );

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

      {/* Mobile card stack */}
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
          <Stack spacing={1.5}>
            {sortedEntries.map((p) => (
              <PumpingCard
                key={p.id}
                entry={p}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </Stack>
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

      <Fab
        color="primary"
        aria-label="Add pumping"
        onClick={openAdd}
        sx={{
          position: "fixed",
          bottom: { xs: "calc(56px + env(safe-area-inset-bottom) + 16px)", md: 24 },
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
