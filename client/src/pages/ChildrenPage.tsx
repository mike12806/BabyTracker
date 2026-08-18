import { useMemo, useRef, useState } from "react";
import {
  Avatar,
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
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import ChildCareIcon from "@mui/icons-material/ChildCare";
import { api, API_BASE } from "../api/client";
import { useChildren } from "../hooks/useChildren";
import { useNotification } from "../hooks/useNotification";
import { FAB_BOTTOM_OFFSET } from "../components/Layout";
import { buildCategoryColors } from "../theme/categoryColors";
import type { Child } from "../types/models";
import { useSaveGuard } from "../hooks/useSaveGuard";

function formatAge(birthDateStr: string): string {
  const [y, m, d] = birthDateStr.split("T")[0].split("-").map(Number);
  const birth = new Date(y, m - 1, d);
  const now = new Date();
  const diffMs = now.getTime() - birth.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30.44);
  const diffYears = Math.floor(diffDays / 365.25);
  if (diffWeeks < 8) return `${diffWeeks} week${diffWeeks === 1 ? "" : "s"} old`;
  if (diffMonths < 24) return `${diffMonths} month${diffMonths === 1 ? "" : "s"} old`;
  return `${diffYears} year${diffYears === 1 ? "" : "s"} old`;
}

function formatBirthDate(birthDateStr: string): string {
  const [y, m, d] = birthDateStr.split("T")[0].split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export default function ChildrenPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { children, selectedChild, selectChild, refreshChildren, defaultChildId, setDefaultChild } = useChildren();
  const { notify } = useNotification();
  const { saving, save } = useSaveGuard();
  const isDark = theme.palette.mode === "dark";
  const cat = useMemo(() => buildCategoryColors(isDark), [isDark]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Child | null>(null);
  const [form, setForm] = useState({ first_name: "", last_name: "", birth_date: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addPhotoRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<number | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm({ first_name: "", last_name: "", birth_date: "" });
    setPendingPhoto(null);
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
      setPhotoPreview(null);
    }
    setDialogOpen(true);
  };

  const handleAddPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPendingPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
    if (addPhotoRef.current) addPhotoRef.current.value = "";
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
    await save(form, async (idempotencyKey) => {
      try {
        if (editing) {
          await api.put(`/children/${editing.id}`, form);
        } else {
          // A replayed key returns the child the first attempt created, so the
          // photo lands on that one rather than on a second Emma.
          const newChild = await api.post<Child>("/children", {
            ...form,
            client_request_id: idempotencyKey,
          });
          if (pendingPhoto) {
            const formData = new FormData();
            formData.append("photo", pendingPhoto);
            await api.upload(`/children/${newChild.id}/photo`, formData);
          }
        }
        setDialogOpen(false);
        if (photoPreview) {
          URL.revokeObjectURL(photoPreview);
          setPhotoPreview(null);
        }
        setPendingPhoto(null);
        await refreshChildren();
      } catch (err) {
        notify(err instanceof Error ? err.message : "Failed to save child.", "error");
      }
    });
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this child and all their data?")) return;
    try {
      await api.delete(`/children/${id}`);
      await refreshChildren();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete child.", "error");
    }
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
    try {
      await api.upload(`/children/${uploadTargetId}/photo`, formData);
      setUploadTargetId(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshChildren();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to upload photo.", "error");
    }
  };

  const handleToggleDefault = async (childId: number) => {
    try {
      await setDefaultChild(defaultChildId === childId ? null : childId);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to update default child.", "error");
    }
  };

  const photoUrl = (child: Child) =>
    child.picture_content_type
      ? `${API_BASE}/children/${child.id}/photo?v=${encodeURIComponent(child.updated_at)}`
      : undefined;

  // Gradient colors per card index
  const gradients = [
    { from: cat.feed.tile, to: cat.sleep.tile },
    { from: cat.pump.tile, to: cat.tummy.tile },
    { from: cat.note.tile, to: cat.feed.tile },
    { from: cat.sleep.tile, to: cat.pump.tile },
  ];

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Children</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openCreate}
          sx={{ display: { xs: "none", md: "inline-flex" } }}
        >
          Add Child
        </Button>
      </Box>

      {children.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 10, px: 3, color: "text.secondary" }}>
          <ChildCareIcon sx={{ fontSize: 80, opacity: 0.25, mb: 2 }} />
          <Typography variant="h5" gutterBottom>Add your first child</Typography>
          <Typography variant="body1" sx={{ mb: 3 }}>Tap + to get started tracking.</Typography>
          <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={openCreate}>
            Add Child
          </Button>
        </Box>
      ) : (
        <Grid container spacing={2} sx={{ pb: 12 }}>
          {children.map((child, idx) => {
            const isActive = selectedChild?.id === child.id;
            const isDefault = defaultChildId === child.id;
            const grad = gradients[idx % gradients.length];
            return (
              <Grid key={child.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card
                  sx={{
                    background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
                    border: 1,
                    borderColor: isActive ? cat.feed.solid : "divider",
                    borderRadius: 3,
                    boxShadow: isActive ? 3 : 1,
                    transition: "border-color 0.15s, box-shadow 0.15s",
                    overflow: "hidden",
                  }}
                >
                  <CardActionArea
                    onClick={() => selectChild(child)}
                    sx={{ pb: 0 }}
                  >
                    <CardContent sx={{ textAlign: "center", pt: 3, pb: 1 }}>
                      {/* Tappable avatar for photo change */}
                      <Box
                        onClick={(e) => { e.stopPropagation(); handlePhotoClick(child.id); }}
                        sx={{
                          display: "inline-block",
                          position: "relative",
                          cursor: "pointer",
                          mb: 1.5,
                          "&:hover .photo-overlay": { opacity: 1 },
                        }}
                      >
                        <Avatar
                          src={photoUrl(child)}
                          alt={child.first_name}
                          sx={{
                            width: 60,
                            height: 60,
                            fontSize: 24,
                            mx: "auto",
                            border: 2,
                            borderColor: "background.paper",
                            boxShadow: 1,
                          }}
                        >
                          {child.first_name[0]}
                        </Avatar>
                        <Box
                          className="photo-overlay"
                          sx={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: "50%",
                            backgroundColor: "rgba(0,0,0,0.45)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            opacity: 0,
                            transition: "opacity 0.15s",
                            color: "#fff",
                          }}
                        >
                          <PhotoCameraIcon fontSize="small" />
                        </Box>
                      </Box>

                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {`${child.first_name} ${child.last_name}`}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {formatAge(child.birth_date)}
                      </Typography>
                      <Typography variant="caption" color="text.disabled" sx={{ display: "block", mb: 1 }}>
                        Born {formatBirthDate(child.birth_date)}
                      </Typography>

                      <Box sx={{ display: "flex", gap: 0.75, justifyContent: "center", mb: 1, flexWrap: "wrap" }}>
                        {isActive && (
                          <Chip
                            label="Active"
                            size="small"
                            sx={{
                              bgcolor: cat.feed.solid,
                              color: "#fff",
                              fontWeight: 600,
                              fontSize: 11,
                              height: 22,
                            }}
                          />
                        )}
                        {isDefault && (
                          <Chip
                            label="Default"
                            size="small"
                            variant="outlined"
                            sx={{
                              borderColor: cat.feed.edge,
                              color: cat.feed.ink,
                              fontWeight: 600,
                              fontSize: 11,
                              height: 22,
                            }}
                          />
                        )}
                      </Box>
                    </CardContent>
                  </CardActionArea>

                  {/* Action row */}
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "center",
                      gap: 0.5,
                      pb: 1.5,
                      pt: 0.5,
                      borderTop: 1,
                      borderColor: "divider",
                    }}
                  >
                    <IconButton
                      onClick={() => handleToggleDefault(child.id)}
                      title={isDefault ? "Remove as default" : "Set as default"}
                      color={isDefault ? "primary" : "default"}
                      sx={{ minWidth: 44, minHeight: 44 }}
                    >
                      {isDefault ? <StarIcon /> : <StarBorderIcon />}
                    </IconButton>
                    <IconButton
                      onClick={(e) => { e.stopPropagation(); openEdit(child); }}
                      sx={{ minWidth: 44, minHeight: 44 }}
                    >
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      onClick={(e) => { e.stopPropagation(); handleDelete(child.id); }}
                      sx={{ minWidth: 44, minHeight: 44 }}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                </Card>
              </Grid>
            );
          })}

          {/* "Add a child" card */}
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <Card
              sx={{
                border: 2,
                borderStyle: "dashed",
                borderColor: "divider",
                borderRadius: 3,
                bgcolor: "transparent",
                boxShadow: 0,
                cursor: "pointer",
                transition: "border-color 0.15s",
                "&:hover": { borderColor: "text.secondary" },
                minHeight: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onClick={openCreate}
            >
              <CardContent sx={{ textAlign: "center" }}>
                <AddIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography variant="body1" sx={{ color: "text.secondary", fontWeight: 600 }}>
                  Add a child
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={handlePhotoChange}
      />
      <input
        ref={addPhotoRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={handleAddPhotoChange}
      />

      <Fab
        color="primary"
        aria-label="Add child"
        onClick={openCreate}
        sx={{ position: "fixed", bottom: { xs: FAB_BOTTOM_OFFSET, md: 24 }, right: 16, display: { xs: "flex", md: "none" } }}
      >
        <AddIcon />
      </Fab>

      <Dialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          if (photoPreview) { URL.revokeObjectURL(photoPreview); setPhotoPreview(null); }
          setPendingPhoto(null);
        }}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
        slotProps={{ paper: { sx: { display: "flex", flexDirection: "column" } } }}
      >
        <DialogTitle>{editing ? "Edit Child" : "Add Child"}</DialogTitle>
        <DialogContent sx={{ p: 2, overflowY: "auto", flex: 1 }}>
          {/* Photo picker */}
          <Box
            sx={{ textAlign: "center", mb: 2 }}
            onClick={() => editing ? handlePhotoClick(editing.id) : addPhotoRef.current?.click()}
          >
            <Box
              sx={{
                display: "inline-block",
                position: "relative",
                cursor: "pointer",
                "&:hover .photo-overlay": { opacity: 1 },
              }}
            >
              <Avatar
                src={editing ? photoUrl(editing) : (photoPreview ?? undefined)}
                sx={{ width: 120, height: 120, fontSize: 48, mx: "auto" }}
              >
                {editing ? editing.first_name[0] : <PhotoCameraIcon sx={{ fontSize: 48 }} />}
              </Avatar>
              <Box
                className="photo-overlay"
                sx={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  backgroundColor: "rgba(0,0,0,0.45)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: 0,
                  transition: "opacity 0.15s",
                  color: "#fff",
                }}
              >
                <PhotoCameraIcon sx={{ fontSize: 32 }} />
              </Box>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
              {editing ? "Tap to change photo" : "Tap to add photo"}
            </Typography>
          </Box>

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
        <DialogActions sx={{ px: 2, pb: 2 }}>
          <Button onClick={() => {
            setDialogOpen(false);
            if (photoPreview) { URL.revokeObjectURL(photoPreview); setPhotoPreview(null); }
            setPendingPhoto(null);
          }}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={saving || !form.first_name || !form.birth_date}>
            {saving ? "Saving…" : editing ? "Save" : "Add"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
