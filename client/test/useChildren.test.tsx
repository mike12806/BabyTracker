import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChildProvider, useChildren } from "../src/hooks/useChildren";

vi.mock("../src/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from "../src/api/client";
const mockApi = vi.mocked(api);

function TestConsumer() {
  const { children, selectedChild, loading } = useChildren();
  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <span data-testid="count">{children.length}</span>
      <span data-testid="selected">{selectedChild?.first_name || "none"}</span>
    </div>
  );
}

describe("useChildren", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));

    render(
      <ChildProvider>
        <TestConsumer />
      </ChildProvider>
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("provides children list and auto-selects first child", async () => {
    mockApi.get.mockImplementation((path: string) => {
      if (path === "/children") {
        return Promise.resolve([
          { id: 1, first_name: "Emma", last_name: "Smith", birth_date: "2024-06-15" },
          { id: 2, first_name: "Liam", last_name: "Smith", birth_date: "2025-01-10" },
        ]);
      }
      if (path === "/settings") {
        return Promise.resolve({ default_child_id: null, theme_mode: "system" });
      }
      return Promise.resolve([]);
    });

    render(
      <ChildProvider>
        <TestConsumer />
      </ChildProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("2");
      expect(screen.getByTestId("selected")).toHaveTextContent("Emma");
    });
  });

  it("handles empty children list", async () => {
    mockApi.get.mockImplementation((path: string) => {
      if (path === "/children") return Promise.resolve([]);
      if (path === "/settings") return Promise.resolve({ default_child_id: null, theme_mode: "system" });
      return Promise.resolve([]);
    });

    render(
      <ChildProvider>
        <TestConsumer />
      </ChildProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("0");
      expect(screen.getByTestId("selected")).toHaveTextContent("none");
    });
  });
});
