import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
  FormControl,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Select,
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
import ChecklistIcon from "@mui/icons-material/Checklist";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import { useDataRefresh } from "../hooks/useDataRefresh";
import { FAB_BOTTOM_OFFSET } from "../components/Layout";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import { buildCategoryColors } from "../theme/categoryColors";
import type { Todo } from "../types/models";

type FilterTab = "active" | "high" | "today" | "overdue" | "completed";
type Priority = "low" | "medium" | "high";

function priorityLabel(p: Priority): string {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function formatDueDate(dateStr: string): string {
  const due = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays < 7) return `In ${diffDays}d`;
  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isOverdue(todo: Todo): boolean {
  if (!todo.due_date || todo.completed) return false;
  const due = new Date(todo.due_date + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function isDueToday(todo: Todo): boolean {
  if (!todo.due_date || todo.completed) return false;
  const due = new Date(todo.due_date + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() === today.getTime();
}

const EMPTY_FORM = { title: "", notes: "", due_date: "", priority: "medium" as Priority };

export default function TodosPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { selectedChild } = useChildren();
  const { notify } = useNotification();
  const { refreshKey } = useDataRefresh();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);

  const [todos, setTodos] = useState<Todo[]>([]);
  const [filterTab, setFilterTab] = useState<FilterTab>("active");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuTodo, setMenuTodo] = useState<Todo | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const priorityColor = (p: Priority) => {
    if (p === "high") return cat.temp.solid;
    if (p === "medium") return cat.diaper.solid;
    return cat.note.solid;
  };

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<Todo[]>(`/todos?child_id=${selectedChild.id}&limit=200`);
      setTodos(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load todos.", "error");
    }
  };

  // Refetches on mount, when the child changes, and whenever `refreshKey` is
  // bumped — returning to the app, or logging an entry from the bottom-nav
  // FAB, refreshes this list instead of leaving the pre-existing one on screen.
  useEffect(() => {
    load();
  }, [selectedChild, refreshKey]);

  const filtered = todos.filter((t) => {
    if (filterTab === "active") return !t.completed;
    if (filterTab === "completed") return !!t.completed;
    if (filterTab === "high") return !t.completed && t.priority === "high";
    if (filterTab === "today") return isDueToday(t);
    if (filterTab === "overdue") return isOverdue(t);
    return true;
  });

  const openAdd = () => {
    setEditingTodo(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (todo: Todo) => {
    setEditingTodo(todo);
    setForm({
      title: todo.title,
      notes: todo.notes ?? "",
      due_date: todo.due_date ?? "",
      priority: todo.priority,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingTodo(null);
  };

  const handleSave = async () => {
    if (!selectedChild || !form.title.trim()) return;
    const payload = {
      title: form.title.trim(),
      notes: form.notes || null,
      due_date: form.due_date || null,
      priority: form.priority,
    };
    try {
      if (editingTodo) {
        await api.put(`/todos/${editingTodo.id}`, payload);
      } else {
        await api.post("/todos", { child_id: selectedChild.id, ...payload });
      }
      closeDialog();
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save todo.", "error");
    }
  };

  const handleToggle = async (todo: Todo) => {
    try {
      await api.put(`/todos/${todo.id}`, { completed: !todo.completed });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to update todo.", "error");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/todos/${id}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete todo.", "error");
    }
  };

  const openMenu = (e: React.MouseEvent<HTMLElement>, todo: Todo) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuTodo(todo);
  };

  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuTodo(null);
  };

  const overdueCnt = todos.filter((t) => isOverdue(t)).length;
  const highCnt = todos.filter((t) => !t.completed && t.priority === "high").length;
  const todayCnt = todos.filter((t) => isDueToday(t)).length;
  const activeCnt = todos.filter((t) => !t.completed).length;
  const completedCnt = todos.filter((t) => !!t.completed).length;

  if (!selectedChild) return <NoChildPlaceholder />;

  const pills: { key: FilterTab; label: string; count?: number; dot?: string }[] = [
    { key: "active", label: "Active", count: activeCnt },
    { key: "high", label: "High", dot: cat.temp.solid, count: highCnt },
    { key: "today", label: "Today", count: todayCnt },
    { key: "overdue", label: "Overdue", dot: cat.temp.solid, count: overdueCnt },
    { key: "completed", label: "Completed", count: completedCnt },
  ];

  return (
    <Box sx={{ pb: { xs: 10, md: 0 } }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: { xs: 1.25, md: 2 } }}>
        <Typography variant="h4">To-Do</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openAdd}
          sx={{ display: { xs: "none", md: "inline-flex" } }}
        >
          Add Task
        </Button>
      </Box>

      {/* Filter pill row */}
      <Box
        sx={{
          display: "flex",
          gap: 1,
          mb: 2,
          overflowX: "auto",
          pb: 0.5,
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {pills.map((p) => {
          const active = filterTab === p.key;
          return (
            <Box
              key={p.key}
              onClick={() => setFilterTab(p.key)}
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.75,
                px: 1.75,
                py: 0.75,
                borderRadius: 99,
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontSize: 13,
                fontWeight: 600,
                userSelect: "none",
                transition: "all 0.15s",
                bgcolor: active ? "text.primary" : "background.paper",
                color: active ? "background.default" : "text.primary",
                border: 1,
                borderColor: active ? "text.primary" : "divider",
              }}
            >
              {p.dot && (
                <Box
                  sx={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    bgcolor: p.dot,
                    flexShrink: 0,
                  }}
                />
              )}
              {p.label}
              {p.count != null && p.count > 0 && (
                <Box
                  component="span"
                  sx={{ opacity: 0.7, fontSize: 12, ml: 0.25 }}
                >
                  {p.count}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Overdue callout banner */}
      {filterTab !== "completed" && overdueCnt > 0 && (
        <Box
          sx={{
            mb: 2,
            px: 2,
            py: 1.5,
            borderRadius: 3,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            background: `linear-gradient(135deg, ${cat.temp.tile}, ${cat.temp.soft})`,
            border: 1,
            borderColor: cat.temp.edge,
          }}
        >
          <WarningAmberIcon sx={{ color: cat.temp.solid, fontSize: 22 }} />
          <Typography variant="body2" sx={{ fontWeight: 600, color: cat.temp.ink }}>
            {overdueCnt} overdue task{overdueCnt !== 1 ? "s" : ""} need{overdueCnt === 1 ? "s" : ""} attention
          </Typography>
        </Box>
      )}

      {/* Desktop table */}
      <Box sx={{ display: { xs: "none", md: "block" } }}>
        <Card>
          <CardContent>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>Title</TableCell>
                    <TableCell>Priority</TableCell>
                    <TableCell>Due</TableCell>
                    <TableCell>Notes</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((todo) => {
                    const completed = !!todo.completed;
                    const overdue = isOverdue(todo);
                    return (
                      <TableRow
                        key={todo.id}
                        hover
                        onClick={() => openEdit(todo)}
                        sx={{ cursor: "pointer", opacity: completed ? 0.6 : 1 }}
                      >
                        <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={completed}
                            onChange={() => handleToggle(todo)}
                            sx={{
                              color: priorityColor(todo.priority),
                              "&.Mui-checked": { color: priorityColor(todo.priority) },
                            }}
                          />
                        </TableCell>
                        <TableCell
                          sx={{
                            fontWeight: 500,
                            textDecoration: completed ? "line-through" : "none",
                          }}
                        >
                          {todo.title}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={priorityLabel(todo.priority)}
                            size="small"
                            sx={{
                              bgcolor: priorityColor(todo.priority),
                              color: "#fff",
                              fontWeight: 600,
                              fontSize: 11,
                              height: 22,
                            }}
                          />
                        </TableCell>
                        <TableCell
                          sx={{
                            fontWeight: overdue ? 700 : 400,
                            color: overdue ? cat.temp.solid : "text.primary",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {todo.due_date ? formatDueDate(todo.due_date) : "—"}
                        </TableCell>
                        <TableCell
                          sx={{
                            maxWidth: 320,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color: "text.secondary",
                          }}
                        >
                          {todo.notes || "—"}
                        </TableCell>
                        <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                          <IconButton size="small" onClick={() => openEdit(todo)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" onClick={() => handleDelete(todo.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} align="center">
                        <Typography color="text.secondary">
                          {filterTab === "active"
                            ? "No active tasks."
                            : filterTab === "completed"
                              ? "No completed tasks yet."
                              : "Nothing here yet."}
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
            <ChecklistIcon sx={{ fontSize: 72, opacity: 0.25, mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              {filterTab === "active"
                ? "All caught up!"
                : filterTab === "completed"
                  ? "No completed tasks yet."
                  : "Nothing here yet."}
            </Typography>
            <Typography variant="body2">
              {filterTab === "active" ? "No active tasks." : "Tap + to add a task."}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ pb: 12 }}>
            {filtered.map((todo) => {
              const completed = !!todo.completed;
              const overdue = isOverdue(todo);
              const pColor = priorityColor(todo.priority);
              return (
                <Box
                  key={todo.id}
                  onClick={() => openEdit(todo)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    p: "8px 10px",
                    bgcolor: "background.paper",
                    border: 1,
                    borderColor: "divider",
                    borderLeftWidth: 3,
                    borderLeftColor: pColor,
                    borderRadius: 2,
                    position: "relative",
                    overflow: "hidden",
                    boxShadow: 0,
                    mb: 0.5,
                    cursor: "pointer",
                    opacity: completed ? 0.6 : 1,
                  }}
                >
                  <Checkbox
                    checked={completed}
                    onChange={() => handleToggle(todo)}
                    onClick={(e) => e.stopPropagation()}
                    size="small"
                    sx={{
                      p: 0.5,
                      ml: 0.25,
                      color: pColor,
                      "&.Mui-checked": { color: pColor },
                    }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        letterSpacing: "-0.005em",
                        lineHeight: 1.2,
                        textDecoration: completed ? "line-through" : "none",
                      }}
                      noWrap
                    >
                      {todo.title}
                    </Typography>
                    <Typography
                      sx={{ fontSize: 10.5, color: "text.secondary", mt: 0, lineHeight: 1.2 }}
                      noWrap
                    >
                      {todo.notes || priorityLabel(todo.priority)}
                    </Typography>
                  </Box>
                  {todo.due_date && (
                    <Typography
                      sx={{
                        fontSize: 11,
                        color: overdue ? cat.temp.solid : "text.secondary",
                        fontWeight: overdue ? 700 : 500,
                        fontVariantNumeric: "tabular-nums",
                        flexShrink: 0,
                        mr: 3.25,
                      }}
                    >
                      {formatDueDate(todo.due_date)}
                    </Typography>
                  )}
                  <IconButton
                    aria-label="More actions"
                    onClick={(e) => openMenu(e, todo)}
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
            if (menuTodo) openEdit(menuTodo);
            closeMenu();
          }}
          sx={{ minHeight: 44 }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuTodo) handleToggle(menuTodo);
            closeMenu();
          }}
          sx={{ minHeight: 44 }}
        >
          <Checkbox
            checked={!!menuTodo?.completed}
            size="small"
            sx={{ p: 0, mr: 1 }}
            disableRipple
          />
          {menuTodo?.completed ? "Mark active" : "Mark complete"}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuTodo) handleDelete(menuTodo.id);
            closeMenu();
          }}
          sx={{ minHeight: 44, color: "error.main" }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      <Fab
        color="primary"
        aria-label="Add task"
        onClick={openAdd}
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
        <DialogTitle>{editingTodo ? "Edit Task" : "Add Task"}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <TextField
            margin="dense"
            label="Title"
            fullWidth
            required
            autoFocus
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <TextField
            margin="dense"
            label="Notes"
            fullWidth
            multiline
            rows={isMobile ? 4 : 3}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <TextField
            margin="dense"
            label="Due Date"
            type="date"
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />
          <FormControl fullWidth margin="dense">
            <InputLabel id="priority-label">Priority</InputLabel>
            <Select
              labelId="priority-label"
              label="Priority"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
            >
              <MenuItem value="low">Low</MenuItem>
              <MenuItem value="medium">Medium</MenuItem>
              <MenuItem value="high">High</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={!form.title.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
