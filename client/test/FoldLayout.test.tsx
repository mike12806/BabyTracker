import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import type { Child } from "../src/types/models";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../src/api/client")>("../src/api/client");
  return { ...actual, API_BASE: "/api", pingServer: vi.fn(async () => false) };
});

vi.mock("../src/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../src/hooks/useChildren", () => ({ useChildren: vi.fn() }));
vi.mock("../src/hooks/useTheme", () => ({ useThemeMode: vi.fn() }));
vi.mock("../src/hooks/useVolumeUnit", () => ({ useVolumeUnit: vi.fn() }));

import Layout from "../src/components/Layout";
import FoldPanes from "../src/components/FoldPanes";
import { DataRefreshProvider } from "../src/hooks/useDataRefresh";
import { FoldProvider, useFold } from "../src/hooks/useFold";
import { buildTheme } from "../src/theme/theme";
import { useAuth } from "../src/hooks/useAuth";
import { useChildren } from "../src/hooks/useChildren";
import { useThemeMode } from "../src/hooks/useTheme";
import { useVolumeUnit } from "../src/hooks/useVolumeUnit";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 27_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.1 Mobile/15E148 Safari/604.1";

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

function define(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
}

/** Put the window in the shape of one of the iPhone Duo's displays. */
function showDisplay(display: "outer" | "inner") {
  const [w, h] = display === "inner" ? [890, 626] : [466, 678];
  define(window, "innerWidth", w);
  define(window, "innerHeight", h);
  define(window.screen, "width", Math.min(w, h));
  define(window.screen, "height", Math.max(w, h));
  define(window.navigator, "userAgent", IPHONE_UA);
  define(window.navigator, "maxTouchPoints", 5);
}

/** The theme follows the fold, as AppThemeProvider's does. */
function Themed({ children }: { children: ReactNode }) {
  const fold = useFold();
  return <ThemeProvider theme={buildTheme("light", fold)}>{children}</ThemeProvider>;
}

let mounts = 0;
function PlainPage() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <div>Activity page</div>;
}

function renderAt(path: string) {
  return render(
    <FoldProvider>
      <Themed>
        <MemoryRouter initialEntries={[path]}>
          <DataRefreshProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/activity" element={<PlainPage />} />
                <Route path="/" element={<FoldPanes start={<div>Now</div>} end={<div>Earlier</div>} />} />
              </Route>
            </Routes>
          </DataRefreshProvider>
        </MemoryRouter>
      </Themed>
    </FoldProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mounts = 0;
  vi.mocked(useAuth).mockReturnValue({ user: { id: 1, email: "a@b.c", name: "A" }, loading: false });
  vi.mocked(useChildren).mockReturnValue({
    children: [child],
    selectedChild: child,
    selectChild: vi.fn(),
    refreshChildren: vi.fn().mockResolvedValue(undefined),
    loading: false,
    defaultChildId: null,
    setDefaultChild: vi.fn().mockResolvedValue(undefined),
  });
  vi.mocked(useThemeMode).mockReturnValue({ preference: "system", setPreference: vi.fn(), mode: "light" });
  vi.mocked(useVolumeUnit).mockReturnValue({ unit: "ml", setUnit: vi.fn() });
});

describe("Layout on the iPhone Duo", () => {
  it("is one column on the outer display", () => {
    showDisplay("outer");
    renderAt("/activity");
    expect(screen.getByText("Activity page")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Log" })).toBeNull();
  });

  it("puts the log panel beside a page opened on the inner display", () => {
    showDisplay("inner");
    renderAt("/activity");
    expect(screen.getByText("Activity page")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Log" })).toBeInTheDocument();
    expect(screen.getByText("Feeding")).toBeInTheDocument();
  });

  it("gives a page that fills both panes the whole width", () => {
    showDisplay("inner");
    renderAt("/");
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("Earlier")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Log" })).toBeNull();
  });

  it("rearranges itself when the phone is opened, without remounting the page", async () => {
    showDisplay("outer");
    renderAt("/activity");
    expect(mounts).toBe(1);

    showDisplay("inner");
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => expect(screen.getByRole("complementary", { name: "Log" })).toBeInTheDocument());
    expect(screen.getByText("Activity page")).toBeInTheDocument();
    expect(mounts).toBe(1);
  });

  it("goes back to one column when the phone is closed", async () => {
    showDisplay("inner");
    renderAt("/activity");
    expect(screen.getByRole("complementary", { name: "Log" })).toBeInTheDocument();

    showDisplay("outer");
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Log" })).toBeNull());
    expect(mounts).toBe(1);
  });
});
