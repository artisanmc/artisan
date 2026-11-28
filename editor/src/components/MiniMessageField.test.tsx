import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MiniMessageField } from "./MiniMessageField";

const content = () => document.querySelector(".cm-content") as HTMLElement;

it("shows the text styled in the rich editor, its toolbar only while it is edited", () => {
  render(<MiniMessageField value="<red>Hello" onChange={vi.fn()} aria-label="title" />);
  expect(content().textContent).toBe("Hello");
  expect(screen.queryByRole("toolbar")).toBeNull();
  fireEvent.focus(content());
  expect(screen.getByRole("toolbar")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Code" }));
  expect(content().textContent).toBe("<red>Hello");
});

it("offers the color and gradient button on a one-line field", () => {
  render(<MiniMessageField value="x" onChange={vi.fn()} aria-label="t" />);
  fireEvent.focus(content());
  expect(screen.getByRole("button", { name: "Couleur et dégradé" })).toBeTruthy();
});

it("in a label, a click in the text does not press the toolbar's first button", () => {
  const onChange = vi.fn();
  render(
    // biome-ignore lint/a11y/noLabelWithoutControl: what a module writes
    <label>
      Objective
      <MiniMessageField value="Hello" onChange={onChange} aria-label="objective" />
    </label>,
  );
  fireEvent.focus(content());
  const bold = screen.getAllByRole("button")[0] as HTMLElement;
  const pressed = vi.fn();
  bold.addEventListener("click", pressed);
  // The text's line and the field's frame, both under the label.
  fireEvent.click(content());
  fireEvent.click(content().closest(".cm-editor") as HTMLElement);
  expect(pressed).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});
