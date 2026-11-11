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
