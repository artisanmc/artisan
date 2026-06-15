import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RevealField } from "./RevealField";

function setup(props: Partial<React.ComponentProps<typeof RevealField>> = {}) {
  return render(
    <RevealField
      value="<red>Hi</red>"
      onChange={() => {}}
      entries={[]}
      facade={<span>RENDERED</span>}
      preview={<div>PREVIEW</div>}
      placeholder="type here"
      {...props}
    />,
  );
}

describe("RevealField", () => {
  it("shows the facade and hides the editor + preview by default", () => {
    setup();
    expect(screen.getByText("RENDERED")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("PREVIEW")).not.toBeInTheDocument();
  });

  it("reveals the editor and preview when the facade is clicked", () => {
    setup();
    fireEvent.click(screen.getByText("RENDERED"));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("PREVIEW")).toBeInTheDocument();
  });

  it("reveals the editor when the facade gains focus (tab navigation)", () => {
    setup();
    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("collapses back to the facade on blur", () => {
    setup();
    fireEvent.click(screen.getByText("RENDERED"));
    fireEvent.blur(screen.getByRole("combobox"));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("RENDERED")).toBeInTheDocument();
    expect(screen.queryByText("PREVIEW")).not.toBeInTheDocument();
  });

  it("shows the placeholder instead of the facade when the value is empty", () => {
    setup({ value: "" });
    expect(screen.getByText("type here")).toBeInTheDocument();
    expect(screen.queryByText("RENDERED")).not.toBeInTheDocument();
  });

  it("fires onActivate on enter and onDeactivate on leave", () => {
    let activated = 0;
    let deactivated = 0;
    setup({ onActivate: () => activated++, onDeactivate: () => deactivated++ });
    fireEvent.click(screen.getByText("RENDERED"));
    expect(activated).toBe(1);
    fireEvent.blur(screen.getByRole("combobox"));
    expect(deactivated).toBe(1);
  });
});
