import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import MilestonesCard from "../src/components/MilestonesCard";
import { buildCategoryColors } from "../src/theme/categoryColors";
import { MILESTONE_SOURCE } from "../src/utils/milestones";
import type { Child } from "../src/types/models";

const cat = buildCategoryColors(false);

const child: Child = {
  id: 4,
  first_name: "Otto",
  last_name: "Faherty",
  birth_date: "2026-04-07",
  picture_url: null,
  picture_content_type: null,
  created_at: "2026-04-07T00:00:00Z",
  updated_at: "2026-08-19T12:00:00Z",
};

function renderCard(props: Partial<React.ComponentProps<typeof MilestonesCard>> = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <MilestonesCard child={child} cat={cat} isDark={false} now={new Date("2026-07-01T09:00:00")} {...props} />
    </ThemeProvider>,
  );
}

describe("MilestonesCard", () => {
  it("shows the checkpoint coming up, how far off it is, and where it's from", () => {
    renderCard();
    expect(screen.getByText("Milestones by 4 months · CDC")).toBeInTheDocument();
    expect(screen.getByText("in 5 wks")).toBeInTheDocument();
  });

  it("keeps a just-reached checkpoint in view for the well-child visit", () => {
    renderCard({ now: new Date("2026-08-19T09:00:00") });
    expect(screen.getByText("Milestones by 4 months · CDC")).toBeInTheDocument();
    expect(screen.getByText("now")).toBeInTheDocument();
  });

  it("opens the full checklist with its sources", () => {
    renderCard({ now: new Date("2026-08-19T09:00:00") });
    fireEvent.click(screen.getByRole("button", { name: /milestones by 4 months/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Milestones by 4 months")).toBeInTheDocument();
    expect(within(dialog).getByText("Otto is 4 months, 12 days old · 4 months was 12 days ago")).toBeInTheDocument();
    expect(within(dialog).getByText("Pushes up onto elbows/forearms when on tummy")).toBeInTheDocument();

    expect(within(dialog).getByRole("link", { name: /CDC, “Milestones by 4 months”/ })).toHaveAttribute(
      "href",
      "https://www.cdc.gov/act-early/milestones/4-months.html",
    );
    expect(within(dialog).getByRole("link", { name: /Evidence-Informed Milestones/ })).toHaveAttribute(
      "href",
      MILESTONE_SOURCE.paperUrl,
    );
  });

  it("steps to other checkpoints, with the citation following along", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /milestones by 4 months/i }));
    const dialog = screen.getByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Show milestones by 6 months" }));
    expect(within(dialog).getByText("Milestones by 6 months")).toBeInTheDocument();
    expect(within(dialog).getByText("Rolls from tummy to back")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /CDC, “Milestones by 6 months”/ })).toHaveAttribute(
      "href",
      "https://www.cdc.gov/act-early/milestones/6-months.html",
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Show milestones by 4 months" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Show milestones by 2 months" }));
    expect(within(dialog).getByText("Otto is 12 weeks, 1 day old · 2 months was 3 weeks ago")).toBeInTheDocument();
  });

  it("reopens on today's checkpoint after browsing", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /milestones by 4 months/i }));
    fireEvent.click(screen.getByRole("button", { name: "Show milestones by 6 months" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: /milestones by 4 months/i }));
    expect(within(screen.getByRole("dialog")).getByText("Milestones by 4 months")).toBeInTheDocument();
  });

  it("stays out of the way when there is nothing to show", () => {
    const { container } = renderCard({ child: { ...child, birth_date: "2019-01-01" } });
    expect(container).toBeEmptyDOMElement();
  });
});
