import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NowButton from "./NowButton";

export type QuickLogCategory = "feed" | "diaper" | "sleep" | "pump" | "tummy" | "note";

interface QuickLogDialogProps {
  category: QuickLogCategory | null;
  onClose: () => void;
  onLogged?: (category: QuickLogCategory) => void;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function nowLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TITLES: Record<QuickLogCategory, string> = {
  feed: "Log feeding",
  diaper: "Log diaper",
  sleep: "Log sleep",
  pump: "Log pumping",
  tummy: "Log tummy time",
  note: "Add note",
};

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

const DIAPER_TYPES = [
  { value: "wet", label: "Wet" },
  { value: "solid", label: "Solid" },
  { value: "both", label: "Both" },
];

interface FormState {
  // common
  time: string;
  end_time: string;
  notes: string;
  // feeding
  feedingType: string;
  amount: string;
  amountUnit: string;
  // diaper
  diaperType: string;
  color: string;
  // sleep
  isNap: boolean;
  // note
  title: string;
  content: string;
}

function emptyForm(): FormState {
  return {
    time: nowLocal(),
    end_time: "",
    notes: "",
    feedingType: "bottle_formula",
    amount: "",
    amountUnit: "oz",
    diaperType: "wet",
    color: "",
    isNap: true,
    title: "",
    content: "",
  };
}

export default function QuickLogDialog({ category, onClose, onLogged }: QuickLogDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (category) setForm(emptyForm());
  }, [category]);

  if (!category) return null;

  const handleSave = async () => {
    if (!selectedChild) {
      notify("Select a child first.", "warning");
      return;
    }
    setSaving(true);
    try {
      const startIso = form.time ? new Date(form.time).toISOString() : new Date().toISOString();
      const endIso = form.end_time ? new Date(form.end_time).toISOString() : null;

      if (category === "feed") {
        const trackAmount = !isBreastFeeding(form.feedingType) && form.amount;
        await api.post("/feedings", {
          child_id: selectedChild.id,
          type: form.feedingType,
          start_time: startIso,
          end_time: endIso,
          amount: trackAmount ? parseFloat(form.amount) : null,
          amount_unit: trackAmount ? form.amountUnit : null,
          notes: form.notes || null,
        });
      } else if (category === "diaper") {
        await api.post("/diaper-changes", {
          child_id: selectedChild.id,
          time: startIso,
          type: form.diaperType,
          color: form.color || null,
          notes: form.notes || null,
        });
      } else if (category === "sleep") {
        await api.post("/sleep", {
          child_id: selectedChild.id,
          start_time: startIso,
          end_time: endIso,
          is_nap: form.isNap ? 1 : 0,
          notes: form.notes || null,
        });
      } else if (category === "pump") {
        await api.post("/pumping", {
          child_id: selectedChild.id,
          start_time: startIso,
          end_time: endIso,
          amount: form.amount ? parseFloat(form.amount) : null,
          amount_unit: form.amount ? form.amountUnit : null,
          notes: form.notes || null,
        });
      } else if (category === "tummy") {
        await api.post("/tummy-time", {
          child_id: selectedChild.id,
          start_time: startIso,
          end_time: endIso,
          milestone: null,
          notes: form.notes || null,
        });
      } else if (category === "note") {
        if (!form.content.trim()) {
          notify("Note can't be empty.", "warning");
          setSaving(false);
          return;
        }
        await api.post("/notes", {
          child_id: selectedChild.id,
          time: startIso,
          title: form.title || null,
          content: form.content,
        });
      }
      notify("Logged.", "success");
      onLogged?.(category);
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save.", "error");
    } finally {
      setSaving(false);
    }
  };

  const timeField = (
    <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
      <TextField
        margin="dense"
        label={category === "diaper" || category === "note" ? "Time" : "Start time"}
        type="datetime-local"
        sx={{ flex: 1 }}
        slotProps={{ inputLabel: { shrink: true } }}
        value={form.time}
        onChange={(e) => setForm({ ...form, time: e.target.value })}
      />
      <NowButton onSetNow={(v) => setForm({ ...form, time: v })} />
    </Box>
  );

  const endTimeField = (
    <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
      <TextField
        margin="dense"
        label="End time (optional)"
        type="datetime-local"
        sx={{ flex: 1 }}
        slotProps={{ inputLabel: { shrink: true } }}
        value={form.end_time}
        onChange={(e) => setForm({ ...form, end_time: e.target.value })}
      />
      <NowButton onSetNow={(v) => setForm({ ...form, end_time: v })} />
    </Box>
  );

  const notesField = (
    <TextField
      margin="dense"
      label="Notes"
      fullWidth
      multiline
      rows={2}
      value={form.notes}
      onChange={(e) => setForm({ ...form, notes: e.target.value })}
    />
  );

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle>{TITLES[category]}</DialogTitle>
      <DialogContent sx={{ p: 2 }}>
        {!selectedChild && (
          <Typography color="warning.main" sx={{ mb: 1 }}>
            Select a child to start logging.
          </Typography>
        )}
        {category === "feed" && (
          <>
            <TextField
              select
              margin="dense"
              label="Type"
              fullWidth
              value={form.feedingType}
              onChange={(e) => setForm({ ...form, feedingType: e.target.value })}
            >
              {FEEDING_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
              ))}
            </TextField>
            {timeField}
            {endTimeField}
            {isBreastFeeding(form.feedingType) ? (
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
                  value={form.amountUnit}
                  onChange={(e) => setForm({ ...form, amountUnit: e.target.value })}
                >
                  <MenuItem value="oz">oz</MenuItem>
                  <MenuItem value="ml">ml</MenuItem>
                  <MenuItem value="g">g</MenuItem>
                </TextField>
              </Box>
            )}
            {notesField}
          </>
        )}
        {category === "diaper" && (
          <>
            <TextField
              select
              margin="dense"
              label="Type"
              fullWidth
              value={form.diaperType}
              onChange={(e) => setForm({ ...form, diaperType: e.target.value })}
            >
              {DIAPER_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
              ))}
            </TextField>
            {timeField}
            <TextField
              margin="dense"
              label="Color (optional)"
              fullWidth
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
            />
            {notesField}
          </>
        )}
        {category === "sleep" && (
          <>
            <FormControlLabel
              control={
                <Switch
                  checked={form.isNap}
                  onChange={(e) => setForm({ ...form, isNap: e.target.checked })}
                />
              }
              label={form.isNap ? "Nap" : "Night sleep"}
              sx={{ mb: 0.5 }}
            />
            {timeField}
            {endTimeField}
            {notesField}
          </>
        )}
        {category === "pump" && (
          <>
            {timeField}
            {endTimeField}
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
                value={form.amountUnit}
                onChange={(e) => setForm({ ...form, amountUnit: e.target.value })}
              >
                <MenuItem value="oz">oz</MenuItem>
                <MenuItem value="ml">ml</MenuItem>
              </TextField>
            </Box>
            {notesField}
          </>
        )}
        {category === "tummy" && (
          <>
            {timeField}
            {endTimeField}
            {notesField}
          </>
        )}
        {category === "note" && (
          <>
            {timeField}
            <TextField
              margin="dense"
              label="Title (optional)"
              fullWidth
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <TextField
              margin="dense"
              label="Note"
              fullWidth
              multiline
              rows={4}
              required
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving || !selectedChild}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
