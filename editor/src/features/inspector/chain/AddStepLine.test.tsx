import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AddStepLine } from "./StepRows";

const open = () =>
  fireEvent.pointerDown(screen.getByRole("button", { name: /Ajouter une étape|Add a step/ }), {
    button: 0,
    ctrlKey: false,
  });

it("filters the actions as one types, ignoring case and accents", async () => {
  render(<AddStepLine indent={0} firstMenuId={undefined} onPick={vi.fn()} />);
  open();
  const menu = await screen.findByRole("menu");
  const before = within(menu).getAllByRole("menuitem").length;
  fireEvent.change(within(menu).getByRole("textbox"), { target: { value: "TELEPORT" } });
  const items = within(menu).getAllByRole("menuitem");
  expect(items.length).toBeLessThan(before);
  expect(items.length).toBeGreaterThan(0);
  for (const item of items) expect(item.textContent).toMatch(/l[ée]port/i);
  fireEvent.change(within(menu).getByRole("textbox"), { target: { value: "zzzz" } });
  expect(within(menu).queryAllByRole("menuitem")).toHaveLength(0);
  expect(within(menu).getByText(/Aucune action|No action matches/)).toBeInTheDocument();
});

it("Enter in the field picks the first match", async () => {
  const onPick = vi.fn();
  render(<AddStepLine indent={0} firstMenuId={undefined} onPick={onPick} />);
  open();
  const field = within(await screen.findByRole("menu")).getByRole("textbox");
  fireEvent.change(field, { target: { value: "teleport" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onPick.mock.calls[0]![0]).toMatchObject({ kind: "action" });
});
