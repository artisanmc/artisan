import { describe, it, expect } from "vitest";
import { ownerModuleOf } from "./projectOwnership";
import type { ServerEditorScreen } from "@/lib/api/configScreens";

const screen = (p: Partial<ServerEditorScreen>): ServerEditorScreen => ({
  id: "boutique:catalog", moduleId: "boutique", label: "Catalogue",
  table: "data/categories", projectId: "boutique_shop", ...p,
});

/**
 * Le regroupement « Modules installés » se faisait sur `ownerModule`, que le
 * backend lisait dans sa copie du project. Cette copie n'existe plus (ADR
 * `server-disk-only-storage`) et la Boutique est retombée dans la liste plate.
 *
 * La propriété se redérive des **écrans déclarés**, qui portent déjà le couple
 * module → project : c'est le module lui-même qui l'a déclaré au Presence.
 */
describe("ownerModuleOf", () => {
  it("rattache un project à son module via un écran déclaré", () => {
    const owner = ownerModuleOf({ id: "boutique_shop" }, [screen({})]);
    expect(owner).toBe("boutique");
  });

  it("matche sur l'id DISQUE, celui que le module déclare", () => {
    // Quand un autre serveur détient déjà l'id disque, l'id interne diffère —
    // mais le module, lui, a déclaré son id disque.
    const owner = ownerModuleOf(
      { id: "proj_58967c930e9e", externalId: "boutique_shop" },
      [screen({})],
    );
    expect(owner).toBe("boutique");
  });

  it("laisse un project ordinaire dans la liste plate", () => {
    expect(ownerModuleOf({ id: "pack_ac4c" }, [screen({})])).toBeUndefined();
  });

  it("respecte une propriété déjà connue plutôt que de la redériver", () => {
    const owner = ownerModuleOf({ id: "x", ownerModule: "quests" }, [screen({})]);
    expect(owner).toBe("quests");
  });

  it("ignore un écran sans module", () => {
    expect(ownerModuleOf({ id: "boutique_shop" }, [screen({ moduleId: null })])).toBeUndefined();
  });
});
