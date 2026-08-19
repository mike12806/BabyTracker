import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Child } from "../src/types/models";

vi.mock("../src/api/client", () => ({
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

import TemperaturePage from "../src/pages/TemperaturePage";
import { DataRefreshProvider } from "../src/hooks/useDataRefresh";
import { NotificationProvider } from "../src/hooks/useNotification";
import { useChildren } from "../src/hooks/useChildren";
import { api } from "../src/api/client";

const mockApi = vi.mocked(api);
const theme = createTheme();

const child: Child = {
  id: 1,
  first_name: "Nolan",
  last_name: "Faherty",
  birth_date: "2026-01-04",
  picture_url: null,
  picture_content_type: null,
  created_at: "2026-01-04T12:00:00Z",
  updated_at: "2026-01-04T12:00:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <NotificationProvider>
          <DataRefreshProvider>
            <TemperaturePage />
          </DataRefreshProvider>
        </NotificationProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

/** Fill in the one required field the dialog needs before it will save. */
async function openAndFillDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Add Reading" }));
  const time = await screen.findByLabelText(/^time/i);
  await user.clear(time);
  await user.type(time, "2026-08-18T09:00");
  const reading = screen.getByLabelText(/^temperature/i);
  await user.clear(reading);
  await user.type(reading, "98.6");
}

describe("saving an entry twice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useChildren).mockReturnValue({
      selectedChild: child,
      children: [child],
      // The rest of the context is unused by this page.
    } as unknown as ReturnType<typeof useChildren>);
    mockApi.get.mockResolvedValue([]);
  });

  it("takes the Save button away while the first request is in flight", async () => {
    const user = userEvent.setup();
    // The first request has not come back yet — the moment when tapping again
    // used to add a second identical reading to the log.
    let release!: () => void;
    mockApi.post.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({}); })
    );

    renderPage();
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    await openAndFillDialog(user);

    await user.click(screen.getByRole("button", { name: /save/i }));

    const save = await screen.findByRole("button", { name: /saving/i });
    expect(save).toBeDisabled();
    expect(mockApi.post).toHaveBeenCalledTimes(1);

    // A second tap has nothing to hit. (`useSaveGuard` also holds a lock for
    // the two-taps-in-one-frame case, which its own tests cover — a disabled
    // attribute alone cannot, since neither tap has re-rendered by then.)
    await user.click(save).catch(() => {});
    expect(mockApi.post).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
    });
  });

  it("sends a key the server can deduplicate on", async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({});

    renderPage();
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    await openAndFillDialog(user);
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());
    const [path, body] = mockApi.post.mock.calls[0];
    expect(path).toBe("/temperature");
    expect((body as { client_request_id?: string }).client_request_id).toEqual(expect.any(String));
  });
});
