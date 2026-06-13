import { describe, expect, it } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { buildPackElements } from "./usePackElements";

const PID = "p1" as PackId;
function pack(): Pack {
  return {
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m1", packId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [{ id: "c1", packId: PID, name: "heal", arguments: [], steps: [] } as any],
    dialogs: [{ id: "d1", packId: PID, title: { _: "" }, canCloseWithEscape: true, body: [], inputs: [], buttons: [] } as any],
    templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", canvasLayout: { m1: { x: 0, y: 0 } } as any,
  } as Pack;
}

describe("buildPackElements", () => {
  it("groupe par catégorie avec id, label, type et flag onBoard", () => {
    const groups = buildPackElements(pack(), "en");
    const menus = groups.find((g) => g.type === "menu")!;
    expect(menus.items[0]).toMatchObject({ id: "m1", onBoard: true, type: "menu" });
    const cmds = groups.find((g) => g.type === "command")!;
    expect(cmds.items[0]).toMatchObject({ id: "c1", label: "/heal", onBoard: false });
    const dlgs = groups.find((g) => g.type === "dialog")!;
    expect(dlgs.items[0]).toMatchObject({ id: "d1", onBoard: false });
  });
});
