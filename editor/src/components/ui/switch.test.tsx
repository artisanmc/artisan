import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "./switch";

describe("Switch", () => {
  it("reports its state and flips it on click", () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked onCheckedChange={onCheckedChange} aria-label="texture" />);
    const sw = screen.getByRole("switch", { name: "texture" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("does nothing when disabled", () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch checked={false} disabled onCheckedChange={onCheckedChange} aria-label="texture" />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
