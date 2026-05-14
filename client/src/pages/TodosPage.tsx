import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardActionArea,
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
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ChecklistIcon from "@mui/icons-material/Checklist";
import { api } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import { FAB_BOTTOM_OFFSET } from "../components/Layout";
import NoChildPlaceholder from "../components/NoChildPlaceholder";
import type { Todo } from "../types/models";

type FilterTab = "all" | "active" | "completed";
type Priority = "low" | "medium" | "high";

const PRIORITY_COLORS: Record<Priority, "default" | "warning" | "error"> = {
  low: "default",
  medium: "warning",
  high: "error",
};

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

const EMPTY_FORM = { title: "", notes: "", due_date: "", priority: "medium" as Priority };

export default function TodosPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { selectedChild } = useChildren();
  const { notify } = useNotification();

  const [todos, setTodos] = useState<Todo[]>([]);
  const [filterTab, setFilterTab] = useState<FilterTab>("active");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuTodo, setMenuTodo] = useState<Todo | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = async () => {
    if (!selectedChild) return;
    try {
      const data = await api.get<Todo[]>(`/todos?child_id=${selectedChild.id}&limit=200`);
      setTodos(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load todos.", "error");
    }
  };

  useEffect(() => {
    load();
  }, [selectedChild]);

  const filtered = todos.filter((t) => {
    if (filterTab === "active") return !t.completed;
    if (filterTab === "completed") return !!t.completed;
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

  const activeCnt = todos.filter((t) => !t.completed).length;
  const completedCnt = todos.filter((t) => !!t.completed).length;

  if (!selectedChild) return <NoChildPlaceholder />;

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
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

      <Tabs
        value={filterTab}
        onChange={(_, v) => setFilterTab(v as FilterTab)}
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label={`Active (${activeCnt})`} value="active" />
        <Tab label={`Completed (${completedCnt})`} value="completed" />
        <Tab label={`All (${todos.length})`} value="all" />
      </Tabs>

      {/* Desktop table */}
      <Box sx={{ display: { xs: "none", md: "block" } }}>
        <Card>
          <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>Task</TableCell>
                    <TableCell>Priority</TableCell>
                    <TableCell>Due</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((todo) => (
                    <TableRow
                      key={todo.id}
                      sx={{ opacity: todo.completed ? 0.55 : 1 }}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={!!todo.completed}
                          onChange={() => handleToggle(todo)}
                          color="primary"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{ textDecoration: todo.completed ? "line-through" : "none", fontWeight: 500 }}
                        >
                          {todo.title}
                        </Typography>
                        {todo.notes && (
                          <Typography variant="caption" color="text.secondary">
                            {todo.notes}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={priorityLabel(todo.priority)}
                          color={PRIORITY_COLORS[todo.priority]}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {todo.due_date ? (
                          <Typography
                            variant="body2"
                            color={isOverdue(todo) ? "error" : "text.secondary"}
                            sx={{ fontWeight: isOverdue(todo) ? 600 : 400 }}
                          >
                            {formatDueDate(todo.due_date)}
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="text.disabled">—</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => openEdit(todo)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" onClick={() => handleDelete(todo.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                        <Typography color="text.secondary">
                          {filterTab === "active"
                            ? "No active tasks — great job!"
                            : filterTab === "completed"
                            ? "No completed tasks yet."
                            : "No tasks yet."}
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

      {/* Mobile card stack */}
      <Box sx={{ display: { xs: "block", md: "none" } }}>
        {filtered.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 8, px: 3, color: "text.secondary" }}>
            <ChecklistIcon sx={{ fontSize: 72, opacity: 0.25, mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              {filterTab === "active" ? "All caught up!" : "Nothing here yet."}
            </Typography>
            <Typography variant="body2">
              {filterTab === "active" ? "No active tasks." : "Tap + to add a task."}
            </Typography>
          </Box>
        ) : (
          <Stack sx={{ gap: 1.5, pb: 12 }}>
            {filtered.map((todo) => (
              <Card key={todo.id} sx={{ opacity: todo.completed ? 0.6 : 1 }}>
                <CardActionArea onClick={() => openEdit(todo)}>
                  <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                      <Checkbox
                        checked={!!todo.completed}
                        onChange={(e) => { e.stopPropagation(); handleToggle(todo); }}
                        onClick={(e) => e.stopPropagation()}
                        color="primary"
                        sx={{ mt: -0.5, ml: -1 }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="body1"
                          sx={{
                            fontWeight: 500,
                            textDecoration: todo.completed ? "line-through" : "none",
                            lineHeight: 1.3,
                          }}
                          noWrap
                        >
                          {todo.title}
                        </Typography>
                        {todo.notes && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              mt: 0.25,
                            }}
                          >
                            {todo.notes}
                          </Typography>
                        )}
                        <Box sx={{ display: "flex", gap: 1, mt: 0.75, flexWrap: "wrap", alignItems: "center" }}>
                          <Chip
                            label={priorityLabel(todo.priority)}
                            color={PRIORITY_COLORS[todo.priority]}
                            size="small"
                            variant="outlined"
                          />
                          {todo.due_date && (
                            <Typography
                              variant="caption"
                              color={isOverdue(todo) ? "error" : "text.secondary"}
                              sx={{ fontWeight: isOverdue(todo) ? 600 : 400 }}
                            >
                              {formatDueDate(todo.due_date)}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                      <IconButton
                        aria-label="More actions"
                        onClick={(e) => openMenu(e, todo)}
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
            if (menuTodo) openEdit(menuTodo);
            closeMenu();
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuTodo) handleToggle(menuTodo);
            closeMenu();
          }}
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
          sx={{ color: "error.main" }}
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
