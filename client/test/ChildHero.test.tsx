import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import ChildHero from "../src/components/ChildHero";
import { buildCategoryColors } from "../src/theme/categoryColors";
import type { Child } from "../src/types/models";

vi.mock("../src/api/client", () => ({ API_BASE: "/api" }));

const cat = buildCategoryColors(false);

const child: Child = {
  id: 4,
  first_name: "Otto",
  last_name: "Faherty",
  birth_date: "2026-04-07",
  picture_url: null,
  picture_content_type: "image/jpeg",
  created_at: "2026-04-07T00:00:00Z",
  updated_at: "2026-08-19T12:00:00Z",
};

function renderHero(props: Partial<React.ComponentProps<typeof ChildHero>> = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <ChildHero
        child={child}
        napping={false}
        cat={cat}
        isDark={false}
        now={new Date("2026-08-19T09:00:00")}
        {...props}
      />
    </ThemeProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ChildHero", () => {
  it("leads with the greeting, his name and his age today", () => {
    renderHero();
    expect(screen.getByText("Good morning")).toBeInTheDocument();
    expect(screen.getByText("Otto")).toBeInTheDocument();
    expect(screen.getByText("4 months, 12 days old")).toBeInTheDocument();
  });

  it("shows his photo, cache-busted on updated_at", () => {
    renderHero();
    const photo = screen.getByAltText("Otto") as HTMLImageElement;
    expect(photo.getAttribute("src")).toBe("/api/children/4/photo?v=2026-08-19T12%3A00%3A00Z");
  });

  it("falls back to the initial when there is no photo", () => {
    renderHero({ child: { ...child, picture_content_type: null } });
    expect(screen.queryByAltText("Otto")).not.toBeInTheDocument();
    expect(screen.getByText("O")).toBeInTheDocument();
  });

  it("falls back to the initial when the photo fails to load", () => {
    renderHero();
    const photo = screen.getByAltText("Otto");
    act(() => {
      photo.dispatchEvent(new Event("error"));
    });
    expect(screen.queryByAltText("Otto")).not.toBeInTheDocument();
    expect(screen.getByText("O")).toBeInTheDocument();
  });

  it("marks a monthly turn, and only on the day", () => {
    renderHero({ now: new Date("2026-08-07T09:00:00") });
    expect(screen.getByText("4 months old today")).toBeInTheDocument();
  });

  it("says nothing special on an ordinary day", () => {
    renderHero();
    expect(screen.queryByText(/old today/)).not.toBeInTheDocument();
  });

  it("shows the daily note when the server has written one", () => {
    renderHero({ dailyNote: "Mikey had 7 feeds and slept 13h. Steady week — you're doing this well." });
    expect(
      screen.getByText("Mikey had 7 feeds and slept 13h. Steady week — you're doing this well."),
    ).toBeInTheDocument();
  });

  it("is a complete card with no note yet", () => {
    renderHero({ dailyNote: null });
    expect(screen.getByText("Otto")).toBeInTheDocument();
    expect(screen.getByText("4 months, 12 days old")).toBeInTheDocument();
  });

  it("gets out of the way while a tap is being answered", () => {
    vi.useFakeTimers();
    renderHero({ dailyNote: "Mikey had 7 feeds yesterday." });
    fireEvent.click(screen.getByRole("button", { name: /tap for a little hello/i }));
    expect(screen.queryByText("Mikey had 7 feeds yesterday.")).not.toBeInTheDocument();
  });

  it("answers a tap, then goes back to the age line", async () => {
    vi.useFakeTimers();
    renderHero();

    fireEvent.click(screen.getByRole("button", { name: /tap for a little hello/i }));
    expect(screen.getByText("Boop.")).toBeInTheDocument();
    expect(screen.queryByText("4 months, 12 days old")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText("Boop.")).not.toBeInTheDocument();
    expect(screen.getByText("4 months, 12 days old")).toBeInTheDocument();
  });

  it("says something different on the second tap", async () => {
    vi.useFakeTimers();
    renderHero();
    const photo = screen.getByRole("button", { name: /tap for a little hello/i });

    fireEvent.click(photo);
    fireEvent.click(photo);
    expect(screen.getByText("Otto approves.")).toBeInTheDocument();
  });

  it("keeps its voice down at 3am", async () => {
    vi.useFakeTimers();
    renderHero({ now: new Date("2026-08-19T03:00:00") });
    expect(screen.getByText("Still up")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /tap for a little hello/i }));
    fireEvent.click(screen.getByRole("button", { name: /tap for a little hello/i }));
    expect(screen.getByText("Otto says go back to sleep.")).toBeInTheDocument();
  });

  it("does not leave a timer pointed at an unmounted card", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHero();
    fireEvent.click(screen.getByRole("button", { name: /tap for a little hello/i }));
    unmount();
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });
});
