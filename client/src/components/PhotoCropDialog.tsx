import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Slider,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  centeredOffset,
  clampOffset,
  clampZoom,
  coverScale,
  cropRect,
  cropToFile,
  loadImageFile,
  offsetAfterZoom,
  scaledSize,
  type ImageSize,
  type Point,
} from "../utils/imageCrop";

interface PhotoCropDialogProps {
  /** The picked file. Loading starts when this changes, so re-picking the same photo re-opens a fresh crop. */
  file: File | null;
  onCancel: () => void;
  onConfirm: (cropped: File) => void | Promise<void>;
}

/**
 * Frames a picked photo before it is uploaded.
 *
 * The viewport is round because that is how the result is shown everywhere —
 * cropping against the same shape is the only way to know what the avatar will
 * look like. Drag to reposition, pinch/wheel/slider to zoom; zoom 1 is the
 * tightest framing that still covers the circle, so the crop can never include
 * empty space.
 */
/**
 * Diameter of the crop circle.
 *
 * Sized from the window rather than a breakpoint so the dialog never needs an
 * inner scrollbar: the rest of it (title, slider, caption, buttons) is about
 * 300px, and a phone held sideways has very little height to spare.
 */
function frameSizeFor(width: number, height: number): number {
  return Math.max(180, Math.min(320, Math.min(width - 96, height - 300)));
}

export default function PhotoCropDialog({ file, onCancel, onConfirm }: PhotoCropDialogProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [viewport, setViewport] = useState(() =>
    typeof window === "undefined" ? 320 : frameSizeFor(window.innerWidth, window.innerHeight)
  );
  useEffect(() => {
    const onResize = () => setViewport(frameSizeFor(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  const [source, setSource] = useState<{ image: HTMLImageElement; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<{ zoom: number; offset: Point }>({ zoom: MIN_ZOOM, offset: { x: 0, y: 0 } });

  const frameRef = useRef<HTMLDivElement | null>(null);
  // Pointers currently down on the viewport, by id: one is a drag, two a pinch.
  const pointers = useRef(new Map<number, Point>());

  const naturalSize: ImageSize | null = useMemo(
    () => (source ? { width: source.image.naturalWidth, height: source.image.naturalHeight } : null),
    [source]
  );
  const base = useMemo(
    () => (naturalSize ? coverScale(naturalSize, viewport) : 1),
    [naturalSize, viewport]
  );
  const scale = base * view.zoom;
  const scaled = naturalSize ? scaledSize(naturalSize, scale) : { width: 0, height: 0 };

  // Load the picked file. The object URL outlives this effect only until the
  // next pick or close, and is revoked either way.
  useEffect(() => {
    if (!file) {
      setSource(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let loadedUrl: string | null = null;
    setSource(null);
    setError(null);
    loadImageFile(file)
      .then((loaded) => {
        loadedUrl = loaded.url;
        if (cancelled) {
          URL.revokeObjectURL(loaded.url);
          return;
        }
        setSource(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "That image couldn't be read.");
      });
    return () => {
      cancelled = true;
      if (loadedUrl) URL.revokeObjectURL(loadedUrl);
    };
  }, [file]);

  // Start centred whenever the image or the viewport size changes.
  useEffect(() => {
    if (!naturalSize) return;
    const fitted = scaledSize(naturalSize, coverScale(naturalSize, viewport));
    setView({ zoom: MIN_ZOOM, offset: centeredOffset(fitted, viewport) });
  }, [naturalSize, viewport]);

  const zoomTo = useCallback(
    (nextZoom: number, focal: Point) => {
      if (!naturalSize) return;
      setView((current) => {
        const clamped = clampZoom(nextZoom);
        const prevScale = base * current.zoom;
        const nextScale = base * clamped;
        const nextScaled = scaledSize(naturalSize, nextScale);
        const moved = offsetAfterZoom(current.offset, prevScale, nextScale, focal);
        return { zoom: clamped, offset: clampOffset(moved, nextScaled, viewport) };
      });
    },
    [base, naturalSize, viewport]
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      if (!naturalSize) return;
      setView((current) => {
        const currentScaled = scaledSize(naturalSize, base * current.zoom);
        const moved = { x: current.offset.x + dx, y: current.offset.y + dy };
        return { ...current, offset: clampOffset(moved, currentScaled, viewport) };
      });
    },
    [base, naturalSize, viewport]
  );

  // Wheel zoom needs a non-passive listener to stop the dialog scrolling under
  // the gesture, which React's onWheel can't provide.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !naturalSize) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = frame.getBoundingClientRect();
      const focal = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setView((current) => {
        const clamped = clampZoom(current.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
        const nextScaled = scaledSize(naturalSize, base * clamped);
        const moved = offsetAfterZoom(current.offset, base * current.zoom, base * clamped, focal);
        return { zoom: clamped, offset: clampOffset(moved, nextScaled, viewport) };
      });
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [base, naturalSize, viewport]);

  const pinchDistance = (): number | null => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!source) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(e.pointerId);
    if (!previous || !source) return;
    const before = pinchDistance();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2) {
      const after = pinchDistance();
      if (before && after && before > 0) {
        const [a, b] = [...pointers.current.values()];
        const rect = frameRef.current?.getBoundingClientRect();
        const focal = rect
          ? { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }
          : { x: viewport / 2, y: viewport / 2 };
        zoomTo(view.zoom * (after / before), focal);
      }
      return;
    }

    panBy(e.clientX - previous.x, e.clientY - previous.y);
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };

  const handleConfirm = async () => {
    if (!source || !naturalSize || !file) return;
    setSaving(true);
    try {
      const rect = cropRect(naturalSize, viewport, scale, view.offset);
      const cropped = await cropToFile(source.image, rect);
      await onConfirm(cropped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't process that image.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={file !== null} onClose={saving ? undefined : onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>Position photo</DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box
          ref={frameRef}
          aria-label="Drag to reposition the photo"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          sx={{
            position: "relative",
            width: viewport,
            height: viewport,
            mx: "auto",
            borderRadius: "50%",
            overflow: "hidden",
            bgcolor: "action.hover",
            border: 2,
            borderColor: "divider",
            touchAction: "none",
            cursor: source ? "grab" : "default",
            "&:active": { cursor: source ? "grabbing" : "default" },
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {source ? (
            <Box
              component="img"
              src={source.url}
              alt=""
              draggable={false}
              style={{
                width: scaled.width,
                height: scaled.height,
                transform: `translate(${view.offset.x}px, ${view.offset.y}px)`,
              }}
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                maxWidth: "none",
                userSelect: "none",
                pointerEvents: "none",
                // A long press on a phone otherwise raises iOS's "Save Image"
                // sheet in the middle of framing the photo.
                WebkitTouchCallout: "none",
                WebkitUserSelect: "none",
              }}
            />
          ) : (
            !error && <CircularProgress size={28} />
          )}
        </Box>

        <Stack direction="row" spacing={1.5} sx={{ mt: 2, px: 1, alignItems: "center" }}>
          <ZoomOutIcon fontSize="small" color="action" />
          <Slider
            aria-label="Zoom"
            value={view.zoom}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            disabled={!source}
            onChange={(_, value) =>
              zoomTo(value as number, { x: viewport / 2, y: viewport / 2 })
            }
            sx={{
              // A default 20px thumb is a hard target with a thumb-tip; the
              // track height comes up with it so the control stays balanced.
              "& .MuiSlider-thumb": isMobile ? { width: 28, height: 28 } : {},
              "& .MuiSlider-rail, & .MuiSlider-track": isMobile ? { height: 6 } : {},
              py: isMobile ? 2 : 1,
            }}
          />
          <ZoomInIcon fontSize="small" color="action" />
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center" }}>
          Drag to reposition · pinch or use the slider to zoom
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleConfirm} disabled={!source || saving}>
          {saving ? "Saving…" : "Use photo"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
