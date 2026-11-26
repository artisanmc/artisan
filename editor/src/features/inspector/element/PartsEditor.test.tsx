import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PartsEditor } from "./PartsEditor";

vi.mock("@/features/assets/AssetPicker", () => ({
  AssetPicker: ({
    open,
    onPick,
  }: { open: boolean; onPick: (asset: { id: string; name: string }) => void }) =>
    open ? (
      <button
        type="button"
        onClick={() => onPick({ id: "coin", name: "Coin", width: 54, height: 16 } as never)}
      >
        Choose Coin
      </button>
    ) : null,
}));

const base = {
  projectId: "p" as never,
  menu: { rows: 3, inventoryType: "chest" } as never,
  lang: "en",
  textOf: () => "Buy",
};

it("adds a first image at its own slots, and a text in the edited language", () => {
  const onEdit = vi.fn();
  render(
    <PartsEditor
      {...base}
      element={{ positions: "10" } as never}
      appearance={{ material: "STONE" }}
      onEdit={onEdit}
      onPositions={vi.fn()}
    />,
  );
  expect(screen.queryAllByTestId("part-row")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Ajouter une image" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose Coin" }));
  expect(onEdit).toHaveBeenCalledWith({ type: "addImage", asset: "coin", positions: "10-12" });
  fireEvent.click(screen.getByRole("button", { name: "Ajouter un texte" }));
  expect(onEdit).toHaveBeenLastCalledWith({ type: "addLabel", lang: "en" });
});

it("edits each part of the list: place, order, text, size of the button", () => {
  const onEdit = vi.fn();
  const onPositions = vi.fn();
  render(
    <PartsEditor
      {...base}
      element={{ positions: "10-12" } as never}
      appearance={{
        parts: [{ image: "panel" }, { label: { key: "k" as never }, anchor: "right", size: 12 }],
      }}
      onEdit={onEdit}
      onPositions={onPositions}
    />,
  );
  const rows = screen.getAllByTestId("part-row");
  expect(rows).toHaveLength(2);
  // An image added to a look that draws one keeps the element's slots.
  fireEvent.click(screen.getByRole("button", { name: "Ajouter une image" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose Coin" }));
  expect(onEdit).toHaveBeenLastCalledWith({
    type: "addImage",
    asset: "coin",
    positions: undefined,
  });

  // The list shows the piece in front first: the text, then the image under it.
  const image = within(rows[1]!);
  fireEvent.change(image.getByLabelText("Place"), { target: { value: "top_left" } });
  expect(onEdit).toHaveBeenLastCalledWith({
    type: "patch",
    index: 0,
    patch: { anchor: "top_left" },
  });
  fireEvent.click(image.getByRole("button", { name: "Mettre devant" }));
  expect(onEdit).toHaveBeenLastCalledWith({ type: "move", index: 0, to: 1 });
  expect(image.getByRole("button", { name: "Mettre derrière" })).toBeDisabled();

  const text = within(rows[0]!);
  expect(text.getByLabelText("Texte")).toHaveValue("Buy");
  fireEvent.change(text.getByLabelText("Texte"), { target: { value: "Sell" } });
  expect(onEdit).toHaveBeenLastCalledWith({ type: "text", index: 1, lang: "en", value: "Sell" });
  fireEvent.change(text.getByLabelText("Place"), { target: { value: "center" } });
  expect(onEdit).toHaveBeenLastCalledWith({
    type: "patch",
    index: 1,
    patch: { anchor: undefined },
  });
  fireEvent.click(text.getByRole("button", { name: "Retirer cette pièce" }));
  expect(onEdit).toHaveBeenLastCalledWith({ type: "remove", index: 1 });

  fireEvent.change(screen.getByLabelText("Largeur (slots)"), { target: { value: "4" } });
  expect(onPositions).toHaveBeenCalledWith("10-13");
});
