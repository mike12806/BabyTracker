import { useRef, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import { api, API_BASE } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import type { Child } from "../types/models";

export default function ChildrenPage() {
  const { children, refreshChildren, defaultChildId, setDefaultChild } = useChildren();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Child | null>(null);
  const [form, setForm] = useState({ first_name: "", last_name: "", birth_date: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<number | null>(null);
  const [photoVersion, setPhotoVersion] = useState(0);

  const openCreate = () => {
    setEditing(null);
    setForm({ first_name: "", last_name: "", birth_date: "" });
    setDialogOpen(true);
  };

  const openEdit = (child: Child) => {
    setEditing(child);
    setForm({
      first_name: child.first_name,
      last_name: child.last_name,
      birth_date: child.birth_date.split("T")[0],
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (editing) {
      await api.put(`/children/${editing.id}`, form);
    } else {
      await api.post("/children", form);
    }
    setDialogOpen(false);
    await refreshChildren();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this child and all their data?")) return;
    await api.delete(`/children/${id}`);
    await refreshChildren();
  };

  const handlePhotoClick = (childId: number) => {
    setUploadTargetId(childId);
    fileInputRef.current?.click();
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetId) return;

    const formData = new FormData();
    formData.append("photo", file);

    await api.upload(`/children/${uploadTargetId}/photo`, formData);
    setUploadTargetId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setPhotoVersion((v) => v + 1);
    await refreshChildren();
  };

  const handleToggleDefault = async (childId: number) => {
    await setDefaultChild(defaultChildId === childId ? null : childId);
  };

  const photoUrl = (child: Child) =>
    child.picture_content_type ? `${API_BASE}/children/${child.id}/photo?v=${photoVersion}` : undefined;

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Children</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Add Child
        </Button>
      </Box>

      <Card>
        <CardContent>
          {children.length === 0 ? (
            <Typography color="text.secondary">No children added yet.</Typography>
          ) : (
            <List>
              {children.map((child) => (
                <ListItem
                  key={child.id}
                  secondaryAction={
                    <Box>
                      <IconButton
                        onClick={() => handleToggleDefault(child.id)}
                        title={defaultChildId === child.id ? "Remove as default" : "Set as default"}
                        color={defaultChildId === child.id ? "primary" : "default"}
                      >
                        {defaultChildId === child.id ? <StarIcon /> : <StarBorderIcon />}
                      </IconButton>
                      <IconButton onClick={() => handlePhotoClick(child.id)} title="Upload photo">
                        <PhotoCameraIcon />
                      </IconButton>
                      <IconButton onClick={() => openEdit(child)}>
                        <EditIcon />
                      </IconButton>
                      <IconButton onClick={() => handleDelete(child.id)}>
                        <DeleteIcon />
                      </IconButton>
                    </Box>
                  }
                >
                  <ListItemAvatar>
                    <Avatar
                      src={photoUrl(child)}
                      alt={child.first_name}
                      sx={{ width: 48, height: 48, mr: 1 }}
                    >
                      {child.first_name[0]}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        {`${child.first_name} ${child.last_name}`}
                        {defaultChildId === child.id && (
                          <Chip label="Default" size="small" color="primary" variant="outlined" />
                        )}
                      </Box>
                    }
                    secondary={`Born ${new Date(child.birth_date).toLocaleDateString()}`}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={handlePhotoChange}
      />

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? "Edit Child" : "Add Child"}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="First Name"
            fullWidth
            required
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
          />
          <TextField
            margin="dense"
            label="Last Name"
            fullWidth
            value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
          />
          <TextField
            margin="dense"
            label="Birth Date"
            type="date"
            fullWidth
            required
            slotProps={{ inputLabel: { shrink: true } }}
            value={form.birth_date}
            onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={!form.first_name || !form.birth_date}>
            {editing ? "Save" : "Add"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
