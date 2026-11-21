import { projectId } from "@/domain/ids";
import type { I18nKey } from "@/domain/types";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TranslationPanelContent } from "./TranslationPanel";

// The test environment runs the editor in French (src/i18n).
const PERSONAL = projectId("p_personal");
const key = (i: number) => `lt_t_${String(i).padStart(3, "0")}` as I18nKey;

function addKeys(from: number, to: number) {
  useProjectsStore.setState((state) => {
    const projects = state.openProjects.projects.map((p) => {
      if (p.id !== PERSONAL) return p;
      const i18nKeys = { ...p.i18nKeys };
      for (let i = from; i < to; i++) i18nKeys[key(i)] = { en: `Quest number ${i}` };
      return { ...p, i18nKeys };
    });
    return { openProjects: { ...state.openProjects, projects } };
  });
}

const rowOf = (i: number) => screen.getAllByText(`Quest number ${i}`)[0]!.closest("li")!;

describe("TranslationPanelContent", () => {
  beforeEach(() => {
    const open = mockOpenProjects();
    for (const p of open.projects) if (p.id === PERSONAL) p.i18nKeys = {};
    useProjectsStore.setState({ openProjects: open });
    useUiStore.getState().setActiveLang("fr");
  });

  it("lists the keys that arrive after it opened, as its counter does", () => {
    render(<TranslationPanelContent projectId={PERSONAL} />);
    expect(screen.getByText(/Rien à traduire/)).toBeInTheDocument();
    act(() => addKeys(0, 5));
    expect(screen.queryByText(/Rien à traduire/)).toBeNull();
    expect(screen.getAllByText(/^Quest number \d$/)).toHaveLength(5);
  });

  it("opens one editor at a time and keeps a row being typed into listed", () => {
    addKeys(0, 50);
    render(<TranslationPanelContent projectId={PERSONAL} />);
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(0);

    const row = rowOf(0);
    fireEvent.click(within(row).getByRole("button", { name: "(traduction)" }));
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(1);

    // Filled in: no longer missing, still listed under "Manquantes" while the filter holds.
    fireEvent.click(within(row).getByTestId("copy-default-value"));
    const fr = useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!
      .i18nKeys[key(0)]?.fr;
    expect(fr).toBe("Quest number 0");
    expect(screen.getAllByText("Quest number 0").length).toBeGreaterThan(0);
    expect(screen.getByText(/49 manquantes/)).toBeInTheDocument();

    // Another row takes the one editor.
    fireEvent.click(within(rowOf(1)).getByRole("button", { name: "(traduction)" }));
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(1);
  });

  it("narrows the list to a search, every group open", () => {
    addKeys(0, 30);
    render(<TranslationPanelContent projectId={PERSONAL} />);
    fireEvent.change(screen.getByTestId("translations-search"), {
      target: { value: "number 2" },
    });
    // "Quest number 2", "Quest number 20" … "Quest number 29".
    expect(screen.getAllByText(/^Quest number 2\d?$/)).toHaveLength(11);
    expect(screen.queryByText("Quest number 1")).toBeNull();
    fireEvent.change(screen.getByTestId("translations-search"), { target: { value: "nothing" } });
    expect(screen.getByText(/Rien ne correspond à cette recherche/)).toBeInTheDocument();
  });
});
