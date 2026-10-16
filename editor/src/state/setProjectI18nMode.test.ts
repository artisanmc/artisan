import { projectId } from "@/domain/ids";
import { mockOpenProjects } from "@/mock/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectsStore } from "./projectsStore";

const PERSONAL = projectId("p_personal");

const project = () =>
  useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!;

describe("setProjectI18nMode", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectsStore.setState({ openProjects: mockOpenProjects() });
  });

  it("starts on extract — an untouched project keeps the {i18n:key} shape", () => {
    expect(project().i18nMode).toBeUndefined();
  });

  it("switches to inline and back, leaving no marker on the way back", () => {
    useProjectsStore.getState().setProjectI18nMode({ projectId: PERSONAL, mode: "inline" });
    expect(project().i18nMode).toBe("inline");

    useProjectsStore.getState().setProjectI18nMode({ projectId: PERSONAL, mode: "extract" });
    // Absent, not `"extract"`: the default has no marker on disk either.
    expect(project().i18nMode).toBeUndefined();
  });

  it("touches updatedAt so the change is saved", () => {
    const before = project().updatedAt;
    useProjectsStore.getState().setProjectI18nMode({ projectId: PERSONAL, mode: "inline" });
    expect(project().updatedAt).not.toBe(before);
  });

  it("never touches the translations themselves — only how they are written", () => {
    const before = JSON.stringify(project().i18nKeys);
    useProjectsStore.getState().setProjectI18nMode({ projectId: PERSONAL, mode: "inline" });
    expect(JSON.stringify(project().i18nKeys)).toBe(before);
  });
});
