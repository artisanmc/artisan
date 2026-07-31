import { describe, expect, it } from "vitest";
import type { Project, ProjectId } from "@/domain/types";
import { buildSearchIndex, groupResultsForDisplay, searchQuery } from "./searchIndex";

const PID = "p1" as ProjectId;
function pack(): Project {
  return {
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{
      id: "m_shop", projectId: PID, title: [{ kind: "plain", value: { key: "k_title" } }], rows: 3,
      layers: [{ id: "L1", name: "default", elements: [
        { id: "el_buy", positions: "13", appearances: [{ material: "DIAMOND", title: { key: "k_buytitle" }, lore: { key: "k_buylore" } }] },
      ] }],
    } as any],
    commands: [{ id: "c_heal", projectId: PID, name: "heal", arguments: [], steps: [] } as any],
    dialogs: [{ id: "d_confirm", projectId: PID, title: { key: "k_dtitle" }, canCloseWithEscape: true,
      body: [{ type: "text", text: { key: "k_dbody" } }], inputs: [],
      buttons: [{ id: "btn_ok", label: { key: "k_btn" }, steps: [] }] } as any],
    assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {
      k_title: { en: "Shop" }, k_buytitle: { en: "Buy now" }, k_buylore: { en: "Costs 10 coins" },
      k_dtitle: { en: "Confirm" }, k_dbody: { en: "Are you sure?" }, k_btn: { en: "OK" },
    } as any,
    defaultLang: "en", canvasLayout: {},
  } as Project;
}

describe("buildSearchIndex", () => {
  it("indexe menus, commandes, dialogs (niveau élément)", () => {
    const idx = buildSearchIndex(pack(), "en");
    expect(idx.find((e) => e.group === "menu" && e.label === "Shop")?.target.openId).toBe("m_shop");
    expect(idx.find((e) => e.group === "command" && e.label === "/heal")?.target.openId).toBe("c_heal");
    expect(idx.find((e) => e.group === "dialog" && e.label === "Confirm")?.target.openId).toBe("d_confirm");
  });
  it("indexe les items de menu avec cible = menu + slot", () => {
    const idx = buildSearchIndex(pack(), "en");
    const item = idx.find((e) => e.group === "content" && e.label === "DIAMOND");
    expect(item?.target).toEqual({ openId: "m_shop", selectId: "el_buy", focusedSlot: 13 });
    expect(item?.context).toEqual({ key: "search.ctxInMenu", owner: "Shop" });
  });
  it("indexe les textes (titre/lore d'item, corps + bouton de dialog)", () => {
    const idx = buildSearchIndex(pack(), "en");
    expect(idx.some((e) => e.label === "Buy now" && e.target.selectId === "el_buy")).toBe(true);
    expect(idx.some((e) => e.label === "Costs 10 coins" && e.target.selectId === "el_buy")).toBe(true);
    expect(idx.some((e) => e.label === "Are you sure?" && e.target.openId === "d_confirm")).toBe(true);
    expect(idx.some((e) => e.label === "OK" && e.target.openId === "d_confirm")).toBe(true);
  });
});

describe("searchQuery", () => {
  it("filtre par sous-chaîne insensible à la casse", () => {
    const idx = buildSearchIndex(pack(), "en");
    const r = searchQuery(idx, "diam");
    expect(r.some((e) => e.label === "DIAMOND")).toBe(true);
    expect(r.every((e) => e.haystack.includes("diam"))).toBe(true);
  });
  it("chercher le nom du menu propriétaire surface ses items", () => {
    const r = searchQuery(buildSearchIndex(pack(), "en"), "shop");
    expect(r.some((e) => e.label === "DIAMOND")).toBe(true); // l'item est trouvé via owner "Shop"
  });
  it("classe élément avant contenu, exact/préfixe avant sous-chaîne", () => {
    const idx = buildSearchIndex(pack(), "en");
    const r = searchQuery(idx, "shop");
    expect(r[0]?.group).toBe("menu");
  });
  it("requête vide renvoie []", () => {
    expect(searchQuery(buildSearchIndex(pack(), "en"), "  ")).toEqual([]);
  });
});

describe("groupResultsForDisplay", () => {
  it("rend chaque groupe contigu en préservant l'ordre d'apparition + l'ordre intra-groupe", () => {
    const e = (id: string, group: any) => ({ id, group, label: id, haystack: id, target: { openId: id } });
    // ordre par score (entrée) : menuA, command, menuB, content  → menuB doit rejoindre menuA
    const input = [e("menuA", "menu"), e("cmd", "command"), e("menuB", "menu"), e("c1", "content")] as any;
    const out = groupResultsForDisplay(input);
    expect(out.map((x) => x.id)).toEqual(["menuA", "menuB", "cmd", "c1"]);
    // groupes contigus : menu, menu, command, content
    expect(out.map((x) => x.group)).toEqual(["menu", "menu", "command", "content"]);
  });
  it("groupe vide → []", () => {
    expect(groupResultsForDisplay([])).toEqual([]);
  });
});
