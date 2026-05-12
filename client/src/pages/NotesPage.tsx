import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardActionArea,
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
import NoteIcon from "@mui/icons-material/Note";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import type { Note } from "../types/models";
import { isoToLocal } from "../utils/dateTime";

function relativeTime(iso: string): string {
  const now = new Date();
  const then = new Date(iso);
  const diffMin = Math.floor((now.getTime() - then.getTime()) / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const dayDiff = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) /
      86400000,
  );
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return `${dayDiff}d ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const dayDiff = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86400000,
  );
  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + `, ${time}`;
}

export default function NotesPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const [entries, setEntries] = useState<Note[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Note | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuEntry, setMenuEntry] = useState<Note | null>(null);
  const [form, setForm] = useState({ time: "", title: "", content: "" });

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<Note[]>(`/notes?child_id=${selectedChild.id}`);
      setEntries(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load notes.", "error");
    }
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const openAdd = () => {
    setEditingEntry(null);
    setForm({ time: "", title: "", content: "" });
    setDialogOpen(true);
  };

  const handleEdit = (entry: Note) => {
    setEditingEntry(entry);
    setForm({ time: isoToLocal(entry.time), title: entry.title || "", content: entry.content });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedChild) return;
    const payload = {
      time: new Date(form.time).toISOString(),
      title: form.title || null,
      content: form.content,
    };
    try {
      if (editingEntry) {
        await api.put(`/notes/${editingEntry.id}`, payload);
      } else {
        await api.post("/notes", { child_id: selectedChild.id, ...payload });
      }
      setDialogOpen(false);
      setEditingEntry(null);
      setForm({ time: "", title: "", content: "" });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save note.", "error");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/notes/${id}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete note.", "error");
    }
  };

  const openMenu = (e: React.MouseEvent<HTMLElement>, entry: Note) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuEntry(entry);
  };

  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuEntry(null);
  };

  if (!selectedChild) return <NoChildPlaceholder />;

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Notes</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openAdd}
          sx={{ display: { xs: "none", md: "inline-flex" } }}
        >
          Add Note
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
                    <TableCell>Time</TableCell>
                    <TableCell>Title</TableCell>
                    <TableCell>Content</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.map((n) => (
                    <TableRow key={n.id}>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{new Date(n.time).toLocaleString()}</TableCell>
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
      </Box>

      {/* Mobile: card stack */}
      <Box sx={{ display: { xs: "block", md: "none" } }}>
        {entries.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 8, px: 3, color: "text.secondary" }}>
            <NoteIcon sx={{ fontSize: 72, opacity: 0.25, mb: 2 }} />
            <Typography variant="h6" gutterBottom>No notes yet</Typography>
            <Typography variant="body2">Tap + to write the first one.</Typography>
          </Box>
        ) : (
          <Stack sx={{ gap: 1.5, pb: 12 }}>
            {entries.map((n) => (
              <Card key={n.id}>
                <CardActionArea onClick={() => handleEdit(n)}>
                  <CardContent sx={{ py: 1.75, "&:last-child": { pb: 1.75 } }}>
                    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", mb: 0.5 }}>
                          <Typography variant="h6" sx={{ lineHeight: 1.3, flex: 1, mr: 1 }} noWrap>
                            {n.title || "Note"}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                            {relativeTime(n.time)}
                          </Typography>
                        </Box>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            whiteSpace: "pre-wrap",
                            mb: 0.5,
                          }}
                        >
                          {n.content}
                        </Typography>
                        <Typography variant="caption" color="text.disabled">
                          {formatTime(n.time)}
                        </Typography>
                      </Box>
                      <IconButton
                        aria-label="More actions"
                        onClick={(e) => openMenu(e, n)}
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
        <MenuItem onClick={() => { if (menuEntry) handleEdit(menuEntry); closeMenu(); }}>
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem onClick={() => { if (menuEntry) handleDelete(menuEntry.id); closeMenu(); }}>
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      <Fab
        color="primary"
        aria-label="Add note"
        onClick={openAdd}
        sx={{ position: "fixed", bottom: { xs: "calc(56px + env(safe-area-inset-bottom) + 16px)", md: 24 }, right: 16, display: { xs: "flex", md: "none" } }}
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
        <DialogTitle>{editingEntry ? "Edit Note" : "Add Note"}</DialogTitle>
        <DialogContent sx={{ p: 2 }}>
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
            rows={isMobile ? 8 : 4}
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
