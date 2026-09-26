import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { projectId } from "@/domain/ids";
import type { Menu } from "@/domain/types";
import { mockAccount } from "@/mock/fixtures";
import { useAccountStore } from "@/state/accountStore";
import { VanillaTextureLayer } from "./VanillaTextureLayer";

const PERSONAL = projectId("p_personal");
const menu = () =>
  useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!.menus[0]!;

describe("VanillaTextureLayer", () => {
  beforeEach(() => useAccountStore.setState({ account: mockAccount() }));

  it("turns the vanilla texture off for a chest", () => {
    render(<VanillaTextureLayer projectId={PERSONAL} menu={menu()} />);
    const sw = screen.getByRole("switch", { name: "Texture par défaut" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(menu().vanillaTexture).toBe(false);
  });

  it("explains the transparent window once off", () => {
    render(
      <VanillaTextureLayer projectId={PERSONAL} menu={{ ...menu(), vanillaTexture: false }} />,
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/transparente en jeu/)).toBeInTheDocument();
  });

  it("also turns the texture off for hoppers and droppers", () => {
    useAccountStore.getState().setMenuField({
      projectId: PERSONAL,
      menuId: menu().id,
      field: "inventoryType",
      value: "hopper",
    });
    const hopper: Menu = menu();
    render(<VanillaTextureLayer projectId={PERSONAL} menu={hopper} />);
    const sw = screen.getByRole("switch");
    expect(sw).toBeEnabled();
    fireEvent.click(sw);
    expect(menu().vanillaTexture).toBe(false);
  });
});
