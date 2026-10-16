import { projectId } from "@/domain/ids";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationPanelContent } from "./TranslationPanel";

const PERSONAL = projectId("p_personal");

const project = () =>
  useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;

/** The two segmented buttons that choose how texts are written on disk. */
const shapeButtons = () => ({
  plain: screen.getByRole("button", { name: /plain text|texte en clair/i }),
  keys: screen.getByRole("button", { name: /^keys$|^clés$/i }),
});

describe("Translations panel — file shape toggle", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectsStore.setState({ openProjects: mockOpenProjects() });
    vi.restoreAllMocks();
  });

  it("shows which shape the project is currently written in", () => {
    render(<TranslationPanelContent projectId={PERSONAL} />);
    expect(shapeButtons().keys).toHaveAttribute("aria-pressed", "true");
    expect(shapeButtons().plain).toHaveAttribute("aria-pressed", "false");
  });

  it("switches to plain text once confirmed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TranslationPanelContent projectId={PERSONAL} />);
    fireEvent.click(shapeButtons().plain);
    expect(project().i18nMode).toBe("inline");
    expect(shapeButtons().plain).toHaveAttribute("aria-pressed", "true");
  });

  it("leaves the project alone when the rewrite is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<TranslationPanelContent projectId={PERSONAL} />);
    fireEvent.click(shapeButtons().plain);
    expect(project().i18nMode).toBeUndefined();
  });

  it("asks nothing when clicking the shape already in use", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TranslationPanelContent projectId={PERSONAL} />);
    fireEvent.click(shapeButtons().keys);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(project().i18nMode).toBeUndefined();
  });
});
