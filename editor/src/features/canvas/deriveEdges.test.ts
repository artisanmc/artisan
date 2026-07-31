import { projectId } from "@/domain/ids";
import { mockAccount } from "@/mock/fixtures";
import { describe, expect, it } from "vitest";
import { deriveEdges } from "./deriveEdges";

describe("deriveEdges", () => {
  it("emits an edge for each open_menu action found in the project", () => {
    const personal = mockAccount().projects.find((p) => p.id === projectId("p_personal"))!;
    const edges = deriveEdges(personal);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "m_shop_main", target: "m_profile" });
  });

  it("emits a command→menu edge when a command opens a menu", () => {
    const shop = mockAccount().projects.find((p) => p.id === projectId("p_shop_system"))!;
    const edges = deriveEdges(shop);
    expect(edges.find((e) => e.source === "c_shop" && e.target === "m_shop_root")).toBeTruthy();
  });
});
