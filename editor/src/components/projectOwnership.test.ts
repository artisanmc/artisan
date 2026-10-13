import { describe, it, expect } from "vitest";
import { ownerModuleOf } from "./projectOwnership";
import type { ServerEditorScreen } from "@/lib/api/configScreens";

const screen = (p: Partial<ServerEditorScreen>): ServerEditorScreen => ({
  id: "boutique:catalog", moduleId: "boutique", label: "Catalogue",
  table: "data/categories", projectId: "boutique_shop", ...p,
});

/**
 * The "Installed modules" grouping used `ownerModule`, read from a stored copy
 * of the project. That copy no longer exists (ADR `server-disk-only-storage`)
 * and the Boutique fell back into the flat list.
 *
 * Ownership is re-derived from the **declared screens**, which already carry
 * the module → project pair: the module itself declared it in its Presence.
 */
describe("ownerModuleOf", () => {
  it("rattache un project à son module via un écran déclaré", () => {
    const owner = ownerModuleOf({ id: "boutique_shop" }, [screen({})]);
    expect(owner).toBe("boutique");
  });

  it("matche sur l'id DISQUE, celui que le module déclare", () => {
    // When another server already holds the disk id, the internal id differs —
    // but the module declared its disk id.
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
