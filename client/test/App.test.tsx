import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../src/theme/theme";
import App from "../src/App";

// Mock the API client
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

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading spinner while checking auth", () => {
    // Make the auth call hang
    mockApi.get.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("shows app content when user is authenticated", async () => {
    mockApi.get.mockImplementation((path: string) => {
      if (path === "/auth/me") {
        return Promise.resolve({ id: 1, email: "test@example.com", name: "Test User" });
      }
      if (path === "/children") {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Welcome to Baby Tracker")).toBeInTheDocument();
    });
  });
});
