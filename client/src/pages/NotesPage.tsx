import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import NowButton from "../components/NowButton";
import type { Note } from "../types/models";

function isoToLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NotesPage() {
  const { selectedChild } = useChildren();
  const [entries, setEntries] = useState<Note[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Note | null>(null);
  const [form, setForm] = useState({ time: "", title: "", content: "" });

  const load = async () => {
    if (!selectedChild) return;
    const data = await api.get<Note[]>(`/notes?child_id=${selectedChild.id}`);
    setEntries(data);
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const handleEdit = (entry: Note) => {
    setEditingEntry(entry);
    setForm({
      time: isoToLocal(entry.time),
      title: entry.title || "",
      content: entry.content,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedChild) return;
    const payload = {
      time: new Date(form.time).toISOString(),
      title: form.title || null,
      content: form.content,
    };
    if (editingEntry) {
      await api.put(`/notes/${editingEntry.id}`, payload);
    } else {
      await api.post("/notes", { child_id: selectedChild.id, ...payload });
    }
    setDialogOpen(false);
    setEditingEntry(null);
    setForm({ time: "", title: "", content: "" });
    await load();
  };

  const handleDelete = async (id: number) => {
    await api.delete(`/notes/${id}`);
    await load();
  };

  if (!selectedChild) {
    return <Typography color="text.secondary">Select a child first.</Typography>;
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Notes</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingEntry(null);
            setForm({ time: "", title: "", content: "" });
            setDialogOpen(true);
          }}
        >
          Add Note
        </Button>
      </Box>

      <Card>
        <CardContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Content</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell>{new Date(n.time).toLocaleString()}</TableCell>
                    <TableCell>{n.title || "—"}</TableCell>
                    <TableCell>{n.content}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => handleEdit(n)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDelete(n.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} align="center">
                      <Typography color="text.secondary">No notes recorded.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditingEntry(null); }} maxWidth="sm" fullWidth>
        <DialogTitle>{editingEntry ? "Edit Note" : "Add Note"}</DialogTitle>
        <DialogContent>
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
            margin="dense"
            label="Title"
            fullWidth
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <TextField
            margin="dense"
            label="Content"
            fullWidth
            required
            multiline
            rows={4}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDialogOpen(false); setEditingEntry(null); }}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={!form.time || !form.content}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
