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
  it("attaches a project to its module through a declared screen", () => {
    const owner = ownerModuleOf({ id: "boutique_shop" }, [screen({})]);
    expect(owner).toBe("boutique");
  });

  it("matches on the DISK id, the one the module declares", () => {
    // When another server already holds the disk id, the internal id differs —
    // but the module declared its disk id.
    const owner = ownerModuleOf(
      { id: "proj_58967c930e9e", externalId: "boutique_shop" },
      [screen({})],
    );
    expect(owner).toBe("boutique");
  });

  it("leaves an ordinary project in the flat list", () => {
    expect(ownerModuleOf({ id: "pack_ac4c" }, [screen({})])).toBeUndefined();
  });

  it("respects an already-known ownership rather than re-deriving it", () => {
    const owner = ownerModuleOf({ id: "x", ownerModule: "quests" }, [screen({})]);
    expect(owner).toBe("quests");
  });

  it("ignores a screen without a module", () => {
    expect(ownerModuleOf({ id: "boutique_shop" }, [screen({ moduleId: null })])).toBeUndefined();
  });
});
