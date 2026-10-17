import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MiniMessageField } from "./MiniMessageField";

it("shows the rendered text, then the source with its live rendering below once clicked", () => {
  const onChange = vi.fn();
  render(<MiniMessageField value="<red>Hello" onChange={onChange} aria-label="title" />);
  const facade = screen.getByRole("button", { name: "title" });
  expect(facade.textContent).toBe("Hello");
  fireEvent.click(facade);
  const input = screen.getByRole("combobox", { name: "title" });
  expect((input as HTMLInputElement).value).toBe("<red>Hello");
  expect(screen.getAllByText("Hello").length).toBeGreaterThan(0);
  fireEvent.change(input, { target: { value: "<blue>Hi" } });
  expect(onChange).toHaveBeenLastCalledWith("<blue>Hi");
});
