import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectConflictBanner } from "./ProjectConflictBanner";
import { useProjectVersionStore } from "@/state/projectVersionStore";

describe("<ProjectConflictBanner>", () => {
  beforeEach(() => {
    useProjectVersionStore.setState({ versions: {}, conflicts: {} });
  });

  it("renders nothing when the project has no conflict", () => {
    const { container } = render(<ProjectConflictBanner projectId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an alert with a reload action when the project is conflicted", () => {
    useProjectVersionStore.getState().markConflict("p1");
    render(<ProjectConflictBanner projectId="p1" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Test setup runs with language "fr" (tests/setup.ts)
    expect(screen.getByRole("button", { name: /recharger/i })).toBeInTheDocument();
  });

  it("ignores conflicts on other projects", () => {
    useProjectVersionStore.getState().markConflict("other");
    const { container } = render(<ProjectConflictBanner projectId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
