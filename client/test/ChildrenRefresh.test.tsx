import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChildProvider, useChildren } from "../src/hooks/useChildren";
import { DataRefreshProvider } from "../src/hooks/useDataRefresh";
import type { Child } from "../src/types/models";

vi.mock("../src/api/client", () => ({
  // Reachability ping used by the stale-retry loop — reachable by default.
  pingServer: vi.fn(async () => true),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from "../src/api/client";
const mockApi = vi.mocked(api);

function child(id: number, firstName: string, updatedAt = "2026-01-01T00:00:00Z"): Child {
  return {
    id,
    first_name: firstName,
    last_name: "Faherty",
    birth_date: "2026-01-04",
    picture_url: null,
    picture_content_type: null,
    created_at: "2026-01-04T00:00:00Z",
    updated_at: updatedAt,
  };
}

/** Serve a given roster from `/children`, with no default child set. */
function serve(children: Child[]): void {
  mockApi.get.mockImplementation((path: string) => {
    if (path === "/children") return Promise.resolve(children);
    if (path === "/settings") return Promise.resolve({ default_child_id: null });
    return Promise.resolve([]);
  });
}

function TestConsumer() {
  const { children, selectedChild, selectChild, loading } = useChildren();
  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <span data-testid="count">{children.length}</span>
      <span data-testid="selected">{selectedChild?.first_name || "none"}</span>
      <span data-testid="selected-updated">{selectedChild?.updated_at || "none"}</span>
      {children.map((c) => (
        <button key={c.id} onClick={() => selectChild(c)}>
          pick {c.first_name}
        </button>
      ))}
    </div>
  );
}

function renderProvider() {
  return render(
    <DataRefreshProvider>
      <ChildProvider>
        <TestConsumer />
      </ChildProvider>
    </DataRefreshProvider>
  );
}

/** Returning to the app is what bumps `refreshKey`. */
async function returnToApp() {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("child list freshness", () => {
  it("picks up a child added on another device when the app is reopened", async () => {
    serve([child(1, "Nolan")]);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));

    serve([child(1, "Nolan"), child(2, "Mikey")]);
    await returnToApp();

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
  });

  it("keeps the child the user picked instead of snapping back to the default", async () => {
    serve([child(1, "Nolan"), child(2, "Mikey")]);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("Nolan"));

    await act(async () => {
      screen.getByRole("button", { name: "pick Mikey" }).click();
    });
    expect(screen.getByTestId("selected")).toHaveTextContent("Mikey");

    await returnToApp();

    // Auto-select only applies when nobody is selected. Re-running it on every
    // refresh would drag the user back to the first child mid-feed.
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(4));
    expect(screen.getByTestId("selected")).toHaveTextContent("Mikey");
  });

  it("picks up an edit made to the selected child elsewhere", async () => {
    serve([child(1, "Nolan", "2026-01-01T00:00:00Z")]);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("Nolan"));

    // Renamed and re-photographed on another device. `updated_at` is what
    // cache-busts the avatar URL, so it has to move too.
    serve([child(1, "Nolan James", "2026-02-02T00:00:00Z")]);
    await returnToApp();

    await waitFor(() => {
      expect(screen.getByTestId("selected")).toHaveTextContent("Nolan James");
      expect(screen.getByTestId("selected-updated")).toHaveTextContent("2026-02-02T00:00:00Z");
    });
  });

  it("hands back the same child object when nothing about them changed", async () => {
    // Pages key their fetch effect on `selectedChild`. An equal-but-new object
    // on every refresh would fire all of them a second time, doubling the
    // request volume of a poll that found nothing new.
    const seen: Array<Child | null> = [];
    function IdentityProbe() {
      const { selectedChild } = useChildren();
      seen.push(selectedChild);
      return null;
    }

    serve([child(1, "Nolan")]);
    render(
      <DataRefreshProvider>
        <ChildProvider>
          <IdentityProbe />
        </ChildProvider>
      </DataRefreshProvider>
    );
    await waitFor(() => expect(seen.at(-1)).not.toBeNull());
    const first = seen.at(-1);

    await returnToApp();
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(4));

    expect(seen.at(-1)).toBe(first);
  });

  it("falls back to a remaining child when the selected one is deleted elsewhere", async () => {
    serve([child(1, "Nolan"), child(2, "Mikey")]);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("Nolan"));

    serve([child(2, "Mikey")]);
    await returnToApp();

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("Mikey"));
  });
});
