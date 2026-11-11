import { DEFAULT_MODULE_ICON, ModuleRowIcon } from "@/components/ArtisanWordmark";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const ICON = "/api/v1/servers/s/modules/conversations/brand/icon.svg?v=1";

function shown(container: HTMLElement): string[] {
  return [...container.querySelectorAll("img")]
    .filter((img) => !img.classList.contains("hidden"))
    .map((img) => img.getAttribute("src") ?? "");
}

describe("ModuleRowIcon", () => {
  it("shows Artisan's icon until the module's has loaded", () => {
    const { container } = render(<ModuleRowIcon src={ICON} />);
    expect(shown(container)).toEqual([DEFAULT_MODULE_ICON]);
    const icon = container.querySelector(`img[src="${ICON}"]`);
    if (!icon) throw new Error("module icon not rendered");
    fireEvent.load(icon);
    expect(shown(container)).toEqual([ICON]);
  });

  it("keeps Artisan's icon when the module's fails to load", () => {
    const { container } = render(<ModuleRowIcon src={ICON} />);
    const icon = container.querySelector(`img[src="${ICON}"]`);
    if (!icon) throw new Error("module icon not rendered");
    fireEvent.error(icon);
    expect(shown(container)).toEqual([DEFAULT_MODULE_ICON]);
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("draws Artisan's icon once when it is the one asked", () => {
    const { container } = render(<ModuleRowIcon src={DEFAULT_MODULE_ICON} />);
    fireEvent.load(container.querySelector("img") as HTMLImageElement);
    expect(shown(container)).toEqual([DEFAULT_MODULE_ICON]);
  });
});
