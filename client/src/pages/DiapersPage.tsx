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
import BabyChangingStationIcon from "@mui/icons-material/BabyChangingStation";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";

import NoChildPlaceholder from "../components/NoChildPlaceholder";

import type { DiaperChange } from "../types/models";
import { isoToLocal } from "../utils/dateTime";

const KNOWN_COLOR_SWATCHES: Record<string, string> = {
  yellow: "#f9d71c",
  green: "#4caf50",
  brown: "#795548",
  black: "#212121",
  white: "#fafafa",
  red: "#e53935",
  orange: "#fb8c00",
};

const TYPE_CHIP_COLOR: Record<DiaperChange["type"], "info" | "warning" | "secondary"> = {
  wet: "info",
  solid: "warning",
  both: "secondary",
};

export default function DiapersPage() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [diapers, setDiapers] = useState<DiaperChange[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DiaperChange | null>(null);
  const [form, setForm] = useState({ time: "", type: "wet", color: "", notes: "" });
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuEntry, setMenuEntry] = useState<DiaperChange | null>(null);

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<DiaperChange[]>(`/diaper-changes?child_id=${selectedChild.id}`);
      setDiapers(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load diaper changes.", "error");
    }
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const handleEdit = (entry: DiaperChange) => {
    setEditingEntry(entry);
    setForm({
      time: isoToLocal(entry.time),
      type: entry.type,
      color: entry.color || "",
      notes: entry.notes || "",
    });
    setDialogOpen(true);
  };

  const handleAdd = () => {
    setEditingEntry(null);
    setForm({ time: "", type: "wet", color: "", notes: "" });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedChild) return;
    const payload = {
      time: new Date(form.time).toISOString(),
      type: form.type,
      color: form.color || null,
      notes: form.notes || null,
    };
    try {
      if (editingEntry) {
        await api.put(`/diaper-changes/${editingEntry.id}`, payload);
      } else {
        await api.post("/diaper-changes", { child_id: selectedChild.id, ...payload });
      }
      setDialogOpen(false);
      setEditingEntry(null);
      setForm({ time: "", type: "wet", color: "", notes: "" });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save diaper change.", "error");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/diaper-changes/${id}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete diaper change.", "error");
    }
  };

  const openMenu = (e: React.MouseEvent<HTMLElement>, entry: DiaperChange) => {
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

  const relativeTime = (iso: string): string => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.round(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    return new Date(iso).toLocaleDateString();
  };

  const formatTime = (iso: string): string => {
    const d = new Date(iso);
    const now = new Date();
    const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) return `Today ${timeStr}`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate();
    if (isYesterday) return `Yesterday ${timeStr}`;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${timeStr}`;
  };

  const renderColorSwatch = (color: string) => {
    const swatch = KNOWN_COLOR_SWATCHES[color.toLowerCase()];
    if (!swatch) return <Typography variant="body2" sx={{ textTransform: "capitalize" }}>{color}</Typography>;
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box
          sx={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            bgcolor: swatch,
            border: "1px solid",
            borderColor: "divider",
            display: "inline-block",
          }}
        />
        <Typography variant="body2" sx={{ textTransform: "capitalize" }}>{color}</Typography>
      </Stack>
    );
  };

  return (
    <Box sx={{ pb: { xs: 10, md: 0 } }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Diaper Changes</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleAdd}
          sx={{ display: { xs: "none", md: "inline-flex" } }}
        >
          Add Change
        </Button>
      </Box>

      {/* Desktop table */}
      <Box sx={{ display: { xs: "none", md: "block" } }}>
        <Card>
          <CardContent>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Time</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Color</TableCell>
                    <TableCell>Notes</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {diapers.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{new Date(d.time).toLocaleString()}</TableCell>
                      <TableCell sx={{ textTransform: "capitalize" }}>{d.type}</TableCell>
                      <TableCell sx={{ textTransform: "capitalize" }}>{d.color || "—"}</TableCell>
                      <TableCell>{d.notes || "—"}</TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => handleEdit(d)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" onClick={() => handleDelete(d.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {diapers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} align="center">
                        <Typography color="text.secondary">No diaper changes recorded.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Box>

      {/* Mobile card stack */}
      <Box sx={{ display: { xs: "block", md: "none" } }}>
        {diapers.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 8, px: 2 }}>
            <BabyChangingStationIcon sx={{ fontSize: 80, color: "text.disabled", opacity: 0.5, mb: 2 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>No diaper changes yet</Typography>
            <Typography color="text.secondary">Tap + to log the first one</Typography>
          </Box>
        ) : (
          <Stack spacing={1.5}>
            {diapers.map((d) => (
              <Card
                key={d.id}
                onClick={() => handleEdit(d)}
                sx={{
                  cursor: "pointer",
                  transition: "transform 0.1s, box-shadow 0.1s",
                  "&:active": { transform: "scale(0.99)" },
                }}
              >
                <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                  <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                    <Chip
                      label={d.type}
                      size="small"
                      color={TYPE_CHIP_COLOR[d.type]}
                      sx={{ textTransform: "capitalize", fontWeight: 600 }}
                    />
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                      <Typography variant="caption" color="text.secondary">
                        {relativeTime(d.time)}
                      </Typography>
                      <IconButton
                        size="medium"
                        onClick={(e) => openMenu(e, d)}
                        sx={{ minWidth: 44, minHeight: 44 }}
                        aria-label="More actions"
                      >
                        <MoreVertIcon />
                      </IconButton>
                    </Stack>
                  </Stack>
                  <Typography variant="h6" sx={{ mb: d.color || d.notes ? 0.5 : 0 }}>
                    {formatTime(d.time)}
                  </Typography>
                  {d.color && <Box sx={{ mb: d.notes ? 0.5 : 0 }}>{renderColorSwatch(d.color)}</Box>}
                  {d.notes && (
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
                      {d.notes}
                    </Typography>
                  )}
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
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuEntry) handleDelete(menuEntry.id);
            closeMenu();
          }}
          sx={{ minHeight: 44, color: "error.main" }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      <Fab
        color="primary"
        aria-label="Add diaper change"
        onClick={handleAdd}
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
        onClose={() => { setDialogOpen(false); setEditingEntry(null); }}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle>{editingEntry ? "Edit Diaper Change" : "Add Diaper Change"}</DialogTitle>
        <DialogContent sx={{ pt: { xs: 2, sm: 1 } }}>
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
            select
            margin="dense"
            label="Type"
            fullWidth
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            <MenuItem value="wet">Wet</MenuItem>
            <MenuItem value="solid">Solid</MenuItem>
            <MenuItem value="both">Both</MenuItem>
          </TextField>
          <TextField
            select
            margin="dense"
            label="Color"
            fullWidth
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
          >
            <MenuItem value="">None</MenuItem>
            <MenuItem value="black">Black</MenuItem>
            <MenuItem value="brown">Brown</MenuItem>
            <MenuItem value="green">Green</MenuItem>
            <MenuItem value="yellow">Yellow</MenuItem>
            <MenuItem value="white">White</MenuItem>
          </TextField>
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
          <Button onClick={handleSave} variant="contained" disabled={!form.time}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
