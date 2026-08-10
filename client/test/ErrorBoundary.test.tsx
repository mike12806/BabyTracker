import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import ErrorBoundary from "../src/components/ErrorBoundary";

const theme = createTheme();

function Boom(): never {
  throw new Error("grouped is not a function");
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs the caught error itself; silence it so a passing run is quiet.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

function renderBoundary(children: React.ReactNode, scope?: string) {
  return render(
    <ThemeProvider theme={theme}>
      <ErrorBoundary scope={scope}>{children}</ErrorBoundary>
    </ThemeProvider>,
  );
}

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    renderBoundary(<p>All fine</p>);

    expect(screen.getByText("All fine")).toBeInTheDocument();
  });

  it("shows the error instead of blanking the screen", () => {
    renderBoundary(<Boom />);

    // The message is the whole point: a white screen reports nothing, on the
    // device or anywhere else.
    expect(screen.getByText("grouped is not a function")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("shows the build id, so a crash report says which build crashed", () => {
    renderBoundary(<Boom />);

    // An installed PWA can sit builds behind, so "is this bug still shipping?"
    // is unanswerable without it.
    expect(screen.getByText(/Build test/)).toBeInTheDocument();
  });

  it("uses the caller's scope wording", () => {
    renderBoundary(<Boom />, "This page failed to load");

    expect(screen.getByText("This page failed to load")).toBeInTheDocument();
  });

  it("logs the error and component stack for the console record", () => {
    renderBoundary(<Boom />);

    expect(consoleError).toHaveBeenCalledWith(
      "Unhandled render error",
      expect.objectContaining({ message: "grouped is not a function" }),
      expect.any(String),
    );
  });
});
