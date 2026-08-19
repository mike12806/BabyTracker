import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import ChildrenPage from "../src/pages/ChildrenPage";
import type { Child } from "../src/types/models";

vi.mock("../src/api/client", () => ({
  // Reachability ping used by the stale-retry loop — reachable by default.
  pingServer: vi.fn(async () => true),
  api: {
    get: vi.fn(),
    getOptional: vi.fn(async () => ({ note: null })),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  API_BASE: "/api",
}));

vi.mock("../src/hooks/useChildren", () => ({
  useChildren: vi.fn(),
}));

const notify = vi.fn();
vi.mock("../src/hooks/useNotification", () => ({
  useNotification: () => ({ notify }),
}));

// jsdom decodes nothing and has no 2D context, so the two functions that touch
// a real image are stubbed; the geometry they wrap is covered in
// imageCrop.test.ts.
vi.mock("../src/utils/imageCrop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/imageCrop")>();
  return {
    ...actual,
    loadImageFile: vi.fn(async () => ({
      image: { naturalWidth: 1200, naturalHeight: 900 } as HTMLImageElement,
      url: "blob:source",
    })),
    cropToFile: vi.fn(async () => croppedFile()),
  };
});

/** What the cropper hands back: a square JPEG of a few dozen KB. */
function croppedFile(): File {
  return new File([new Uint8Array(40 * 1024)], "photo.jpg", { type: "image/jpeg" });
}

/** A photo the size a phone actually produces — the case that used to 400. */
function phonePhoto(): File {
  const file = new File([new Uint8Array(1024)], "IMG_1234.jpg", { type: "image/jpeg" });
  Object.defineProperty(file, "size", { value: 4 * 1024 * 1024 });
  return file;
}

import { api } from "../src/api/client";
import { useChildren } from "../src/hooks/useChildren";
const mockUseChildren = vi.mocked(useChildren);

const theme = createTheme();
function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

const baseChild: Child = {
  id: 1,
  first_name: "Mikey",
  last_name: "Faherty",
  birth_date: "2023-08-01",
  picture_url: null,
  picture_content_type: null,
  created_at: "2023-08-01T12:00:00Z",
  updated_at: "2023-08-01T12:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  mockUseChildren.mockReturnValue({
    children: [baseChild],
    selectedChild: baseChild,
    selectChild: vi.fn(),
    refreshChildren: vi.fn().mockResolvedValue(undefined),
    loading: false,
    defaultChildId: null,
    setDefaultChild: vi.fn().mockResolvedValue(undefined),
  });
});

describe("ChildrenPage – birth date display", () => {
  it("displays birth_date of 2023-08-01 as August 1 without UTC offset shift", () => {
    render(
      <Wrapper>
        <ChildrenPage />
      </Wrapper>
    );

    // The displayed date should include "8/1" or "Aug" (locale-dependent) but
    // must NOT slip back to July 31 due to UTC-to-local conversion.
    const bornText = screen.getByText(/born/i);
    expect(bornText.textContent).not.toMatch(/7\/31/);
    // Date should contain August (or "8") — locale format may vary, but month must be August
    expect(bornText.textContent).toMatch(/august|aug|\b8[\/-]/i);
  });
});

describe("ChildrenPage – photo URL cache-busting", () => {
  it("uses updated_at as the photo version parameter, not a local counter", () => {
    const childWithPhoto: Child = {
      ...baseChild,
      picture_content_type: "image/jpeg",
      updated_at: "2024-03-01T10:00:00Z",
    };
    mockUseChildren.mockReturnValue({
      children: [childWithPhoto],
      selectedChild: childWithPhoto,
      selectChild: vi.fn(),
      refreshChildren: vi.fn().mockResolvedValue(undefined),
      loading: false,
      defaultChildId: null,
      setDefaultChild: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <Wrapper>
        <ChildrenPage />
      </Wrapper>
    );

    const avatar = document.querySelector(`img[src*="/api/children/1/photo"]`) as HTMLImageElement | null;
    expect(avatar).not.toBeNull();
    expect(avatar!.src).toContain("v=");
    // Should contain the encoded updated_at timestamp, NOT a plain integer like ?v=0
    expect(avatar!.src).toContain(encodeURIComponent("2024-03-01T10:00:00Z"));
  });
});


describe("ChildrenPage – adding a photo", () => {
  // The dialog renders through a portal, so its input is on document.body
  // rather than in the render container.
  const fileInputs = () =>
    Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  const dialogFileInput = () =>
    document.querySelector<HTMLInputElement>('.MuiDialog-root input[type="file"]')!;

  it("crops a phone-sized photo down before uploading it", async () => {
    const { container } = render(
      <Wrapper>
        <ChildrenPage />
      </Wrapper>
    );

    fireEvent.click(container.querySelector(".MuiCard-root .MuiAvatar-root")!);
    fireEvent.change(fileInputs()[0], { target: { files: [phonePhoto()] } });

    // The picked photo goes to the cropper, not straight to the server.
    expect(await screen.findByText("Position photo")).toBeInTheDocument();
    expect(vi.mocked(api.upload)).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: /use photo/i }));

    await waitFor(() => expect(vi.mocked(api.upload)).toHaveBeenCalledTimes(1));
    const [path, formData] = vi.mocked(api.upload).mock.calls[0];
    expect(path).toBe("/children/1/photo");

    const uploaded = (formData as FormData).get("photo") as File;
    expect(uploaded.type).toBe("image/jpeg");
    // Comfortably inside the server's cap — the 4 MB original was not.
    expect(uploaded.size).toBeLessThan(2 * 1024 * 1024);
  });

  it("keeps the photo until the new child exists, then uploads it against that id", async () => {
    vi.mocked(api.post).mockResolvedValue({ ...baseChild, id: 42 });

    render(
      <Wrapper>
        <ChildrenPage />
      </Wrapper>
    );

    fireEvent.click(screen.getAllByRole("button", { name: /add child/i })[0]);
    fireEvent.change(await screen.findByLabelText(/first name/i), { target: { value: "Rae" } });
    fireEvent.change(screen.getByLabelText(/birth date/i), { target: { value: "2026-02-01" } });

    // Picked through the dialog's own input, which is what the dialog's avatar
    // opens — the page-level one belongs to the card avatars.
    expect(dialogFileInput()).toBeInTheDocument();
    fireEvent.change(dialogFileInput(), { target: { files: [phonePhoto()] } });

    fireEvent.click(await screen.findByRole("button", { name: /use photo/i }));

    // Nothing is uploaded yet — there is no child id to upload against.
    await waitFor(() => expect(screen.queryByText("Position photo")).not.toBeInTheDocument());
    expect(vi.mocked(api.upload)).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => expect(vi.mocked(api.upload)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.upload).mock.calls[0][0]).toBe("/children/42/photo");
  });

  it("says why a file it can't use was rejected, instead of failing at the server", async () => {
    const { container } = render(
      <Wrapper>
        <ChildrenPage />
      </Wrapper>
    );

    const notAPhoto = new File([new Uint8Array(16)], "notes.pdf", { type: "application/pdf" });
    fireEvent.click(container.querySelector(".MuiCard-root .MuiAvatar-root")!);
    fireEvent.change(fileInputs()[0], { target: { files: [notAPhoto] } });

    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify.mock.calls[0][0]).toMatch(/isn't an image/i);
    expect(notify.mock.calls[0][1]).toBe("error");
    expect(screen.queryByText("Position photo")).not.toBeInTheDocument();
    expect(vi.mocked(api.upload)).not.toHaveBeenCalled();
  });

  it("reports an upload that fails rather than leaving the avatar unchanged in silence", async () => {
    vi.mocked(api.upload).mockRejectedValue(new Error("That file is too large to upload."));

    const { container } = render(
      <Wrapper>
        <ChildrenPage />
      </Wrapper>
    );

    fireEvent.click(container.querySelector(".MuiCard-root .MuiAvatar-root")!);
    fireEvent.change(fileInputs()[0], { target: { files: [phonePhoto()] } });
    fireEvent.click(await screen.findByRole("button", { name: /use photo/i }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("That file is too large to upload.", "error"));
  });
});
