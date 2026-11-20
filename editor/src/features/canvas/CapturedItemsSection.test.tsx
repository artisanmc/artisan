import type { ProjectId } from "@/domain/types";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectRuntimeStore } from "@/state/projectRuntimeStore";
import { useProjectsStore } from "@/state/projectsStore";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CapturedItemsSection } from "./CapturedItemsSection";

const EDITED = "p_personal" as ProjectId;

function runtime(captureInGame: boolean, available: boolean) {
  useProjectRuntimeStore.getState().set({
    projectId: EDITED,
    serverId: "s1",
    minecraftVersion: null,
    capabilities: { canRename: true, liveData: true, captureInGame, preview: true },
    connection: { available },
  });
}

describe("CapturedItemsSection inventory mirror", () => {
  beforeEach(() => {
    const open = mockOpenProjects();
    open.projects = open.projects.map((p) => (p.id === EDITED ? { ...p, capturedItems: [] } : p));
    useProjectsStore.setState({ openProjects: open });
  });
  afterEach(() => useProjectRuntimeStore.getState().set(null));

  it("offers the player field when the project's server is online", () => {
    runtime(true, true);
    render(<CapturedItemsSection projectId={EDITED} />);
    expect(screen.getByTestId("load-inventory")).toBeTruthy();
    expect(screen.queryByTestId("capture-offline")).toBeNull();
  });

  it("says why there is no player field when the server is offline", () => {
    runtime(true, false);
    render(<CapturedItemsSection projectId={EDITED} />);
    expect(screen.queryByTestId("load-inventory")).toBeNull();
    expect(screen.getByTestId("capture-offline")).toBeTruthy();
  });
});
