import { projectId } from "@/domain/ids";
import { mockAccount } from "@/mock/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { useAccountStore } from "./accountStore";

const PERSONAL = projectId("p_personal");

const project = () => useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;

describe("setProjectI18nMode", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() });
  });

  it("starts on extract — an untouched project keeps the {i18n:key} shape", () => {
    expect(project().i18nMode).toBeUndefined();
  });

  it("switches to inline and back, leaving no marker on the way back", () => {
    useAccountStore.getState().setProjectI18nMode({ projectId: PERSONAL, mode: "inline" });
    expect(project().i18nMode).toBe("inline");

    useAccountStore.getState().setProjectI18nMode({ projectId: PERSONAL, mode: "extract" });
    // Absent, not `"extract"`: the default has no marker on disk either.
    expect(project().i18nMode).toBeUndefined();
  });

  it("touches updatedAt so the change is saved", () => {
    const before = project().updatedAt;
    useAccountStore.getState().setProjectI18nMode({ projectId: PERSONAL, mode: "inline" });
    expect(project().updatedAt).not.toBe(before);
  });

  it("never touches the translations themselves — only how they are written", () => {
    const before = JSON.stringify(project().i18nKeys);
    useAccountStore.getState().setProjectI18nMode({ projectId: PERSONAL, mode: "inline" });
    expect(JSON.stringify(project().i18nKeys)).toBe(before);
  });
});
