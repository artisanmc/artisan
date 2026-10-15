import { describe, expect, it } from "vitest";
import { migrateProjectDocuments } from "./projectDocumentsMigration";

describe("migrateProjectDocuments", () => {
  it("folds the three legacy fields into documents[kind] and is idempotent", () => {
    const raw: Record<string, unknown> = {
      name: "p",
      menus: [{ id: "m1" }],
      commands: [{ id: "c1" }],
    };
    migrateProjectDocuments(raw);
    expect(raw).toEqual({
      name: "p",
      documents: { menu: [{ id: "m1" }], command: [{ id: "c1" }], dialog: [] },
    });
    migrateProjectDocuments(raw);
    expect(raw.documents).toEqual({ menu: [{ id: "m1" }], command: [{ id: "c1" }], dialog: [] });
  });

  it("keeps a project already on the container, module kinds included", () => {
    const raw: Record<string, unknown> = { documents: { quest: [{ id: "q" }] } };
    migrateProjectDocuments(raw);
    expect(raw.documents).toEqual({ quest: [{ id: "q" }], menu: [], command: [], dialog: [] });
  });
});
