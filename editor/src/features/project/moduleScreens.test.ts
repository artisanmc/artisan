import type { Project } from "@/domain/types";
import type { ServerEditorScreen } from "@/lib/api/configScreens";
import { describe, expect, it } from "vitest";
import { moduleScreensOf } from "./moduleScreens";

const project = {
  id: "boutique_shop",
  ownerModule: "boutique",
  documents: {},
} as unknown as Project;
const screen = (id: string, extra: Partial<ServerEditorScreen>) =>
  ({ id, label: id, table: id, ...extra }) as ServerEditorScreen;

describe("moduleScreensOf", () => {
  it("keeps the folder's own screens and its module's, not another module's", () => {
    const screens = [
      screen("own", { projectId: "boutique_shop" }),
      screen("module", { moduleId: "boutique" }),
      screen("other", { moduleId: "quests" }),
    ];
    expect(moduleScreensOf(project, screens).map((s) => s.id)).toEqual(["own", "module"]);
  });
});
