import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandMetaForm } from "./CommandMetaForm";

const command = {
  id: "c1",
  packId: "p1",
  name: "/shop",
  aliases: [],
  permission: "artisan.shop",
  description: "Open shop",
  arguments: [],
  steps: [],
} as any;

const pack = {
  id: "p1",
  i18nKeys: {},
  defaultLang: "en",
} as any;

describe("CommandMetaForm", () => {
  it("renders name and permission inputs", () => {
    render(<CommandMetaForm pack={pack} command={command} onChange={() => {}} />);
    expect(screen.getByDisplayValue("/shop")).toBeInTheDocument();
    expect(screen.getByDisplayValue("artisan.shop")).toBeInTheDocument();
  });

  it("invokes onChange with patched name when input changes", () => {
    const onChange = vi.fn();
    render(<CommandMetaForm pack={pack} command={command} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("/shop"), { target: { value: "/store" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: "/store" }));
  });

  it("invokes onChange with patched permission when permission input changes", () => {
    const onChange = vi.fn();
    render(<CommandMetaForm pack={pack} command={command} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("artisan.shop"), {
      target: { value: "artisan.store" },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ permission: "artisan.store" }));
  });

  it("renders aliases joined by comma", () => {
    const cmd = { ...command, aliases: ["s", "store"] };
    render(<CommandMetaForm pack={pack} command={cmd} onChange={() => {}} />);
    expect(screen.getByDisplayValue("s, store")).toBeInTheDocument();
  });

  it("invokes onChange with split aliases when aliases input changes", () => {
    const onChange = vi.fn();
    render(<CommandMetaForm pack={pack} command={command} onChange={onChange} />);
    const inputs = screen.getAllByRole("textbox");
    // aliases is the second input
    const aliasesInput = inputs[1]!;
    fireEvent.change(aliasesInput, { target: { value: "a, b, c" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ aliases: ["a", "b", "c"] }),
    );
  });
});
