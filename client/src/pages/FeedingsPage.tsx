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
import { useDataRefresh } from "../hooks/useDataRefresh";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";
import { FAB_BOTTOM_OFFSET } from "../components/Layout";
import StatCard from "../components/StatCard";

import NoChildPlaceholder from "../components/NoChildPlaceholder";

import type { Feeding } from "../types/models";
import { formatRelativeTime, isoToLocal } from "../utils/dateTime";
import { amountTotals, formatAmountTotal, formatEntryAmount, type VolumeUnit } from "../utils/feedingAmount";
import { useVolumeUnit } from "../hooks/useVolumeUnit";
import { buildCategoryColors } from "../theme/categoryColors";
import { useEditEntryParam } from "../hooks/useEditEntryParam";
import { useSaveGuard } from "../hooks/useSaveGuard";
import { createEntry, discardPendingRow, isPending, mergePending } from "../api/outbox";
import { usePendingRows } from "../hooks/useOutbox";
import PendingChip from "../components/PendingChip";
import { QUEUED_SAVE_MESSAGE, QUEUED_SAVE_SEVERITY } from "../utils/saveOutcome";
import { FEEDING_TYPES, feedingTypeLabel } from "../utils/entryDetails";

const BREAST_FEEDING_TYPES = ["breast_left", "breast_right", "both_breasts"];

function isBreastFeeding(type: string): boolean {
  return BREAST_FEEDING_TYPES.includes(type);
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

function summaryFor(f: Feeding, unit: VolumeUnit): string {
  const amount = formatEntryAmount(f, unit);
  if (amount) return amount;
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
  const { refreshKey } = useDataRefresh();
  const { notify } = useNotification();
  const { saving, save } = useSaveGuard();
  const { unit } = useVolumeUnit();
  const [savedFeedings, setSavedFeedings] = useState<Feeding[]>([]);
  const pendingFeedings = usePendingRows<Feeding>("feedings", selectedChild?.id ?? null);
  /**
   * What the server has, plus what this device logged and hasn't managed to
   * send. Everything below reads this list, which is the point: the summary
   * above it answers "when was the last one", and leaving out the entry logged
   * ten minutes ago in the basement would make that answer wrong.
   *
   * Pending rows carry a negative `id` and are marked in the list — see
   * `PendingChip` — so they are never mistaken for something the other
   * caregiver's phone can see.
   */
  const feedings = useMemo(
    () => mergePending(savedFeedings, pendingFeedings, "start_time"),
    [savedFeedings, pendingFeedings],
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Feeding | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuEntry, setMenuEntry] = useState<Feeding | null>(null);
  // New entries default to the unit the app is displaying in, so what you
  // type back is what you just read.
  const [form, setForm] = useState({
    type: "bottle_formula",
    start_time: "",
    end_time: "",
    amount: "",
    amount_unit: unit as string,
    notes: "",
  });

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<Feeding[]>(`/feedings?child_id=${selectedChild.id}`);
      setSavedFeedings(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load feedings.", "error");
    }
  };

  useEffect(() => {
    load();
  }, [selectedChild, refreshKey]);

  const openAddDialog = () => {
    setEditingEntry(null);
    setForm({ type: "bottle_formula", start_time: "", end_time: "", amount: "", amount_unit: unit, notes: "" });
    setDialogOpen(true);
  };

  const handleEdit = (entry: Feeding) => {
    // A pending row has no server id to PUT against — it is still a queued
    // create. Rewriting the queued body would be more machinery than this case
    // deserves, so the honest offer is to throw it away and log it again.
    if (isPending(entry)) {
      notify("That entry hasn't synced yet — discard it and log it again to change it.", "info");
      return;
    }
    setEditingEntry(entry);
    setForm({
      type: entry.type,
      start_time: isoToLocal(entry.start_time),
      end_time: entry.end_time ? isoToLocal(entry.end_time) : "",
      amount: entry.amount != null ? String(entry.amount) : "",
      amount_unit: entry.amount_unit || unit,
      notes: entry.notes || "",
    });
    setDialogOpen(true);
  };

  // Opening this page as `?edit=<id>` (from the dashboard or the activity
  // feed) drops straight into that entry's edit form.
  useEditEntryParam<Feeding>("feedings", handleEdit);

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
    await save(payload, async (idempotencyKey) => {
      let queued = false;
      if (editingEntry) {
        // Deliberately not queued when the server is unreachable: an edit
        // replayed an hour later would overwrite whatever the other caregiver
        // did to the same row in the meantime, with nothing to detect it by.
        // `outbox.ts` explains why a create carries no such hazard.
        try {
          await api.put(`/feedings/${editingEntry.id}`, payload);
        } catch (err) {
          notify(err instanceof Error ? err.message : "Failed to save feeding.", "error");
          return;
        }
      } else {
        const outcome = await createEntry("feedings", selectedChild.id, {
          child_id: selectedChild.id,
          ...payload,
          client_request_id: idempotencyKey,
        });
        if (outcome.status === "failed") {
          // The dialog stays open with everything still in it, so whatever the
          // server objected to can be fixed and saved again.
          notify(outcome.error.message, "error");
          return;
        }
        if (outcome.status === "queued") {
          notify(QUEUED_SAVE_MESSAGE, QUEUED_SAVE_SEVERITY);
          queued = true;
        }
      }
      setDialogOpen(false);
      setEditingEntry(null);
      setForm({ type: "bottle_formula", start_time: "", end_time: "", amount: "", amount_unit: unit, notes: "" });
      // A queued entry is already in the list — it is rendered from the outbox,
      // not from the server — and the refetch would fail on the same dead
      // connection and replace "saved on this device" with a load error.
      if (!queued) await load();
    });
  };

  const handleDelete = async (id: number) => {
    // Nothing exists on the server to delete: dropping the queued entry is the
    // whole operation, and it is also the only version that works while the
    // connection is still down — which is exactly when a mistyped entry gets
    // noticed.
    if (discardPendingRow(id)) return;
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
  // Totalled the same way the dashboard does it, so the two screens always
  // agree: every volume counts, converted into the display unit, with any
  // gram total carried alongside rather than folded into a volume.
  const todayAmounts = useMemo(() => amountTotals(todayFeedings, unit), [todayFeedings, unit]);
  const lastFeedingTime = feedings.length > 0 ? formatRelativeTime(feedings[0].start_time) : "—";

  // Below every hook — see the note in DiapersPage: `selectedChild` fills in
  // after the children load, so guarding above the hooks changes their count
  // between renders and blanks the app.
  if (!selectedChild) {
    return <NoChildPlaceholder />;
  }

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
                      <TableCell>{f.type.replace(/_/g, " ")}{isPending(f) && <PendingChip />}</TableCell>
                      <TableCell>{new Date(f.start_time).toLocaleString()}</TableCell>
                      <TableCell>{f.end_time ? new Date(f.end_time).toLocaleString() : "—"}</TableCell>
                      <TableCell>{formatEntryAmount(f, unit) ?? "—"}</TableCell>
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
              <StatCard
                accentColor={c.solid}
                label="Volume"
                value={todayAmounts.length > 0 ? formatAmountTotal(todayAmounts[0]) : "—"}
                sublabel={
                  todayAmounts.length > 1
                    ? `+ ${formatAmountTotal(todayAmounts[1])} today`
                    : "today"
                }
              />
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
                      <Typography sx={{ fontSize: 10.5, color: "text.secondary", mt: 0, lineHeight: 1.2 }}>{summaryFor(f, unit)}</Typography>
                    </Box>
                    {isPending(f) && <PendingChip compact />}
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
                <MenuItem value="cc">cc</MenuItem>
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
          <Button onClick={handleSave} variant="contained" disabled={saving || !form.start_time}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
