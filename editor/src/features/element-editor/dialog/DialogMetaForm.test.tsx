import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DialogMetaForm } from "./DialogMetaForm";

vi.mock("./DialogButtonRow", () => ({
  DialogButtonRow: ({ button }: any) => <div>BTN_{button.id ?? "u"}</div>,
}));

const pack = {
  id: "p1",
  menus: [],
  commands: [],
  dialogs: [],
  i18nKeys: {
    t1: { en: "Hello" },
    b1: { en: "Body text" },
    l1: { en: "OK" },
  },
  defaultLang: "en",
} as any;

const dialog = {
  id: "d1",
  title: { key: "t1" },
  canCloseWithEscape: true,
  body: [{ type: "text", text: { key: "b1" } }],
  inputs: [],
  buttons: [{ id: "btn1", label: { key: "l1" }, steps: [] }],
} as any;

describe("DialogMetaForm", () => {
  it("renders title input, body field, and one row per button", () => {
    render(<DialogMetaForm pack={pack} dialog={dialog} onChange={() => {}} />);
    expect(screen.getByDisplayValue("Hello")).toBeInTheDocument();
    expect(screen.getByText("BTN_btn1")).toBeInTheDocument();
  });

  it("invokes onChange when the title input changes (V1 stub: dialog object passed through)", () => {
    const onChange = vi.fn();
    render(<DialogMetaForm pack={pack} dialog={dialog} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("Hello"), {
      target: { value: "Hi" },
    });
    expect(onChange).toHaveBeenCalled();
  });
});
