import { setComponents } from "@/domain/components";
import { packComponents } from "@/lib/pack/components";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComponentEditor } from "./ComponentEditor";

vi.mock("@/features/assets/useComponentsFeed", () => ({ useComponentsFeed: () => 0 }));
vi.mock("@/features/assets/AssetPicker", () => ({
  AssetPicker: ({ open, onPick }: { open: boolean; onPick: (asset: { id: string }) => void }) =>
    open ? (
      <button type="button" onClick={() => onPick({ id: "coin" } as never)}>
        Choose Coin
      </button>
    ) : null,
}));

const confirm =
  'params:\n  text: { type: text, default: OK }\n  icon: { type: image, default: check }\nparts:\n  - image: button\n  - image: "{icon}"\n  - label: "{text}"\n';

beforeEach(() => {
  const expandOf = packComponents([
    { folder: "shop", files: [{ path: "components/confirm.yml", content: confirm }] },
  ]);
  setComponents(
    new Map([
      [
        "p",
        {
          folder: "shop",
          expand: expandOf("shop"),
          list: [
            {
              name: "confirm",
              common: false,
              params: [
                { name: "text", type: "text", default: "OK" },
                { name: "icon", type: "image", default: "check" },
              ],
            },
          ],
        },
      ],
    ]),
  );
});
afterEach(() => setComponents(new Map()));

const handlers = () => ({ onComponent: vi.fn(), onDetach: vi.fn(), onSave: vi.fn() });

it("offers the Project's components, and to save a look's own pieces as one", () => {
  const on = handlers();
  render(
    <ComponentEditor
      projectId={"p" as never}
      appearance={{ parts: [{ image: "panel" }] }}
      lang="en"
      {...on}
    />,
  );
  fireEvent.change(screen.getByLabelText("Utiliser un composant…"), {
    target: { value: "confirm" },
  });
  expect(on.onComponent).toHaveBeenCalledWith("confirm");
  fireEvent.change(screen.getByLabelText("Enregistrer ces pièces comme composant"), {
    target: { value: "Buy " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
  expect(on.onSave).toHaveBeenCalledWith("buy");
});

it("edits the parameters a look gives its component, and detaches it", () => {
  const on = handlers();
  render(
    <ComponentEditor
      projectId={"p" as never}
      appearance={{ component: { name: "confirm", text: { en: "Buy", fr: "Acheter" } } }}
      lang="fr"
      {...on}
    />,
  );
  expect(screen.getByLabelText("text")).toHaveValue("Acheter");
  fireEvent.change(screen.getByLabelText("text"), { target: { value: "Payer" } });
  expect(on.onComponent).toHaveBeenLastCalledWith({
    name: "confirm",
    text: { en: "Buy", fr: "Payer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Choisir une image" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose Coin" }));
  expect(on.onComponent).toHaveBeenLastCalledWith({
    name: "confirm",
    text: { en: "Buy", fr: "Acheter" },
    icon: "coin",
  });
  fireEvent.click(screen.getByRole("button", { name: "Détacher" }));
  expect(on.onDetach.mock.calls[0]![0].images.map((i: { asset: string }) => i.asset)).toEqual([
    "button",
    "check",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Retirer" }));
  expect(on.onComponent).toHaveBeenLastCalledWith(null);
});

it("says so when no component answers the name", () => {
  render(
    <ComponentEditor
      projectId={"p" as never}
      appearance={{ component: "nowhere" }}
      lang="en"
      {...handlers()}
    />,
  );
  expect(screen.getByText(/Aucun composant de ce nom/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Détacher" })).toBeDisabled();
});

it("offers the names of a choice in a list, the default first", () => {
  const button =
    'params:\n  color: { type: choice, default: green, values: { green: plate, red: plate_red } }\nparts:\n  - image: "{color}"\n';
  const expandOf = packComponents([
    { folder: "shop", files: [{ path: "components/button.yml", content: button }] },
  ]);
  setComponents(
    new Map([
      [
        "p",
        {
          folder: "shop",
          expand: expandOf("shop"),
          list: [
            {
              name: "button",
              common: false,
              params: [
                { name: "color", type: "choice", default: "green", values: ["green", "red"] },
              ],
            },
          ],
        },
      ],
    ]),
  );
  const on = handlers();
  render(
    <ComponentEditor
      projectId={"p" as never}
      appearance={{ component: { name: "button", color: "red" } }}
      lang="fr"
      {...on}
    />,
  );
  const list = screen.getByLabelText("color") as HTMLSelectElement;
  expect(list.value).toBe("red");
  expect([...list.options].map((option) => option.textContent)).toEqual([
    "Par défaut (green)",
    "green",
    "red",
  ]);
  fireEvent.change(list, { target: { value: "green" } });
  expect(on.onComponent).toHaveBeenLastCalledWith({ name: "button", color: "green" });
  // The default again: the look no longer gives the parameter.
  fireEvent.change(list, { target: { value: "" } });
  expect(on.onComponent).toHaveBeenLastCalledWith("button");
});
