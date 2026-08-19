/**
 * Geometry and encoding behind the child-photo cropper.
 *
 * Two problems share this one fix. A photo straight off a phone is 3–8 MB and
 * the upload endpoint caps at 2 MB, so every attempt to add a photo from a
 * phone came back "File too large" — the feature never worked with a real
 * photo. And the photo is only ever shown as a small round avatar, where an
 * uncropped landscape shot is mostly shoulders. Cropping and re-encoding in
 * the browser answers both: what leaves the device is a square JPEG of a few
 * dozen KB, comfortably under the cap and already framed the way it will be
 * seen.
 *
 * The maths lives here, apart from the dialog, so it can be tested without a
 * canvas — jsdom has no 2D context.
 */

/** Longest edge of the uploaded image. Avatars render at 120px at the largest, so 512 covers 2x displays with room to spare. */
export const OUTPUT_MAX_PX = 512;
export const OUTPUT_TYPE = "image/jpeg";
export const OUTPUT_QUALITY = 0.85;

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

/**
 * What the file picker offers.
 *
 * `image/*` rather than a list of web formats: everything is re-encoded to
 * JPEG here, so anything the browser can decode is fair game — including the
 * HEIC an iPhone hands over, which the old jpeg/png/webp/gif filter hid from
 * the picker entirely.
 */
export const PHOTO_INPUT_ACCEPT = "image/*";

/**
 * Sanity cap on the *picked* file, before it is decoded.
 *
 * Decoding is what makes a phone browser drop the tab, and this is far past
 * anything a camera produces — it exists to fail with a sentence instead of a
 * blank screen. It is unrelated to the upload cap: what uploads is the
 * re-encoded crop, a few dozen KB.
 */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

/** Mirrors `MAX_PHOTO_SIZE` in `server/src/routes/children.ts`. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Why a picked file can't be used, or `null` if it can.
 *
 * Checked before the cropper opens so the reason reaches the user as a
 * sentence, rather than as an empty dialog or a failed upload.
 */
export function describePickedFileProblem(file: File): string | null {
  if (file.size === 0) return "That file is empty. Try picking the photo again.";
  if (file.type && !file.type.startsWith("image/")) {
    return "That file isn't an image. Pick a photo instead.";
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return `That photo is ${formatBytes(file.size)} — too large to open. Maximum is ${formatBytes(MAX_SOURCE_BYTES)}.`;
  }
  return null;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface CropRect {
  x: number;
  y: number;
  size: number;
}

/**
 * Scale at which the image exactly covers the square viewport.
 *
 * This is zoom 1: the smallest framing with no empty corner, so there is no
 * way to produce an avatar with a bite taken out of it.
 */
export function coverScale(image: ImageSize, viewport: number): number {
  const shortEdge = Math.min(image.width, image.height);
  if (shortEdge <= 0) return 1;
  return viewport / shortEdge;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function scaledSize(image: ImageSize, scale: number): ImageSize {
  return { width: image.width * scale, height: image.height * scale };
}

export function centeredOffset(scaled: ImageSize, viewport: number): Point {
  return { x: (viewport - scaled.width) / 2, y: (viewport - scaled.height) / 2 };
}

/**
 * Keeps the image covering the viewport while it is dragged.
 *
 * Offsets are the image's top-left corner relative to the viewport's, so they
 * run from `viewport - scaled` (bottom/right edge flush) to 0 (top/left edge
 * flush). An axis smaller than the viewport can only be centred.
 */
export function clampOffset(offset: Point, scaled: ImageSize, viewport: number): Point {
  const axis = (value: number, extent: number): number => {
    const min = viewport - extent;
    if (min >= 0) return min / 2; // Smaller than the viewport: centre it.
    return Math.min(0, Math.max(min, value));
  };
  return { x: axis(offset.x, scaled.width), y: axis(offset.y, scaled.height) };
}

/**
 * Offset that holds `focal` (a point in viewport coordinates) over the same
 * pixel of the image as the scale changes — what makes pinch-zoom and wheel
 * zoom land where the user is looking instead of drifting to a corner.
 */
export function offsetAfterZoom(
  offset: Point,
  prevScale: number,
  nextScale: number,
  focal: Point
): Point {
  if (prevScale <= 0) return offset;
  const ratio = nextScale / prevScale;
  return {
    x: focal.x - (focal.x - offset.x) * ratio,
    y: focal.y - (focal.y - offset.y) * ratio,
  };
}

/**
 * The square of the source image currently framed by the viewport, in the
 * image's own pixels — the rectangle handed to `drawImage`.
 *
 * Clamped inside the image: sampling past the edge would draw transparent
 * pixels, which a JPEG renders as black.
 */
export function cropRect(image: ImageSize, viewport: number, scale: number, offset: Point): CropRect {
  const size = Math.min(viewport / scale, image.width, image.height);
  const x = Math.min(Math.max(-offset.x / scale, 0), Math.max(image.width - size, 0));
  const y = Math.min(Math.max(-offset.y / scale, 0), Math.max(image.height - size, 0));
  return { x, y, size };
}

/**
 * Never upscale: a tightly zoomed crop of a small image has fewer pixels than
 * the cap, and stretching them only makes a bigger, blurrier upload.
 */
export function outputSize(sourceSize: number): number {
  return Math.max(1, Math.min(OUTPUT_MAX_PX, Math.round(sourceSize)));
}

/** Loads a picked file into an `<img>`. Browsers apply EXIF orientation here, so canvas and preview agree. */
export function loadImageFile(file: File): Promise<{ image: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      // Overwhelmingly this is a HEIC/HEIF from an iPhone opened on a browser
      // that can't decode it — worth naming, because "try another photo" alone
      // reads as a bug in the app.
      reject(
        new Error(
          "This browser couldn't read that image. Some phone photos (HEIC) aren't supported — try saving it as a JPEG first."
        )
      );
    };
    image.src = url;
  });
}

/**
 * Renders the crop to a square JPEG.
 *
 * JPEG regardless of what came in: it is the one format every browser can
 * encode, and it is what keeps a phone photo under the size cap. The white
 * fill matters for PNGs with transparency, which would otherwise come out
 * black once the alpha channel is dropped.
 */
export async function cropToFile(
  image: CanvasImageSource,
  rect: CropRect,
  fileName = "photo.jpg"
): Promise<File> {
  const size = outputSize(rect.size);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image on this device.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, size, size);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, OUTPUT_TYPE, OUTPUT_QUALITY)
  );
  if (!blob) throw new Error("Couldn't process that image on this device.");

  // A 512px JPEG is tens of KB, so this can't realistically trip — but the
  // whole point of the cropper is that nothing oversized reaches the upload,
  // and a silent 400 from the server is exactly the failure being fixed.
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(`The cropped photo is ${formatBytes(blob.size)}, over the ${formatBytes(MAX_UPLOAD_BYTES)} limit.`);
  }

  return new File([blob], fileName, { type: OUTPUT_TYPE });
}
