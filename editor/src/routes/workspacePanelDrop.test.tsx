import { describe, expect, it } from "vitest";
import { handlePanelDrop } from "./networks.$networkId.servers.$serverId.workspaces.$workspaceId";
import { useAccountStore } from "@/state/accountStore";
import type { PackId } from "@/domain/types";

describe("handlePanelDrop", () => {
  it("ajoute l'élément à la planche aux coordonnées monde fournies", () => {
    useAccountStore.setState({
      account: {
        id: "a" as never,
        packOrder: ["p1" as PackId],
        packs: [
          {
            id: "p1",
            name: "p",
            source: "user_created",
            createdAt: "",
            updatedAt: "",
            menus: [{ id: "m2", packId: "p1", title: [], rows: 3, layers: [] }],
            commands: [],
            dialogs: [],
            templates: [],
            assets: [],
            dataSources: [],
            importedConnectors: [],
            i18nKeys: {},
            defaultLang: "en",
            canvasLayout: {},
          },
        ],
      },
    } as never);

    handlePanelDrop("p1" as PackId, "m2", 120, 80);

    const pack = useAccountStore.getState().account.packs.find((p) => p.id === "p1")!;
    expect("m2" in pack.canvasLayout).toBe(true);
    expect(pack.canvasLayout["m2" as keyof typeof pack.canvasLayout]).toEqual({ x: 120, y: 80 });
  });
});
