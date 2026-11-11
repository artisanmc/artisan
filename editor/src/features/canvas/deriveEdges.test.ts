import { projectId } from "@/domain/ids";
import { mockOpenProjects } from "@/mock/fixtures";
import { describe, expect, it } from "vitest";
import { deriveEdges } from "./deriveEdges";

describe("deriveEdges", () => {
  it("emits an edge for each open_menu action found in the project", () => {
    const personal = mockOpenProjects().projects.find((p) => p.id === projectId("p_personal"))!;
    const edges = deriveEdges(personal);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "menu/m_shop_main", target: "menu/m_profile" });
  });

  it("emits a command→menu edge when a command opens a menu", () => {
    const shop = mockOpenProjects().projects.find((p) => p.id === projectId("p_shop_system"))!;
    const edges = deriveEdges(shop);
    expect(
      edges.find((e) => e.source === "command/c_shop" && e.target === "menu/m_shop_root"),
    ).toBeTruthy();
  });

  it("reads a ref qualified with the project's own folder as its bare id", () => {
    const shop = mockOpenProjects().projects.find((p) => p.id === projectId("p_shop_system"))!;
    const command = shop.documents.command!.find((c) => c.id === "c_shop")!;
    const opening = (ref: string) =>
      JSON.parse(JSON.stringify(command).replaceAll('"m_shop_root"', JSON.stringify(ref)));
    const qualified = {
      ...shop,
      diskId: "boutique_addon",
      documents: {
        ...shop.documents,
        command: [opening("boutique_addon:m_shop_root")],
      },
    } as typeof shop;
    const edges = deriveEdges(qualified);
    expect(edges.find((e) => e.source === `command/${command.id}`)?.target).toBe(
      "menu/m_shop_root",
    );
    // Another folder's ref stays qualified: it is not on this board.
    const other = {
      ...qualified,
      documents: {
        ...shop.documents,
        command: [opening("spawn:m_shop_root")],
      },
    } as typeof shop;
    expect(deriveEdges(other).find((e) => e.source === `command/${command.id}`)?.target).toBe(
      "menu/spawn:m_shop_root",
    );
  });
});
