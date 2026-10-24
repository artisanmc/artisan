import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ItemEditor } from "./ItemEditor";

it("returns from the existing cheat sheet to the item without losing field edits", async () => {
  render(
    <ItemEditor
      source={<input aria-label="source" defaultValue="STONE" />}
      appearance={{}}
      inherited={{ lore: [] }}
      preview={{ lore: [] }}
      onText={vi.fn()}
      onCount={vi.fn()}
      onAdvanced={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /modifier l.item/i }));
  fireEvent.change(screen.getByLabelText("source"), { target: { value: "DIAMOND" } });
  fireEvent.click(screen.getByRole("button", { name: /ouvrir l’aide-mémoire/i }));
  const help = screen.getByRole("dialog", { name: "Aide-mémoire" });
  expect(within(help).getByText("Afficher un placeholder")).toBeInTheDocument();
  fireEvent.keyDown(help, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Aide-mémoire" })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("dialog", { name: /modifier l.item/i })).toBeInTheDocument();
  expect(screen.getByLabelText("source")).toHaveValue("DIAMOND");
});

it("copies an available context placeholder with braces", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(
    <ItemEditor
      source={null}
      appearance={{}}
      inherited={{ lore: [] }}
      preview={{ lore: [] }}
      entries={[{ path: "quest.name", type: "string", origin: "iteration", sample: "First quest" }]}
      onText={vi.fn()}
      onCount={vi.fn()}
      onAdvanced={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /modifier l.item/i }));
  expect(screen.getByText("{quest.name}")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Copier {quest.name}" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("{quest.name}"));
  expect(await screen.findByRole("button", { name: "Copié ! {quest.name}" })).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("keeps the preview in place and edits in a modal closed by Done or Escape", async () => {
  render(
    <ItemEditor
      source={<input aria-label="source" />}
      appearance={{}}
      inherited={{ lore: [] }}
      preview={{ material: "DIAMOND_SWORD", title: "Rare sword", lore: ["A reward"], count: 3 }}
      onText={vi.fn()}
      onCount={vi.fn()}
      onAdvanced={vi.fn()}
    />,
  );
  expect(screen.getByText("Rare sword")).toBeInTheDocument();
  expect(screen.getByText("A reward")).toBeInTheDocument();
  expect(screen.queryByLabelText("source")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /modifier l.item/i }));
  const dialog = screen.getByRole("dialog", { name: /modifier l.item/i });
  expect(within(dialog).getByLabelText("source")).toBeInTheDocument();
  expect(screen.getByTestId("item-editor")).not.toContainElement(dialog);
  expect(within(screen.getByTestId("item-editor")).getByText("Rare sword")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /terminé/i }));
  expect(screen.queryByLabelText("source")).not.toBeInTheDocument();
  const trigger = screen.getByRole("button", { name: /modifier l.item/i });
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("does not offer inheritance for a plain material with no inherited values", () => {
  render(
    <ItemEditor
      source={null}
      title="My stone"
      appearance={{}}
      inherited={{ material: "STONE", lore: [] }}
      preview={{ material: "STONE", lore: [] }}
      onText={vi.fn()}
      onCount={vi.fn()}
      onAdvanced={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /modifier l.item/i }));
  expect(screen.queryByText(/héritée/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /valeur héritée/i })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /lore hérité|insérer le lore/i }),
  ).not.toBeInTheDocument();
});

it("inserts source lore below custom lines when the source has lore", () => {
  const onText = vi.fn();
  render(
    <ItemEditor
      source={null}
      appearance={{}}
      lore="Offer"
      inherited={{ lore: ["Original"] }}
      preview={{ lore: ["Offer"] }}
      onText={onText}
      onCount={vi.fn()}
      onAdvanced={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /modifier l.item/i }));
  fireEvent.click(screen.getByRole("button", { name: /lore hérité|insérer le lore/i }));
  expect(onText).toHaveBeenCalledWith("lore", "Offer\n{base.lore}");
});

it("keeps the base lore by default and only drops it when replacement is ticked", () => {
  const onLoreMode = vi.fn();
  render(
    <ItemEditor
      source={null}
      appearance={{}}
      lore="Offer"
      inherited={{ lore: ["Original"] }}
      preview={{ lore: ["Original", "Offer"] }}
      onLoreMode={onLoreMode}
      onText={vi.fn()}
      onCount={vi.fn()}
      onAdvanced={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /modifier l.item/i }));
  const box = screen.getByRole("checkbox", { name: /remplacer le lore/i });
  expect(box).not.toBeChecked();
  fireEvent.click(box);
  expect(onLoreMode).toHaveBeenCalledWith("replace");
});

it("offers no replacement toggle when the base item carries no lore", () => {
  render(
    <ItemEditor
      source={null}
      appearance={{}}
      inherited={{ lore: [] }}
      preview={{ lore: [] }}
      onLoreMode={vi.fn()}
      onText={vi.fn()}
      onCount={vi.fn()}
      onAdvanced={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /modifier l.item/i }));
  expect(screen.queryByRole("checkbox", { name: /remplacer le lore/i })).not.toBeInTheDocument();
});

it("shows an empty lore field rather than a {base.lore} placeholder when nothing is authored", () => {
  render(
    <ItemEditor
      source={null}
      appearance={{}}
      inherited={{ lore: ["Original"] }}
      preview={{ lore: ["Original"] }}
      loreMode={undefined}
      onLoreMode={vi.fn()}
      onText={vi.fn()}
      onCount={vi.fn()}
      onAdvanced={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /modifier l.item/i }));
  expect(screen.queryByDisplayValue("{base.lore}")).not.toBeInTheDocument();
});

it("edits the name and lore in rich editors next to the item's in-game tooltip", () => {
  render(
    <ItemEditor
      source={null}
      appearance={{}}
      inherited={{ lore: [] }}
      preview={{ material: "DIAMOND_SWORD", title: "<gold>Rare sword", lore: ["A reward"] }}
      title="<gold>Rare sword"
      lore="A reward"
      onText={vi.fn()}
      onCount={vi.fn()}
      onAdvanced={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /modifier l.item/i }));
  const dialog = screen.getByRole("dialog", { name: /modifier l.item/i });
  const editors = [...dialog.querySelectorAll(".cm-content")].map((node) => node.textContent);
  // Rich view: the tags are hidden, the text shows styled.
  expect(editors).toEqual(["Rare sword", "A reward"]);
  // No click action on an item's text: the game ignores it there.
  expect(within(dialog).queryByRole("button", { name: /^Action au clic/ })).toBeNull();
  expect(within(dialog).getAllByRole("button", { name: /^Dégradé/ })).toHaveLength(2);
  const column = within(dialog).getByTestId("item-preview-column");
  expect(within(column).getByTestId("mc-tooltip")).toBeInTheDocument();
});
