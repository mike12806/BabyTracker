import { useEffect, useMemo, useState } from "react";
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
  InputAdornment,
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
import NoteIcon from "@mui/icons-material/Note";
import SearchIcon from "@mui/icons-material/Search";
import FilterListIcon from "@mui/icons-material/FilterList";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useDataRefresh } from "../hooks/useDataRefresh";
import { useNotification } from "../hooks/useNotification";
import NowButton from "../components/NowButton";
import { FAB_BOTTOM_OFFSET } from "../components/Layout";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import { buildCategoryColors } from "../theme/categoryColors";
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

type NoteTag = "milestone" | "health" | "pattern" | "general";

function inferTag(note: Note): NoteTag {
  const text = `${note.title ?? ""} ${note.content}`.toLowerCase();
  if (text.includes("milestone") || text.includes("first") || text.includes("rolled") || text.includes("crawl") || text.includes("walk") || text.includes("tooth")) return "milestone";
  if (text.includes("health") || text.includes("sick") || text.includes("fever") || text.includes("doctor") || text.includes("rash") || text.includes("allergy")) return "health";
  if (text.includes("pattern") || text.includes("schedule") || text.includes("routine") || text.includes("habit")) return "pattern";
  return "general";
}

export default function NotesPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { selectedChild } = useChildren();
  const { refreshKey } = useDataRefresh();
  const { notify } = useNotification();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);

  const [entries, setEntries] = useState<Note[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Note | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuEntry, setMenuEntry] = useState<Note | null>(null);
  const [form, setForm] = useState({ time: "", title: "", content: "" });
  const [searchQuery, setSearchQuery] = useState("");

  const tagColor = (tag: NoteTag) => {
    if (tag === "milestone") return cat.feed;
    if (tag === "health") return cat.med;
    return cat.note;
  };

  const tagLabel = (tag: NoteTag) => {
    if (tag === "milestone") return "Milestone";
    if (tag === "health") return "Health";
    if (tag === "pattern") return "Pattern";
    return "General";
  };

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
  }, [selectedChild, refreshKey]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(
      (n) =>
        (n.title ?? "").toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q),
    );
  }, [entries, searchQuery]);

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
    <Box sx={{ pb: { xs: 10, md: 0 } }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: { xs: 1.25, md: 2 } }}>
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

      {/* Search bar */}
      <TextField
        size="small"
        placeholder="Search notes..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        fullWidth
        sx={{
          mb: 2,
          "& .MuiOutlinedInput-root": {
            bgcolor: "background.paper",
            borderRadius: 3,
          },
        }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: "text.secondary", fontSize: 20 }} />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <FilterListIcon sx={{ color: "text.secondary", fontSize: 20 }} />
              </InputAdornment>
            ),
          },
        }}
      />

      {/* Desktop table */}
      <Box sx={{ display: { xs: "none", md: "block" } }}>
        <Card>
          <CardContent>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Time</TableCell>
                    <TableCell>Tag</TableCell>
                    <TableCell>Title</TableCell>
                    <TableCell>Content</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((n) => {
                    const tag = inferTag(n);
                    const tc = tagColor(tag);
                    return (
                      <TableRow
                        key={n.id}
                        hover
                        onClick={() => handleEdit(n)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell>{new Date(n.time).toLocaleString()}</TableCell>
                        <TableCell>
                          <Chip
                            label={tagLabel(tag)}
                            size="small"
                            sx={{
                              bgcolor: tc.soft,
                              color: tc.ink,
                              fontWeight: 600,
                              fontSize: 11,
                              height: 22,
                              border: 1,
                              borderColor: tc.edge,
                            }}
                          />
                        </TableCell>
                        <TableCell sx={{ fontWeight: 500 }}>{n.title || "—"}</TableCell>
                        <TableCell
                          sx={{
                            maxWidth: 380,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color: "text.secondary",
                          }}
                        >
                          {n.content}
                        </TableCell>
                        <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                          <IconButton size="small" onClick={() => handleEdit(n)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" onClick={() => handleDelete(n.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} align="center">
                        <Typography color="text.secondary">
                          {searchQuery ? "No matching notes." : "No notes yet."}
                        </Typography>
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
        {filtered.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 8, px: 3, color: "text.secondary" }}>
            <NoteIcon sx={{ fontSize: 72, opacity: 0.25, mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              {searchQuery ? "No matching notes" : "No notes yet"}
            </Typography>
            <Typography variant="body2">
              {searchQuery ? "Try a different search term." : "Tap + to write the first one."}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ pb: 12 }}>
            {filtered.map((n) => {
              const tag = inferTag(n);
              const tc = tagColor(tag);
              return (
                <Box
                  key={n.id}
                  onClick={() => handleEdit(n)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    p: "8px 10px",
                    bgcolor: "background.paper",
                    border: 1,
                    borderColor: "divider",
                    borderLeftWidth: 3,
                    borderLeftColor: tc.solid,
                    borderRadius: 2,
                    position: "relative",
                    overflow: "hidden",
                    boxShadow: 0,
                    mb: 0.5,
                    cursor: "pointer",
                  }}
                >
                  <Box
                    sx={{
                      width: 26,
                      height: 26,
                      borderRadius: "8px",
                      bgcolor: tc.soft,
                      color: tc.ink,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      ml: 0.25,
                    }}
                  >
                    <NoteIcon sx={{ fontSize: 14 }} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        letterSpacing: "-0.005em",
                        lineHeight: 1.2,
                      }}
                      noWrap
                    >
                      {n.title || "Note"}
                    </Typography>
                    <Typography
                      sx={{ fontSize: 10.5, color: "text.secondary", mt: 0, lineHeight: 1.2 }}
                      noWrap
                    >
                      {n.content}
                    </Typography>
                  </Box>
                  <Typography
                    sx={{
                      fontSize: 11,
                      color: "text.secondary",
                      fontWeight: 500,
                      fontVariantNumeric: "tabular-nums",
                      flexShrink: 0,
                      mr: 3.25,
                    }}
                  >
                    {relativeTime(n.time)}
                  </Typography>
                  <IconButton
                    aria-label="More actions"
                    onClick={(e) => openMenu(e, n)}
                    sx={{
                      position: "absolute",
                      right: 2,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 28,
                      height: 28,
                      minWidth: 28,
                      minHeight: 28,
                    }}
                  >
                    <MoreVertIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              );
            })}
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
        aria-label="Add note"
        onClick={openAdd}
        sx={{ position: "fixed", bottom: { xs: FAB_BOTTOM_OFFSET, md: 24 }, right: 16, display: { xs: "flex", md: "none" } }}
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
              sx={{ flex: 1, minWidth: 0 }}
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
