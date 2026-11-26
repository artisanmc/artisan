import type { Asset } from "@/domain/asset";
import { type KitRead, type ModuleRead, useKitStore } from "@/state/kitStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ImageReachNote } from "./ImageReachNote";
import { useAssetStore } from "./assetStore";

const common: KitRead = {
  projectId: "srv.artisan",
  files: {},
  binaries: [{ path: "assets/textures/ribbon.png", hash: "h" }],
  byName: true,
};
const bank: ModuleRead = {
  projectId: "srv.bank",
  folder: "bank",
  files: {},
  binaries: [{ path: "assets/textures/gold.png", hash: "h" }],
};

describe("ImageReachNote", () => {
  beforeEach(() => {
    useAssetStore.setState({
      assets: [{ id: "logo", projectId: "srv.core", name: "logo", type: "texture" } as Asset],
    });
    useKitStore.setState({ read: common, modules: [bank], modulesUnread: false });
  });

  const note = (name: string, onRename = vi.fn()) => {
    const view = render(<ImageReachNote projectId="srv.core" name={name} onRename={onRename} />);
    return { ...view, onRename };
  };

  test("says nothing of the module's own image nor of a common one", () => {
    expect(note("logo").container).toBeEmptyDOMElement();
    expect(note("ribbon").container).toBeEmptyDOMElement();
    expect(note("{{row.icon}}").container).toBeEmptyDOMElement();
  });

  test("alerts on a name no image answers", () => {
    note("ghost");
    expect(screen.getByRole("alert").textContent).toMatch(/ghost/);
  });

  test("says whose image a name alone reached, and writes it with its module on request", () => {
    const { onRename } = note("gold");
    expect(screen.getByText(/gold.*bank/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /bank:gold/ }));
    expect(onRename).toHaveBeenCalledWith("bank:gold");
  });

  test("an image named with its module only says whose it is", () => {
    note("bank:gold");
    expect(screen.getByText(/bank/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
