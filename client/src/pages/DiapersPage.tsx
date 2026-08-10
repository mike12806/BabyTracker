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
import { useDataRefresh } from "../hooks/useDataRefresh";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";
import { FAB_BOTTOM_OFFSET } from "../components/Layout";
import StatCard from "../components/StatCard";

import NoChildPlaceholder from "../components/NoChildPlaceholder";

import type { DiaperChange } from "../types/models";
import { isoToLocal } from "../utils/dateTime";
import { buildCategoryColors } from "../theme/categoryColors";
import { useEditEntryParam } from "../hooks/useEditEntryParam";

const KNOWN_COLOR_SWATCHES: Record<string, string> = {
  yellow: "#f9d71c",
  green: "#4caf50",
  brown: "#795548",
  black: "#212121",
  white: "#fafafa",
  red: "#e53935",
  orange: "#fb8c00",
};

function typeLabel(type: DiaperChange["type"]): string {
  switch (type) {
    case "wet": return "Wet";
    case "solid": return "Solid";
    case "both": return "Both";
    case "none": return "None";
    default: return type;
  }
}

function relativeTime(iso: string): string {
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
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfThen.getTime()) / 86400000);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function DiapersPage() {
  const { selectedChild } = useChildren();
  const { refreshKey } = useDataRefresh();
  const { notify } = useNotification();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);
  const c = cat.diaper;
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
  }, [selectedChild, refreshKey]);

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

  // Opening this page as `?edit=<id>` (from the dashboard or the activity
  // feed) drops straight into that entry's edit form.
  useEditEntryParam<DiaperChange>("diaper-changes", handleEdit);

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

  const renderColorDot = (color: string) => {
    const swatch = KNOWN_COLOR_SWATCHES[color.toLowerCase()];
    if (!swatch) return color;
    return (
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", display: "inline-flex" }}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            bgcolor: swatch,
            border: "1px solid",
            borderColor: "divider",
          }}
        />
        <span style={{ textTransform: "capitalize" }}>{color}</span>
      </Stack>
    );
  };

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, DiaperChange[]>();
    for (const d of diapers) {
      const key = dateKey(d.time);
      const arr = map.get(key) ?? [];
      arr.push(d);
      map.set(key, arr);
    }
    return map;
  }, [diapers]);

  // Summary stats
  const todayDiapers = useMemo(() => {
    const todayK = dateKey(new Date().toISOString());
    return diapers.filter((d) => dateKey(d.time) === todayK);
  }, [diapers]);
  const todayWet = todayDiapers.filter((d) => d.type === "wet" || d.type === "both").length;
  const todaySolid = todayDiapers.filter((d) => d.type === "solid" || d.type === "both").length;
  const lastChange = diapers.length > 0 ? relativeTime(diapers[0].time) : "—";

  // Below every hook, deliberately. `selectedChild` starts null and fills in
  // once the children have loaded, so a guard placed higher up would render
  // this component with fewer hooks on the first pass and more on the second —
  // which throws, and with no error boundary above us takes the whole app down
  // to a blank screen. Anyone landing on `/diapers` directly (a reload, a cold
  // start, or a `?edit=<id>` link tapped from the dashboard) hits exactly that
  // ordering.
  if (!selectedChild) {
    return <NoChildPlaceholder />;
  }

  return (
    <Box sx={{ pb: { xs: 10, md: 0 } }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: { xs: 1.25, md: 2 } }}>
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

      {/* Mobile card-row design */}
      <Box sx={{ display: { xs: "block", md: "none" } }}>
        {diapers.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 8, px: 2 }}>
            <BabyChangingStationIcon sx={{ fontSize: 80, color: "text.disabled", opacity: 0.5, mb: 2 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>No diaper changes yet</Typography>
            <Typography color="text.secondary">Tap + to log the first one</Typography>
          </Box>
        ) : (
          <Box sx={{ pb: 12 }}>
            {/* Summary stat strip */}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0.75, mb: 1 }}>
              <StatCard accentColor={c.solid} label="Wet" value={todayWet} sublabel="today" />
              <StatCard accentColor={c.solid} label="Solid" value={todaySolid} sublabel="today" />
              <StatCard accentColor={c.solid} label="Last" value={lastChange} sublabel="change" />
            </Box>

            {/* Grouped log rows */}
            {[...grouped.entries()].map(([key, items]) => (
              <Box key={key}>
                <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", pt: 1, pb: 0.5 }}>
                  <Typography sx={{ fontSize: 10.5, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {dateSectionLabel(items[0].time)}
                  </Typography>
                  <Typography sx={{ fontSize: 10.5, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{items.length}</Typography>
                </Box>
                {items.map((d) => (
                  <Box
                    key={d.id}
                    onClick={() => handleEdit(d)}
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
                      <BabyChangingStationIcon sx={{ fontSize: 14 }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.2 }} noWrap>
                        {typeLabel(d.type)}{d.color ? ` · ` : ""}{d.color ? renderColorDot(d.color) : ""}
                      </Typography>
                      <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0, lineHeight: 1.2 }}>
                        {d.notes || "—"}
                      </Typography>
                    </Box>
                    <Typography sx={{ fontSize: 11, color: "text.secondary", fontWeight: 500, fontVariantNumeric: "tabular-nums", flexShrink: 0, mr: 3.25 }}>
                      {formatTimeShort(d.time)}
                    </Typography>
                    <IconButton
                      aria-label="More actions"
                      onClick={(e) => openMenu(e, d)}
                      sx={{ position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)", width: 28, height: 28, minWidth: 28, minHeight: 28 }}
                    >
                      <MoreVertIcon sx={{ fontSize: 16 }} />
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
            <MenuItem value="none">None</MenuItem>
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
