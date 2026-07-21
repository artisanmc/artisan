import { projectId } from "@/domain/ids";
import { getText } from "@/lib/i18n";
import { beforeEach, describe, expect, it } from "vitest";
import { useAccountStore } from "./accountStore";

const menuV1 = {
  schema: "menu/v1",
  id: "shop",
  title: [{ kind: "plain", value: { key: "menus.shop.title" } }],
  size: 27,
  layers: [
    {
      id: "l1",
      name: "default",
      elements: [
        {
          id: "e1",
          positions: "13",
          appearances: [{ material: "DIAMOND", title: "<gold>Buy</gold>" }],
        },
      ],
    },
  ],
};

describe("applyAssistantMenu", () => {
  beforeEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal account stub for the store
    useAccountStore.getState().setAccount({ id: "a" as any, projects: [], projectOrder: [] });
    useAccountStore.getState().createProject({ id: "p" });
  });
  it("imports the generated menu and merges i18n (literal text becomes resolvable)", () => {
    useAccountStore.getState().applyAssistantMenu({ projectId: projectId("p"), menuV1, lang: "en" });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === projectId("p"))!;
    const menu = pack.menus.find((m) => m.id === "shop")!;
    expect(menu).toBeTruthy();
    const app = menu.layers[0].elements[0].appearances[0];
    expect(getText(pack, app.title, "en")).toBe("<gold>Buy</gold>");
  });
  it("returns the unsupported constructs dropped during conversion", () => {
    const withExotics = {
      ...menuV1,
      layers: [
        {
          id: "l1",
          name: "default",
          elements: [
            {
              id: "e1",
              positions: "13",
              appearances: [
                {
                  if: [{ type: "biome_is", biome: "PLAINS" }],
                  material: "DIAMOND",
                  click: {
                    // Unknown verb in the DSL steps string → recorded as unsupported.
                    left: { steps: "give_effect SPEED" },
                  },
                },
                { material: "STONE" },
              ],
            },
          ],
        },
      ],
    };
    const unsupported = useAccountStore
      .getState()
      .applyAssistantMenu({ projectId: projectId("p"), menuV1: withExotics, lang: "en" });
    expect(unsupported).toContain("condition: biome_is");
    expect(unsupported.join(" ")).toMatch(/give_effect/);
  });
  it("returns an empty list for a fully supported menu", () => {
    const unsupported = useAccountStore
      .getState()
      .applyAssistantMenu({ projectId: projectId("p"), menuV1, lang: "en" });
    expect(unsupported).toEqual([]);
  });
  it("replaces an existing menu with the same id", () => {
    useAccountStore.getState().applyAssistantMenu({ projectId: projectId("p"), menuV1, lang: "en" });
    useAccountStore
      .getState()
      .applyAssistantMenu({ projectId: projectId("p"), menuV1: { ...menuV1, size: 54 }, lang: "en" });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === projectId("p"))!;
    expect(pack.menus.filter((m) => m.id === "shop")).toHaveLength(1);
    expect(pack.menus.find((m) => m.id === "shop")!.rows).toBe(6);
  });
});
