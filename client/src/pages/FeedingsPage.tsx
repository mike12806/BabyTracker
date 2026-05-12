import { useEffect, useState } from "react";
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
import RestaurantIcon from "@mui/icons-material/Restaurant";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";

import NoChildPlaceholder from "../components/NoChildPlaceholder";

import type { Feeding } from "../types/models";
import { isoToLocal } from "../utils/dateTime";

const FEEDING_TYPES = [
  { value: "breast_left", label: "Breast (Left)" },
  { value: "breast_right", label: "Breast (Right)" },
  { value: "both_breasts", label: "Both Breasts" },
  { value: "bottle", label: "Bottle" },
  { value: "solid", label: "Solid Food" },
  { value: "fortified_breast_milk", label: "Fortified Breast Milk" },
];

type ChipColor = "primary" | "secondary" | "success" | "warning" | "default";

function chipColorFor(type: Feeding["type"]): ChipColor {
  switch (type) {
    case "breast_left":
    case "breast_right":
    case "both_breasts":
      return "primary";
    case "bottle":
      return "secondary";
    case "solid":
      return "success";
    case "fortified_breast_milk":
      return "warning";
    default:
      return "default";
  }
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

function formatAbsoluteDateTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfThen.getTime()) / 86400000);
  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Yesterday ${time}`;
  const dateStr = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${dateStr}, ${time}`;
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

export default function FeedingsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const [feedings, setFeedings] = useState<Feeding[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Feeding | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuEntry, setMenuEntry] = useState<Feeding | null>(null);
  const [form, setForm] = useState({
    type: "bottle",
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
    setForm({ type: "bottle", start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
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
    const payload = {
      type: form.type,
      start_time: new Date(form.start_time).toISOString(),
      end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
      amount: form.amount ? parseFloat(form.amount) : null,
      amount_unit: form.amount ? form.amount_unit : null,
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
      setForm({ type: "bottle", start_time: "", end_time: "", amount: "", amount_unit: "oz", notes: "" });
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

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
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

      {/* Mobile: card stack */}
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
          <Stack sx={{ gap: 1.5, pb: 12 }}>
            {feedings.map((f) => (
              <Card key={f.id} elevation={1} sx={{ borderRadius: 2 }}>
                <CardActionArea onClick={() => handleEdit(f)} sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ py: 1.75, "&:last-child": { pb: 1.75 } }}>
                    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 1,
                            mb: 0.5,
                          }}
                        >
                          <Chip
                            label={feedingTypeLabel(f.type)}
                            color={chipColorFor(f.type)}
                            size="small"
                            sx={{ fontWeight: 500 }}
                          />
                          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                            {relativeTime(f.start_time)}
                          </Typography>
                        </Box>
                        <Typography variant="h6" sx={{ lineHeight: 1.3 }}>
                          {formatAbsoluteDateTime(f.start_time)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {summaryFor(f)}
                        </Typography>
                        {f.notes && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                              mt: 0.5,
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {f.notes}
                          </Typography>
                        )}
                      </Box>
                      <IconButton
                        aria-label="More actions"
                        onClick={(e) => openMenu(e, f)}
                        sx={{ minWidth: 44, minHeight: 44, mt: -0.5, mr: -1 }}
                      >
                        <MoreVertIcon />
                      </IconButton>
                    </Box>
                  </CardContent>
                </CardActionArea>
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
          bottom: { xs: "calc(56px + env(safe-area-inset-bottom) + 16px)", md: 24 },
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
