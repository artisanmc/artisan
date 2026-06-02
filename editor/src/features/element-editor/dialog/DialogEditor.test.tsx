import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DialogEditor } from "./DialogEditor";

vi.mock("./DialogMetaForm", () => ({ DialogMetaForm: () => <div>META_FORM</div> }));
vi.mock("@/state/accountStore", () => ({
  useAccountStore: (sel: any) => sel({ updateDialog: vi.fn() }),
}));

const pack = {
  id: "p1",
  menus: [],
  commands: [],
  dialogs: [],
  i18nKeys: {},
  defaultLang: "en",
} as any;

const dialog = {
  id: "d1",
  title: { key: "t" },
  canCloseWithEscape: true,
  body: [],
  inputs: [],
  buttons: [],
} as any;

describe("DialogEditor", () => {
  it("mounts DialogMetaForm", () => {
    render(<DialogEditor pack={pack} dialog={dialog} />);
    expect(screen.getByText("META_FORM")).toBeInTheDocument();
  });
});
