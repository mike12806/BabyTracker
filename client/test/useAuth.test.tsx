import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../src/theme/theme";
import { AuthProvider, useAuth } from "../src/hooks/useAuth";

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
  const { user, loading } = useAuth();
  if (loading) return <div>Loading...</div>;
  if (!user) return <div>Not authenticated</div>;
  return (
    <div>
      <span data-testid="email">{user.email}</span>
      <span data-testid="name">{user.name}</span>
    </div>
  );
}

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("provides user data after successful auth", async () => {
    mockApi.get.mockResolvedValueOnce({
      id: 1,
      email: "test@example.com",
      name: "Test User",
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("email")).toHaveTextContent("test@example.com");
      expect(screen.getByTestId("name")).toHaveTextContent("Test User");
    });
  });

  it("shows not authenticated when API fails", async () => {
    mockApi.get.mockRejectedValueOnce(new Error("Unauthorized"));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Not authenticated")).toBeInTheDocument();
    });
  });
});
