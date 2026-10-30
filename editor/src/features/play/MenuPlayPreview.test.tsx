import type { ProjectId } from "@/domain/types";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MenuPlayPreview } from "./MenuPlayPreview";

// Konva stand-ins: no canvas in jsdom.
const Box = vi.hoisted(() => (p: { children?: unknown }) => p.children as never);
vi.mock("react-konva", () => ({
  Stage: Box,
  Layer: Box,
  Group: Box,
  Rect: () => null,
  Image: () => null,
  Text: () => null,
  Line: () => null,
}));
vi.mock("use-image", () => ({ default: () => [null, "loaded"] }));

const project = projectFromFiles("s1.shop" as ProjectId, {
  "plugins/Artisan/projects/shop/artisan-module.yml": "schema: module/v1\n",
  "plugins/Artisan/projects/shop/menus/vip.yml": "schema: menu/v1\nsize: 27\n",
});

describe("MenuPlayPreview", () => {
  it("opens the menu on its own game screen", () => {
    render(<MenuPlayPreview serverId="s1" projects={[project]} projectId="s1.shop" menuId="vip" />);
    expect(screen.getByTestId("mc-screen")).toBeInTheDocument();
    expect(screen.getByTestId("play-menu").getAttribute("data-menu")).toBe("vip");
  });
});
