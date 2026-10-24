import type { DocumentKindContribution } from "@artisan/editor-sdk";
import { describe, expect, it } from "vitest";
import { kindCreatableIn } from "./moduleDocumentKinds";

const kind = (projects?: string[]) =>
  ({ kind: "shop_thing", projects }) as DocumentKindContribution;

describe("kindCreatableIn — a kind reserved to its module's folder (SDK 1.7)", () => {
  it("offers a kind without `projects` everywhere", () => {
    expect(kindCreatableIn(kind(), { id: "pack_a" })).toBe(true);
  });

  it("offers a reserved kind only in the folders it lists, by disk id", () => {
    const reserved = kind(["boutique_addon"]);
    expect(kindCreatableIn(reserved, { id: "internal", diskId: "boutique_addon" })).toBe(true);
    expect(kindCreatableIn(reserved, { id: "boutique_addon" })).toBe(true);
    expect(kindCreatableIn(reserved, { id: "pack_a" })).toBe(false);
    expect(kindCreatableIn(reserved, undefined)).toBe(false);
  });
});
