import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Tooltip } from "./tooltip";

it("opens instantly on focus, with an arrow, and describes its trigger", async () => {
  render(
    <Tooltip content="Brouillon enregistré">
      <button type="button">Enregistrer</button>
    </Tooltip>,
  );
  const trigger = screen.getByRole("button");
  fireEvent.focus(trigger);
  const tip = await screen.findByRole("tooltip");
  expect(tip).toHaveTextContent("Brouillon enregistré");
  expect(document.querySelector("[data-tooltip-arrow]")).not.toBeNull();
  expect(trigger).toHaveAttribute("aria-describedby", tip.id);
});
