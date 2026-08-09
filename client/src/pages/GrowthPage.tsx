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
  Grid,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import MonitorWeightIcon from "@mui/icons-material/MonitorWeight";
import HeightIcon from "@mui/icons-material/Height";
import CircleIcon from "@mui/icons-material/Circle";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CloseIcon from "@mui/icons-material/Close";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import { useDataRefresh } from "../hooks/useDataRefresh";
import NowButton from "../components/NowButton";
import { FAB_BOTTOM_OFFSET } from "../components/Layout";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import { buildCategoryColors } from "../theme/categoryColors";
import { formatWeight, lbOzToPounds, poundsToLbOz } from "../utils/weight";
import type { Growth } from "../types/models";

const EMPTY_FORM = {
  date: "",
  weight: "",
  weight_oz: "",
  weight_unit: "lb",
  height: "",
  height_unit: "in",
  head_circumference: "",
  head_circumference_unit: "in",
  notes: "",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const day = 86400000;
  const days = Math.round(diffMs / day);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 0 && days < 7) return `${days}d ago`;
  if (days < 0 && days > -7) return `In ${-days}d`;
  if (days >= 7 && days < 30) return `${Math.round(days / 7)}w ago`;
  if (days >= 30 && days < 365) return `${Math.round(days / 30)}mo ago`;
  if (days >= 365) return `${Math.round(days / 365)}y ago`;
  return "";
}

interface MetricCardProps {
  label: string;
  value: number;
  unit: string;
  /** Pre-formatted value (e.g. "7 lb 4 oz") shown instead of the value + unit pair. */
  valueText?: string;
  data: { v: number }[];
  tileColor: string;
  solidColor: string;
  icon: React.ReactNode;
}

function MetricCard({ label, value, unit, valueText, data, tileColor, solidColor, icon }: MetricCardProps) {
  return (
    <Card
      sx={{
        height: "100%",
        bgcolor: tileColor,
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        boxShadow: 0,
        overflow: "hidden",
      }}
    >
      <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 0.25 }}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <Box sx={{ color: solidColor, display: "flex", "& svg": { fontSize: 14 } }}>{icon}</Box>
            <Typography
              sx={{
                fontSize: 10,
                color: "text.secondary",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {label}
            </Typography>
          </Stack>
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "baseline", mb: 0 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {valueText ?? value}
          </Typography>
          {!valueText && (
            <Typography sx={{ fontSize: 11, color: "text.secondary", fontWeight: 500 }}>
              {unit}
            </Typography>
          )}
        </Stack>
        <Box sx={{ height: 36, mx: -1 }}>
          {data.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 2, right: 4, bottom: 2, left: 4 }}>
                <Line type="monotone" dataKey="v" stroke={solidColor} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Typography sx={{ fontSize: 10, color: "text.disabled" }}>
                More data needed
              </Typography>
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

interface EntryCardProps {
  entry: Growth;
  onEdit: (g: Growth) => void;
  onDelete: (id: number) => void;
  gutterColor: string;
}

function EntryCard({ entry, onEdit, onDelete, gutterColor }: EntryCardProps) {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const hasAny =
    entry.weight != null || entry.height != null || entry.head_circumference != null;
  return (
    <Card
      sx={{
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: 3,
        boxShadow: 1,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <CardActionArea onClick={() => onEdit(entry)} sx={{ p: 0 }}>
        <Box sx={{ display: "flex" }}>
          {/* Growth-colored left gutter */}
          <Box sx={{ width: 3, flexShrink: 0, bgcolor: gutterColor }} />
          <CardContent sx={{ p: 2, flex: 1, "&:last-child": { pb: 2 } }}>
            <Stack direction="row" sx={{ alignItems: "flex-start", justifyContent: "space-between", mb: 1, pr: 5 }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
                  {formatDate(entry.date)}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {relativeTime(entry.date)}
                </Typography>
              </Box>
              {/* Right side measurements */}
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
                {entry.weight != null && (
                  <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {formatWeight(entry.weight, entry.weight_unit)}
                  </Typography>
                )}
                {entry.height != null && (
                  <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {entry.height} {entry.height_unit ?? ""}
                  </Typography>
                )}
                {entry.head_circumference != null && (
                  <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {entry.head_circumference} {entry.head_circumference_unit ?? ""}
                  </Typography>
                )}
              </Stack>
            </Stack>
            {hasAny && (
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mb: entry.notes ? 1 : 0 }}>
                {entry.weight != null && (
                  <Chip
                    size="small"
                    icon={<MonitorWeightIcon />}
                    label={formatWeight(entry.weight, entry.weight_unit)}
                    sx={{ fontWeight: 500 }}
                  />
                )}
                {entry.height != null && (
                  <Chip
                    size="small"
                    icon={<HeightIcon />}
                    label={`${entry.height} ${entry.height_unit ?? ""}`.trim()}
                    sx={{ fontWeight: 500 }}
                  />
                )}
                {entry.head_circumference != null && (
                  <Chip
                    size="small"
                    icon={<CircleIcon sx={{ fontSize: 14 }} />}
                    label={`${entry.head_circumference} ${entry.head_circumference_unit ?? ""}`.trim()}
                    sx={{ fontWeight: 500 }}
                  />
                )}
              </Stack>
            )}
            {entry.notes && (
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
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
        </Box>
      </CardActionArea>
      <IconButton
        aria-label="More actions"
        onClick={(e) => {
          e.stopPropagation();
          setMenuAnchor(e.currentTarget);
        }}
        sx={{ position: "absolute", top: 8, right: 8, width: 44, height: 44 }}
      >
        <MoreVertIcon />
      </IconButton>
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
      >
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onEdit(entry);
          }}
          sx={{ minHeight: 44 }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1.5 }} /> Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onDelete(entry.id);
          }}
          sx={{ minHeight: 44, color: "error.main" }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1.5 }} /> Delete
        </MenuItem>
      </Menu>
    </Card>
  );
}

export default function GrowthPage() {
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const { refreshKey } = useDataRefresh();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isCompact = useMediaQuery(theme.breakpoints.down("md"));
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);

  const [entries, setEntries] = useState<Growth[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Growth | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<Growth[]>(`/growth?child_id=${selectedChild.id}`);
      setEntries(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load growth measurements.", "error");
    }
  };

  // Refetches on mount, when the child changes, and whenever `refreshKey` is
  // bumped — returning to the app, or logging an entry from the bottom-nav
  // FAB, refreshes this list instead of leaving the pre-existing one on screen.
  useEffect(() => {
    load();
  }, [selectedChild, refreshKey]);

  const trends = useMemo(() => {
    const sorted = [...entries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const buildSeries = (
      pick: (g: Growth) => number | null,
      pickUnit: (g: Growth) => string | null,
    ) => {
      const series = sorted
        .map((g) => {
          const v = pick(g);
          return v != null ? { v } : null;
        })
        .filter((p): p is { v: number } => p !== null);
      const latest = [...sorted].reverse().find((g) => pick(g) != null);
      if (!latest) return null;
      const unit = pickUnit(latest) ?? "";
      return { latest: pick(latest) as number, unit, series };
    };
    return {
      weight: buildSeries((g) => g.weight, (g) => g.weight_unit),
      height: buildSeries((g) => g.height, (g) => g.height_unit),
      head: buildSeries((g) => g.head_circumference, (g) => g.head_circumference_unit),
    };
  }, [entries]);

  const openAddDialog = () => {
    setEditingEntry(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const handleEdit = (entry: Growth) => {
    const unit = entry.weight_unit || "lb";
    // Pounds are edited as a lb + oz pair, so split the stored decimal value.
    const parts = unit === "lb" && entry.weight != null ? poundsToLbOz(entry.weight) : null;
    setEditingEntry(entry);
    setForm({
      date: entry.date,
      weight: parts ? String(parts.lb) : entry.weight != null ? String(entry.weight) : "",
      weight_oz: parts && parts.oz !== 0 ? String(parts.oz) : "",
      weight_unit: unit,
      height: entry.height != null ? String(entry.height) : "",
      height_unit: entry.height_unit || "in",
      head_circumference: entry.head_circumference != null ? String(entry.head_circumference) : "",
      head_circumference_unit: entry.head_circumference_unit || "in",
      notes: entry.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedChild) return;
    const weight =
      form.weight_unit === "lb"
        ? lbOzToPounds(form.weight, form.weight_oz)
        : form.weight
          ? parseFloat(form.weight)
          : null;
    const payload = {
      date: form.date,
      weight,
      weight_unit: weight != null ? form.weight_unit : null,
      height: form.height ? parseFloat(form.height) : null,
      height_unit: form.height ? form.height_unit : null,
      head_circumference: form.head_circumference ? parseFloat(form.head_circumference) : null,
      head_circumference_unit: form.head_circumference ? form.head_circumference_unit : null,
      notes: form.notes || null,
    };
    try {
      if (editingEntry) {
        await api.put(`/growth/${editingEntry.id}`, payload);
      } else {
        await api.post("/growth", { child_id: selectedChild.id, ...payload });
      }
      setDialogOpen(false);
      setEditingEntry(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save growth measurement.", "error");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/growth/${id}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete growth measurement.", "error");
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingEntry(null);
  };

  if (!selectedChild) {
    return <NoChildPlaceholder />;
  }

  const hasAnyTrend = trends.weight || trends.height || trends.head;

  return (
    <Box sx={{ pb: { xs: 10, md: 0 } }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: { xs: 1.25, md: 2 } }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>Growth</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openAddDialog}
          sx={{ display: { xs: "none", md: "inline-flex" } }}
        >
          Add Measurement
        </Button>
      </Box>

      {/* 3-column hero stat cards */}
      {hasAnyTrend && (
        <Grid container spacing={1} sx={{ mb: 1.5 }}>
          {trends.weight && (
            <Grid size={{ xs: 12, sm: 4 }}>
              <MetricCard
                label="Weight"
                value={trends.weight.latest}
                unit={trends.weight.unit}
                valueText={trends.weight.unit === "lb" ? formatWeight(trends.weight.latest, "lb") : undefined}
                data={trends.weight.series}
                tileColor={cat.temp.tile}
                solidColor={cat.temp.solid}
                icon={<MonitorWeightIcon fontSize="small" />}
              />
            </Grid>
          )}
          {trends.height && (
            <Grid size={{ xs: 12, sm: 4 }}>
              <MetricCard
                label="Height"
                value={trends.height.latest}
                unit={trends.height.unit}
                data={trends.height.series}
                tileColor={cat.pump.tile}
                solidColor={cat.pump.solid}
                icon={<HeightIcon fontSize="small" />}
              />
            </Grid>
          )}
          {trends.head && (
            <Grid size={{ xs: 12, sm: 4 }}>
              <MetricCard
                label="Head"
                value={trends.head.latest}
                unit={trends.head.unit}
                data={trends.head.series}
                tileColor={cat.tummy.tile}
                solidColor={cat.tummy.solid}
                icon={<CircleIcon sx={{ fontSize: 16 }} />}
              />
            </Grid>
          )}
        </Grid>
      )}

      {entries.length === 0 ? (
        <Card sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 3, boxShadow: 1 }}>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MonitorWeightIcon sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              No measurements yet
            </Typography>
            <Typography color="text.secondary" sx={{ display: { xs: "block", md: "none" } }}>
              Tap + to log the first one
            </Typography>
            <Typography color="text.secondary" sx={{ display: { xs: "none", md: "block" } }}>
              Click "Add Measurement" to log the first one
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Section header */}
          <Typography
            sx={{
              fontSize: 12,
              color: "text.secondary",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              mb: 1.5,
            }}
          >
            History
          </Typography>
          {isCompact ? (
            <Stack spacing={1.5}>
              {entries.map((g) => (
                <EntryCard key={g.id} entry={g} onEdit={handleEdit} onDelete={handleDelete} gutterColor={cat.growth.solid} />
              ))}
            </Stack>
          ) : (
            <Stack spacing={1.5}>
              {entries.map((g) => (
                <EntryCard key={g.id} entry={g} onEdit={handleEdit} onDelete={handleDelete} gutterColor={cat.growth.solid} />
              ))}
            </Stack>
          )}
        </>
      )}

      <Fab
        color="primary"
        aria-label="Add measurement"
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
        onClose={closeDialog}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {editingEntry ? "Edit Measurement" : "Add Measurement"}
          {isMobile && (
            <IconButton onClick={closeDialog} aria-label="Close" sx={{ width: 44, height: 44 }}>
              <CloseIcon />
            </IconButton>
          )}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField
              margin="dense"
              label="Date"
              type="date"
              sx={{ flex: 1 }}
              required
              slotProps={{ inputLabel: { shrink: true } }}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
            <NowButton type="date" onSetNow={(v) => setForm({ ...form, date: v })} />
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            {/* Pounds are entered as a lb + oz pair; the unit column stays aligned with the rows below. */}
            <Box sx={{ display: "flex", gap: 1, flex: 1 }}>
              <TextField
                margin="dense"
                label={form.weight_unit === "lb" ? "Weight (lb)" : "Weight"}
                type="number"
                sx={{ flex: 1.4 }}
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })}
              />
              {form.weight_unit === "lb" && (
                <TextField
                  margin="dense"
                  label="oz"
                  type="number"
                  sx={{ flex: 1 }}
                  value={form.weight_oz}
                  onChange={(e) => setForm({ ...form, weight_oz: e.target.value })}
                />
              )}
            </Box>
            <TextField
              select
              margin="dense"
              label="Unit"
              sx={{ width: 100, flexShrink: 0 }}
              value={form.weight_unit}
              onChange={(e) => {
                const weight_unit = e.target.value;
                // The oz companion field only exists for pounds.
                setForm({ ...form, weight_unit, weight_oz: weight_unit === "lb" ? form.weight_oz : "" });
              }}
            >
              <MenuItem value="lb">lb</MenuItem>
              <MenuItem value="kg">kg</MenuItem>
              <MenuItem value="oz">oz</MenuItem>
              <MenuItem value="g">g</MenuItem>
            </TextField>
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              margin="dense"
              label="Height"
              type="number"
              sx={{ flex: 1 }}
              value={form.height}
              onChange={(e) => setForm({ ...form, height: e.target.value })}
            />
            <TextField
              select
              margin="dense"
              label="Unit"
              sx={{ width: 100 }}
              value={form.height_unit}
              onChange={(e) => setForm({ ...form, height_unit: e.target.value })}
            >
              <MenuItem value="in">in</MenuItem>
              <MenuItem value="cm">cm</MenuItem>
            </TextField>
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              margin="dense"
              label="Head Circumference"
              type="number"
              sx={{ flex: 1 }}
              value={form.head_circumference}
              onChange={(e) => setForm({ ...form, head_circumference: e.target.value })}
            />
            <TextField
              select
              margin="dense"
              label="Unit"
              sx={{ width: 100 }}
              value={form.head_circumference_unit}
              onChange={(e) => setForm({ ...form, head_circumference_unit: e.target.value })}
            >
              <MenuItem value="in">in</MenuItem>
              <MenuItem value="cm">cm</MenuItem>
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
          <Button onClick={handleSave} variant="contained" disabled={!form.date}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
