import { describe, it, expect } from "vitest";
import {
  MAX_SOURCE_BYTES,
  MAX_ZOOM,
  OUTPUT_MAX_PX,
  centeredOffset,
  clampOffset,
  clampZoom,
  coverScale,
  cropRect,
  describePickedFileProblem,
  formatBytes,
  offsetAfterZoom,
  outputSize,
  scaledSize,
} from "../src/utils/imageCrop";

const VIEWPORT = 300;
const LANDSCAPE = { width: 1200, height: 900 };
const PORTRAIT = { width: 900, height: 1600 };

describe("coverScale", () => {
  it("scales the short edge to the viewport so the crop is never empty at the corners", () => {
    expect(coverScale(LANDSCAPE, VIEWPORT)).toBeCloseTo(VIEWPORT / 900);
    expect(coverScale(PORTRAIT, VIEWPORT)).toBeCloseTo(VIEWPORT / 900);
  });

  it("survives a zero-sized image rather than returning Infinity", () => {
    expect(coverScale({ width: 0, height: 0 }, VIEWPORT)).toBe(1);
  });
});

describe("clampZoom", () => {
  it("holds zoom between fully-covering and the maximum", () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe("clampOffset", () => {
  const scaled = scaledSize(LANDSCAPE, coverScale(LANDSCAPE, VIEWPORT)); // 400 x 300

  it("never lets an edge pull inside the viewport", () => {
    // Dragged far right: the left edge can only reach 0.
    expect(clampOffset({ x: 500, y: 0 }, scaled, VIEWPORT).x).toBe(0);
    // Dragged far left: the right edge can only reach the viewport's.
    expect(clampOffset({ x: -500, y: 0 }, scaled, VIEWPORT).x).toBe(VIEWPORT - scaled.width);
  });

  it("leaves an in-range offset alone", () => {
    expect(clampOffset({ x: -40, y: 0 }, scaled, VIEWPORT)).toEqual({ x: -40, y: 0 });
  });

  it("centres an axis shorter than the viewport instead of pinning it to an edge", () => {
    const small = { width: 200, height: 300 };
    expect(clampOffset({ x: -80, y: 0 }, small, VIEWPORT).x).toBe(50);
  });
});

describe("centeredOffset", () => {
  it("puts the middle of the image in the middle of the viewport", () => {
    const scaled = scaledSize(LANDSCAPE, coverScale(LANDSCAPE, VIEWPORT)); // 400 x 300
    expect(centeredOffset(scaled, VIEWPORT)).toEqual({ x: -50, y: 0 });
  });
});

describe("offsetAfterZoom", () => {
  it("holds the pixel under the focal point still", () => {
    const offset = { x: -50, y: 0 };
    const focal = { x: 120, y: 200 };
    const prev = 0.3333;
    const next = 0.6666;

    const moved = offsetAfterZoom(offset, prev, next, focal);

    // The image coordinate under the focal point is unchanged by the zoom.
    const before = { x: (focal.x - offset.x) / prev, y: (focal.y - offset.y) / prev };
    const after = { x: (focal.x - moved.x) / next, y: (focal.y - moved.y) / next };
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });
});

describe("cropRect", () => {
  it("takes the centred square of the short edge at zoom 1", () => {
    const scale = coverScale(LANDSCAPE, VIEWPORT);
    const scaled = scaledSize(LANDSCAPE, scale);
    const rect = cropRect(LANDSCAPE, VIEWPORT, scale, centeredOffset(scaled, VIEWPORT));

    expect(rect.size).toBeCloseTo(900);
    expect(rect.x).toBeCloseTo(150); // (1200 - 900) / 2
    expect(rect.y).toBeCloseTo(0);
  });

  it("takes a smaller square as zoom increases", () => {
    const scale = coverScale(LANDSCAPE, VIEWPORT) * 3;
    const rect = cropRect(LANDSCAPE, VIEWPORT, scale, { x: 0, y: 0 });
    expect(rect.size).toBeCloseTo(300);
  });

  it("stays inside the image, so no crop samples past the edge", () => {
    const scale = coverScale(LANDSCAPE, VIEWPORT);
    const rect = cropRect(LANDSCAPE, VIEWPORT, scale, { x: 1000, y: 1000 });
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.size).toBeLessThanOrEqual(LANDSCAPE.width);
    expect(rect.y + rect.size).toBeLessThanOrEqual(LANDSCAPE.height);
  });
});

describe("outputSize", () => {
  it("caps at the avatar-sized maximum", () => {
    expect(outputSize(4000)).toBe(OUTPUT_MAX_PX);
  });

  it("never upscales a small crop into a bigger, blurrier upload", () => {
    expect(outputSize(180)).toBe(180);
  });
});

describe("describePickedFileProblem", () => {
  const file = (bytes: number, type: string) =>
    new File([new Uint8Array(Math.min(bytes, 1024))], "photo.jpg", { type });

  it("accepts an ordinary photo", () => {
    expect(describePickedFileProblem(file(500, "image/jpeg"))).toBeNull();
  });

  it("explains an empty pick", () => {
    expect(describePickedFileProblem(file(0, "image/jpeg"))).toMatch(/empty/i);
  });

  it("explains a non-image pick", () => {
    expect(describePickedFileProblem(file(500, "application/pdf"))).toMatch(/isn't an image/i);
  });

  it("explains a file too large to decode, naming both sizes", () => {
    const huge = new File([new Uint8Array(8)], "huge.jpg", { type: "image/jpeg" });
    Object.defineProperty(huge, "size", { value: MAX_SOURCE_BYTES + 1 });
    const problem = describePickedFileProblem(huge);
    expect(problem).toContain("40.0 MB");
    expect(problem).toMatch(/too large/i);
  });
});

describe("formatBytes", () => {
  it("reads as a size a person would recognise", () => {
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(formatBytes(64 * 1024)).toBe("64 KB");
  });
});
