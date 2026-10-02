import type { Action, Project, ProjectId } from "@/domain/types";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { useAccountStore } from "@/state/accountStore";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionEditor } from "./ActionEditor";

const PID = "p1" as ProjectId;

function project(
  id: string,
  extra: {
    diskId?: string;
    name?: string;
    menus?: unknown[];
    dialogs?: unknown[];
    i18nKeys?: object;
  },
): Project {
  return {
    id: id as ProjectId,
    name: extra.name ?? id,
    diskId: extra.diskId,
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: extra.menus ?? [],
    commands: [],
    dialogs: extra.dialogs ?? [],
    assets: [],
    dataSources: [],
    i18nKeys: extra.i18nKeys ?? {},
    defaultLang: "fr",
    canvasLayout: {},
  } as unknown as Project;
}

const menu = (id: string, extra: object = {}) => ({ id, rows: 3, layers: [], title: [], ...extra });

const edited = () =>
  project("p1", { menus: [menu("accueil")], dialogs: [{ id: "regles", buttons: [] }] });
const boutique = () =>
  project("internal-9", {
    diskId: "boutique",
    name: "Boutique",
    menus: [
      menu("catalogue", {
        title: [{ kind: "plain", value: { key: "kc" } }],
        contextInputs: [{ kind: "primitive", name: "categorie", type: "string" }],
      }),
    ],
    dialogs: [{ id: "aide", buttons: [] }],
    i18nKeys: { kc: { fr: "Catalogue" } },
  });

beforeEach(() => {
  useAccountStore.setState({
    account: { id: "a" as never, projectOrder: [PID], projects: [edited()] },
  } as never);
  useServerIndexStore.setState({
    scope: "n/s",
    status: "ready",
    // The edited project's published copy is in the index too: it must not be offered twice.
    projects: [boutique(), edited()],
    failed: [],
  });
});

const openMenu = (menuId: string): Action => ({ type: "open_menu", menuId: menuId as never });

describe("open_menu target across projects", () => {
  it("lists the other projects' menus under their project and picks them qualified", async () => {
    const onChange = vi.fn();
    render(<ActionEditor projectId={PID} action={openMenu("accueil")} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /accueil/ }));
    expect(screen.getByText("Boutique")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitemradio", { name: /accueil/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole("menuitemradio", { name: /catalogue/ }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ menuId: "boutique:catalogue" }),
    );
  });

  it("shows a qualified target with its title, not as missing", () => {
    render(
      <ActionEditor projectId={PID} action={openMenu("boutique:catalogue")} onChange={vi.fn()} />,
    );
    const trigger = screen.getByRole("button", { name: /boutique:catalogue/ });
    expect(trigger).toHaveTextContent("Catalogue");
    expect(trigger).not.toHaveTextContent(/introuvable|missing/);
  });

  it("offers the context inputs of a menu that lives in another project", () => {
    render(
      <ActionEditor projectId={PID} action={openMenu("boutique:catalogue")} onChange={vi.fn()} />,
    );
    expect(screen.getByText("categorie")).toBeInTheDocument();
  });

  it("still reports a qualified target that exists nowhere", () => {
    render(
      <ActionEditor projectId={PID} action={openMenu("boutique:absent")} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /boutique:absent/ })).toHaveTextContent(
      /introuvable|missing/,
    );
  });
});

describe("open_dialog target across projects", () => {
  it("offers the other projects' dialogs, qualified, grouped by project", () => {
    const onChange = vi.fn();
    render(
      <ActionEditor
        projectId={PID}
        action={{ type: "open_dialog", dialogId: "regles" as never }}
        onChange={onChange}
      />,
    );
    const select = screen.getByRole("combobox");
    const group = within(select).getByRole("group", { name: "Boutique" });
    expect(within(group).getByRole("option", { name: "aide" })).toHaveValue("boutique:aide");
    expect(within(select).getAllByRole("option", { name: "regles" })).toHaveLength(1);
    fireEvent.change(select, { target: { value: "boutique:aide" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dialogId: "boutique:aide" }));
  });
});
