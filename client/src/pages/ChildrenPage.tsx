import { useEffect, useMemo, useRef, useState } from "react";
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
import PhotoCropDialog from "../components/PhotoCropDialog";
import { PHOTO_INPUT_ACCEPT, describePickedFileProblem } from "../utils/imageCrop";
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
  // One input per trigger: the card avatars share the page-level input, the
  // dialog carries its own. Each opener reaches an input in its own subtree
  // rather than across the portal boundary a modal puts between them.
  const cardInputRef = useRef<HTMLInputElement>(null);
  const dialogInputRef = useRef<HTMLInputElement>(null);
  // Which child a picked photo belongs to. `null` means "the child being
  // filled in right now" — the upload waits for the save that gives it an id.
  const [photoTargetId, setPhotoTargetId] = useState<number | null>(null);
  const [cropSource, setCropSource] = useState<File | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Object URLs outlive the component unless revoked, and the preview is
  // replaced on every re-pick.
  const previewRef = useRef<string | null>(null);
  useEffect(() => {
    previewRef.current = photoPreview;
  }, [photoPreview]);
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const clearPendingPhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setPendingPhoto(null);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ first_name: "", last_name: "", birth_date: "" });
    clearPendingPhoto();
    setDialogOpen(true);
  };

  const openEdit = (child: Child) => {
    setEditing(child);
    setForm({
      first_name: child.first_name,
      last_name: child.last_name,
      birth_date: child.birth_date.split("T")[0],
    });
    clearPendingPhoto();
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    clearPendingPhoto();
  };

  const pickPhotoForChild = (childId: number) => {
    setPhotoTargetId(childId);
    cardInputRef.current?.click();
  };

  const pickPhotoInDialog = () => {
    setPhotoTargetId(null);
    dialogInputRef.current?.click();
  };

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared before anything else: without it, picking the same file again
    // fires no `change` event and the cropper never opens.
    e.target.value = "";
    if (!file) return;

    const problem = describePickedFileProblem(file);
    if (problem) {
      setPhotoTargetId(null);
      notify(problem, "error");
      return;
    }

    setCropSource(file);
  };

  const uploadPhoto = async (childId: number, photo: File) => {
    const formData = new FormData();
    formData.append("photo", photo);
    await api.upload(`/children/${childId}/photo`, formData);
  };

  // Called with the square JPEG the cropper produced — a few dozen KB, where
  // the phone photo it came from was several MB and used to be rejected
  // outright by the upload cap.
  const handleCropped = async (cropped: File) => {
    const targetId = photoTargetId;
    setCropSource(null);
    setPhotoTargetId(null);

    if (targetId === null) {
      // No child id yet — hold it until the dialog is saved.
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPendingPhoto(cropped);
      setPhotoPreview(URL.createObjectURL(cropped));
      return;
    }

    try {
      await uploadPhoto(targetId, cropped);
      await refreshChildren();
      notify("Photo updated.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to upload photo.", "error");
    }
  };

  const cancelCrop = () => {
    setCropSource(null);
    setPhotoTargetId(null);
  };

  const handleSave = async () => {
    await save(form, async (idempotencyKey) => {
      try {
        // The key rides on the create only — a PUT is already idempotent. A
        // replayed key returns the child the first attempt made, so the photo
        // below lands on that one rather than on a second Emma.
        const saved = editing
          ? await api.put<Child>(`/children/${editing.id}`, form)
          : await api.post<Child>("/children", { ...form, client_request_id: idempotencyKey });

        if (pendingPhoto) {
          try {
            await uploadPhoto(saved.id, pendingPhoto);
          } catch (err) {
            // The child itself is saved by now, so closing and reporting beats
            // leaving the dialog open over a record that already exists — a
            // second attempt would create a duplicate.
            notify(err instanceof Error ? err.message : "Child saved, but the photo didn't upload.", "warning");
          }
        }

        closeDialog();
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
                        onClick={(e) => { e.stopPropagation(); pickPhotoForChild(child.id); }}
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

      <Box
        component="input"
        ref={cardInputRef}
        type="file"
        accept={PHOTO_INPUT_ACCEPT}
        sx={{ display: "none" }}
        onChange={handleFilePicked}
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
        onClose={closeDialog}
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
            onClick={pickPhotoInDialog}
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
                src={photoPreview ?? (editing ? photoUrl(editing) : undefined)}
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
              {photoPreview || editing?.picture_content_type ? "Tap to change photo" : "Tap to add photo"}
            </Typography>
          </Box>

          {/* Outside the tappable area above: a programmatic `click()` on this
              input bubbles, and inside it that would re-enter the handler that
              just fired. */}
          <Box
            component="input"
            ref={dialogInputRef}
            type="file"
            accept={PHOTO_INPUT_ACCEPT}
            sx={{ display: "none" }}
            onChange={handleFilePicked}
          />

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
          <Button onClick={closeDialog}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={saving || !form.first_name || !form.birth_date}>
            {saving ? "Saving…" : editing ? "Save" : "Add"}
          </Button>
        </DialogActions>
      </Dialog>

      <PhotoCropDialog file={cropSource} onCancel={cancelCrop} onConfirm={handleCropped} />
    </Box>
  );
}
