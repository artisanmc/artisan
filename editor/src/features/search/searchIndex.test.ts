import type { Project, ProjectId } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { buildSearchIndex, groupResultsForDisplay, searchQuery } from "./searchIndex";

const PID = "p1" as ProjectId;
function project(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: {
      menu: [
        {
          id: "m_shop",
          projectId: PID,
          title: [{ kind: "plain", value: { key: "k_title" } }],
          rows: 3,
          layers: [
            {
              id: "L1",
              name: "default",
              elements: [
                {
                  id: "el_buy",
                  positions: "13",
                  display: {
                    material: "DIAMOND",
                    title: { key: "k_buytitle" },
                    lore: { key: "k_buylore" },
                  },
                  states: [],
                },
              ],
            },
          ],
        } as any,
      ],
      command: [{ id: "c_heal", projectId: PID, name: "heal", arguments: [], steps: [] } as any],
      dialog: [
        {
          id: "d_confirm",
          projectId: PID,
          title: { key: "k_dtitle" },
          canCloseWithEscape: true,
          body: [{ type: "text", text: { key: "k_dbody" } }],
          inputs: [],
          buttons: [{ id: "btn_ok", label: { key: "k_btn" }, steps: [] }],
        } as any,
      ],
    },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {
      k_title: { en: "Shop" },
      k_buytitle: { en: "Buy now" },
      k_buylore: { en: "Costs 10 coins" },
      k_dtitle: { en: "Confirm" },
      k_dbody: { en: "Are you sure?" },
      k_btn: { en: "OK" },
    } as any,
    defaultLang: "en",
    canvasLayout: {},
  } as Project;
}

describe("buildSearchIndex", () => {
  it("indexes menus, commands, dialogs (element level)", () => {
    const idx = buildSearchIndex(project(), "en");
    expect(idx.find((e) => e.group === "menu" && e.label === "Shop")?.target.openId).toBe("m_shop");
    expect(idx.find((e) => e.group === "command" && e.label === "/heal")?.target.openId).toBe(
      "c_heal",
    );
    expect(idx.find((e) => e.group === "dialog" && e.label === "Confirm")?.target.openId).toBe(
      "d_confirm",
    );
  });
  it("indexes menu items with target = menu + slot", () => {
    const idx = buildSearchIndex(project(), "en");
    const item = idx.find((e) => e.group === "content" && e.label === "DIAMOND");
    expect(item?.target).toEqual({
      openId: "m_shop",
      kind: "menu",
      selectId: "el_buy",
      focusedSlot: 13,
    });
    expect(item?.context).toEqual({ key: "search.ctxInMenu", owner: "Shop" });
  });
  it("indexes texts (item title/lore, dialog body + button)", () => {
    const idx = buildSearchIndex(project(), "en");
    expect(idx.some((e) => e.label === "Buy now" && e.target.selectId === "el_buy")).toBe(true);
    expect(idx.some((e) => e.label === "Costs 10 coins" && e.target.selectId === "el_buy")).toBe(
      true,
    );
    expect(idx.some((e) => e.label === "Are you sure?" && e.target.openId === "d_confirm")).toBe(
      true,
    );
    expect(idx.some((e) => e.label === "OK" && e.target.openId === "d_confirm")).toBe(true);
  });
});

describe("searchQuery", () => {
  it("filters by case-insensitive substring", () => {
    const idx = buildSearchIndex(project(), "en");
    const r = searchQuery(idx, "diam");
    expect(r.some((e) => e.label === "DIAMOND")).toBe(true);
    expect(r.every((e) => e.haystack.includes("diam"))).toBe(true);
  });
  it("searching the owning menu's name surfaces its items", () => {
    const r = searchQuery(buildSearchIndex(project(), "en"), "shop");
    expect(r.some((e) => e.label === "DIAMOND")).toBe(true); // the item is found via owner "Shop"
  });
  it("ranks element before content, exact/prefix before substring", () => {
    const idx = buildSearchIndex(project(), "en");
    const r = searchQuery(idx, "shop");
    expect(r[0]?.group).toBe("menu");
  });
  it("empty query returns []", () => {
    expect(searchQuery(buildSearchIndex(project(), "en"), "  ")).toEqual([]);
  });
});

describe("groupResultsForDisplay", () => {
  it("keeps each group contiguous, preserving appearance order + intra-group order", () => {
    const e = (id: string, group: any) => ({
      id,
      group,
      label: id,
      haystack: id,
      target: { openId: id },
    });
    // score order (input): menuA, command, menuB, content → menuB must join menuA
    const input = [
      e("menuA", "menu"),
      e("cmd", "command"),
      e("menuB", "menu"),
      e("c1", "content"),
    ] as any;
    const out = groupResultsForDisplay(input);
    expect(out.map((x) => x.id)).toEqual(["menuA", "menuB", "cmd", "c1"]);
    // groupes contigus : menu, menu, command, content
    expect(out.map((x) => x.group)).toEqual(["menu", "menu", "command", "content"]);
  });
  it("groupe vide → []", () => {
    expect(groupResultsForDisplay([])).toEqual([]);
  });
});
