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
import RestaurantIcon from "@mui/icons-material/Restaurant";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";
import { FAB_BOTTOM_OFFSET } from "../components/Layout";
import StatCard from "../components/StatCard";

import NoChildPlaceholder from "../components/NoChildPlaceholder";

import type { Feeding } from "../types/models";
import { isoToLocal } from "../utils/dateTime";
import { buildCategoryColors } from "../theme/categoryColors";

const FEEDING_TYPES = [
  { value: "breast_left", label: "Breast (Left)" },
  { value: "breast_right", label: "Breast (Right)" },
  { value: "both_breasts", label: "Both Breasts" },
  { value: "bottle_breast_milk", label: "Bottle (Breast Milk)" },
  { value: "bottle_formula", label: "Bottle (Formula)" },
  { value: "solid", label: "Solid Food" },
  { value: "fortified_breast_milk", label: "Fortified Breast Milk" },
];

const BREAST_FEEDING_TYPES = ["breast_left", "breast_right", "both_breasts"];

function isBreastFeeding(type: string): boolean {
  return BREAST_FEEDING_TYPES.includes(type);
}

function feedingTypeLabel(type: Feeding["type"]): string {
  return FEEDING_TYPES.find((t) => t.value === type)?.label ?? type.replace(/_/g, " ");
}

function relativeTime(iso: string): string {
  const now = new Date();
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfThen.getTime()) / 86400000);
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return `${dayDiff}d ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms <= 0) return "—";
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const hr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min === 0 ? `${hr}h` : `${hr}h ${min}m`;
}

function summaryFor(f: Feeding): string {
  if (f.amount != null) return `${f.amount} ${f.amount_unit ?? ""}`.trim();
  if (f.end_time) return formatDuration(f.start_time, f.end_time);
  return "—";
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

export default function FeedingsPage() {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);
  const c = cat.feed;
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const [feedings, setFeedings] = useState<Feeding[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Feeding | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuEntry, setMenuEntry] = useState<Feeding | null>(null);
  const [form, setForm] = useState({
    type: "bottle_formula",
    start_time: "",
    end_time: "",
    amount: "",
    amount_unit: "oz",
    notes: "",
  });

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<Feeding[]>(`/feedings?child_id=${selectedChild.id}`);
      setFeedings(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load feedings.", "error");
    }
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const openAddDialog = () => {
    setEditingEntry(null);
    setForm({ type: "bottle_formula", start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
    setDialogOpen(true);
  };

  const handleEdit = (entry: Feeding) => {
    setEditingEntry(entry);
    setForm({
      type: entry.type,
      start_time: isoToLocal(entry.start_time),
      end_time: entry.end_time ? isoToLocal(entry.end_time) : "",
      amount: entry.amount != null ? String(entry.amount) : "",
      amount_unit: entry.amount_unit || "oz",
      notes: entry.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedChild) return;
    const trackAmount = !isBreastFeeding(form.type) && form.amount;
    const payload = {
      type: form.type,
      start_time: new Date(form.start_time).toISOString(),
      end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
      amount: trackAmount ? parseFloat(form.amount) : null,
      amount_unit: trackAmount ? form.amount_unit : null,
      notes: form.notes || null,
    };
    try {
      if (editingEntry) {
        await api.put(`/feedings/${editingEntry.id}`, payload);
      } else {
        await api.post("/feedings", { child_id: selectedChild.id, ...payload });
      }
      setDialogOpen(false);
      setEditingEntry(null);
      setForm({ type: "bottle_formula", start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save feeding.", "error");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/feedings/${id}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete feeding.", "error");
    }
  };

  const openMenu = (e: React.MouseEvent<HTMLElement>, entry: Feeding) => {
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

  // Group feedings by date for section headers
  const grouped = useMemo(() => {
    const map = new Map<string, Feeding[]>();
    for (const f of feedings) {
      const key = dateKey(f.start_time);
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    return map;
  }, [feedings]);

  // Summary stats
  const todayFeedings = useMemo(() => {
    const todayKey = dateKey(new Date().toISOString());
    return feedings.filter((f) => dateKey(f.start_time) === todayKey);
  }, [feedings]);

  const todayCount = todayFeedings.length;
  const todayTotalOz = useMemo(() => {
    return todayFeedings
      .filter((f) => f.amount != null && f.amount_unit === "oz")
      .reduce((sum, f) => sum + (f.amount ?? 0), 0);
  }, [todayFeedings]);
  const lastFeedingTime = feedings.length > 0 ? relativeTime(feedings[0].start_time) : "—";

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: { xs: 1.25, md: 2 } }}>
        <Typography variant="h4">Feedings</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openAddDialog}
          sx={{ display: { xs: "none", md: "inline-flex" } }}
        >
          Add Feeding
        </Button>
      </Box>

      {/* Desktop: table */}
      <Box sx={{ display: { xs: "none", md: "block" } }}>
        <Card>
          <CardContent>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Type</TableCell>
                    <TableCell>Start</TableCell>
                    <TableCell>End</TableCell>
                    <TableCell>Amount</TableCell>
                    <TableCell>Notes</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {feedings.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>{f.type.replace(/_/g, " ")}</TableCell>
                      <TableCell>{new Date(f.start_time).toLocaleString()}</TableCell>
                      <TableCell>{f.end_time ? new Date(f.end_time).toLocaleString() : "—"}</TableCell>
                      <TableCell>{f.amount ? `${f.amount} ${f.amount_unit}` : "—"}</TableCell>
                      <TableCell>{f.notes || "—"}</TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => handleEdit(f)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" onClick={() => handleDelete(f.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {feedings.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} align="center">
                        <Typography color="text.secondary">No feedings recorded.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Box>

      {/* Mobile: new card-row design */}
      <Box sx={{ display: { xs: "block", md: "none" } }}>
        {feedings.length === 0 ? (
          <Box
            sx={{
              textAlign: "center",
              py: 8,
              px: 3,
              color: "text.secondary",
            }}
          >
            <RestaurantIcon sx={{ fontSize: 72, opacity: 0.25, mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              No feedings yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Tap + to log the first one.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ pb: 12 }}>
            {/* Summary stat strip */}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0.75, mb: 1 }}>
              <StatCard accentColor={c.solid} label="Today" value={todayCount} sublabel="feedings" />
              <StatCard accentColor={c.solid} label="Volume" value={todayTotalOz > 0 ? `${todayTotalOz}` : "—"} sublabel="oz today" />
              <StatCard accentColor={c.solid} label="Last" value={lastFeedingTime} sublabel="feeding" />
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
                {items.map((f) => (
                  <Box
                    key={f.id}
                    onClick={() => handleEdit(f)}
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
                      <RestaurantIcon sx={{ fontSize: 14 }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.2 }} noWrap>{feedingTypeLabel(f.type)}</Typography>
                      <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0, lineHeight: 1.2 }}>{summaryFor(f)}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: 11, color: "text.secondary", fontWeight: 500, fontVariantNumeric: "tabular-nums", flexShrink: 0, mr: 3.25 }}>
                      {formatTimeShort(f.start_time)}
                    </Typography>
                    <IconButton
                      aria-label="More actions"
                      onClick={(e) => openMenu(e, f)}
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
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} />
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuEntry) handleDelete(menuEntry.id);
            closeMenu();
          }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>

      <Fab
        color="primary"
        aria-label="Add feeding"
        onClick={openAddDialog}
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
        onClose={() => {
          setDialogOpen(false);
          setEditingEntry(null);
        }}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle>{editingEntry ? "Edit Feeding" : "Add Feeding"}</DialogTitle>
        <DialogContent sx={{ p: 2 }}>
          <TextField
            select
            margin="dense"
            label="Type"
            fullWidth
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {FEEDING_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>
                {t.label}
              </MenuItem>
            ))}
          </TextField>
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
          {isBreastFeeding(form.type) ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Amount not tracked for breastfeeding — set an end time to log duration.
            </Typography>
          ) : (
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
                <MenuItem value="g">g</MenuItem>
              </TextField>
            </Box>
          )}
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
          <Button
            onClick={() => {
              setDialogOpen(false);
              setEditingEntry(null);
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} variant="contained" disabled={!form.start_time}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
