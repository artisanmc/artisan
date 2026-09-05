import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerImportSourceDialog } from "./ServerImportSourceDialog";

const { listImportSources } = vi.hoisted(() => ({ listImportSources: vi.fn() }));

vi.mock("@/lib/api/importSources", () => ({ listImportSources }));

describe("ServerImportSourceDialog", () => {
  it("selects all descendants of a filtered folder and exposes expanded state", async () => {
    listImportSources.mockResolvedValue({
      ok: true,
      sources: [
        {
          id: "zmenu",
          label: "zMenu",
          files: [
            { path: "folder/a.yml", size: 1 },
            { path: "folder/b.yml", size: 1 },
          ],
        },
      ],
    });
    const onAttach = vi.fn();
    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={onAttach}
      />,
    );
    await userEvent.type(await screen.findByRole("textbox"), "a.yml");
    expect(screen.getByRole("button", { name: /folder/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /folder/i }));
    await userEvent.click(screen.getByRole("button", { name: /^joindre$/i }));
    expect(onAttach.mock.calls[0][0][0].files).toHaveLength(2);
  });

  it("prevents a single file exceeding 1 MiB", async () => {
    listImportSources.mockResolvedValue({
      ok: true,
      sources: [
        { id: "zmenu", label: "zMenu", files: [{ path: "large.yml", size: 1024 * 1024 + 1 }] },
      ],
    });
    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={vi.fn()}
      />,
    );
    await userEvent.click(await screen.findByRole("checkbox", { name: /large/i }));
    expect(screen.getByRole("button", { name: /^joindre$/i })).toBeDisabled();
    expect(screen.getByText(/maximum 1 Mio/i)).toBeInTheDocument();
  });

  it("counts existing attachments and drops failed source selections after refresh", async () => {
    const files = Array.from({ length: 200 }, (_, i) => ({ path: `bulk/menu${i}.yml`, size: 1 }));
    listImportSources
      .mockResolvedValueOnce({
        ok: true,
        sources: [
          { id: "zmenu", label: "zMenu", files: [...files, { path: "extra.yml", size: 1 }] },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        sources: [{ id: "zmenu", label: "zMenu", files, error: "too_many_entries" }],
      });
    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        existingGroups={[{ sourceId: "zmenu", label: "zMenu", files }]}
        onAttach={vi.fn()}
      />,
    );
    await userEvent.click(await screen.findByRole("checkbox", { name: /extra/i }));
    expect(screen.getByRole("button", { name: /^joindre$/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /actualiser/i }));
    await screen.findByText(/trop d'entrées/i);
    expect(screen.getByText(/0 fichier/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^joindre$/i })).toBeDisabled();
  });
  beforeEach(() => {
    listImportSources.mockReset();
  });

  it("attaches every file selected through a folder", async () => {
    listImportSources.mockResolvedValue({
      ok: true,
      sources: [
        {
          id: "zmenu",
          label: "zMenu",
          files: [
            { path: "shop.yml", size: 10 },
            { path: "categories/blocks.yml", size: 20 },
            { path: "categories/tools.yml", size: 30 },
          ],
        },
      ],
    });
    const user = userEvent.setup();
    const onAttach = vi.fn();

    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={onAttach}
      />,
    );

    await user.click(await screen.findByRole("checkbox", { name: /categories/i }));
    await user.click(screen.getByRole("button", { name: /attach|joindre/i }));

    expect(onAttach).toHaveBeenCalledWith([
      {
        sourceId: "zmenu",
        label: "zMenu",
        files: [
          { path: "categories/blocks.yml", size: 20 },
          { path: "categories/tools.yml", size: 30 },
        ],
      },
    ]);
  });

  it("shows a loading state while the server is listing files", () => {
    listImportSources.mockReturnValue(new Promise(() => {}));

    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={vi.fn()}
      />,
    );

    expect(screen.getByText(/lecture des fichiers disponibles/i)).toBeInTheDocument();
  });

  it("explains when no import source is configured", async () => {
    listImportSources.mockResolvedValue({ ok: true, sources: [] });

    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={vi.fn()}
      />,
    );

    expect(await screen.findByText(/aucune source d'import/i)).toBeInTheDocument();
  });

  it("shows the offline state with a retry action", async () => {
    listImportSources.mockResolvedValue({ ok: false, error: "server_offline" });

    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={vi.fn()}
      />,
    );

    expect(await screen.findByText(/serveur est hors ligne/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /réessayer/i })).toBeInTheDocument();
  });

  it("retries after a listing timeout", async () => {
    listImportSources
      .mockResolvedValueOnce({ ok: false, error: "fetch_timeout" })
      .mockResolvedValueOnce({ ok: true, sources: [] });
    const user = userEvent.setup();

    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={vi.fn()}
      />,
    );

    expect(await screen.findByText(/n'a pas répondu à temps/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /réessayer/i }));
    expect(await screen.findByText(/aucune source d'import/i)).toBeInTheDocument();
    expect(listImportSources).toHaveBeenCalledTimes(2);
  });

  it("refreshes the available server files on demand", async () => {
    listImportSources.mockResolvedValueOnce({ ok: true, sources: [] }).mockResolvedValueOnce({
      ok: true,
      sources: [{ id: "zmenu", label: "zMenu", files: [{ path: "new.yml", size: 10 }] }],
    });
    const user = userEvent.setup();

    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={vi.fn()}
      />,
    );

    expect(await screen.findByText(/aucune source d'import/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /actualiser/i }));
    expect(await screen.findByRole("checkbox", { name: /new\.yml/i })).toBeInTheDocument();
    expect(listImportSources).toHaveBeenLastCalledWith("n", "s", "p");
  });

  it("blocks a source whose listing exceeded the safe entry limit", async () => {
    listImportSources.mockResolvedValue({
      ok: true,
      sources: [{ id: "huge", label: "Huge menus", files: [], error: "too_many_entries" }],
    });

    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={vi.fn()}
      />,
    );

    expect(await screen.findByText(/trop d'entrées/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /joindre/i })).toBeDisabled();
  });

  it("filters nested files and retains their folder ancestor", async () => {
    listImportSources.mockResolvedValue({
      ok: true,
      sources: [
        {
          id: "zmenu",
          label: "zMenu",
          files: [
            { path: "categories/blocks.yml", size: 20 },
            { path: "categories/tools.yml", size: 30 },
          ],
        },
      ],
    });
    const user = userEvent.setup();

    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={vi.fn()}
      />,
    );

    await user.type(await screen.findByRole("textbox", { name: /rechercher/i }), "blocks");
    expect(screen.getByRole("checkbox", { name: /blocks\.yml/i })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /tools\.yml/i })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /categories/i })).toBeInTheDocument();
  });

  it("keeps independent selections when switching sources", async () => {
    listImportSources.mockResolvedValue({
      ok: true,
      sources: [
        { id: "zmenu", label: "zMenu", files: [{ path: "shop.yml", size: 10 }] },
        {
          id: "deluxe",
          label: "DeluxeMenus",
          files: [{ path: "kits.yml", size: 20 }],
        },
      ],
    });
    const user = userEvent.setup();
    const onAttach = vi.fn();

    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={onAttach}
      />,
    );

    await user.click(await screen.findByRole("checkbox", { name: /shop\.yml/i }));
    await user.click(screen.getByRole("button", { name: "DeluxeMenus" }));
    await user.click(screen.getByRole("checkbox", { name: /kits\.yml/i }));
    await user.click(screen.getByRole("button", { name: /joindre/i }));

    expect(onAttach).toHaveBeenCalledWith([
      {
        sourceId: "zmenu",
        label: "zMenu",
        files: [{ path: "shop.yml", size: 10 }],
      },
      {
        sourceId: "deluxe",
        label: "DeluxeMenus",
        files: [{ path: "kits.yml", size: 20 }],
      },
    ]);
  });

  it("prevents attaching a known selection over 200 files", async () => {
    listImportSources.mockResolvedValue({
      ok: true,
      sources: [
        {
          id: "zmenu",
          label: "zMenu",
          files: Array.from({ length: 201 }, (_, index) => ({
            path: `bulk/menu-${index}.yml`,
            size: 1,
          })),
        },
      ],
    });
    const user = userEvent.setup();

    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("checkbox", { name: /bulk/i }));
    expect(screen.getByText(/au maximum 200 fichiers/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /joindre/i })).toBeDisabled();
  });

  it("prevents attaching a known selection over 8 MiB", async () => {
    listImportSources.mockResolvedValue({
      ok: true,
      sources: [
        {
          id: "zmenu",
          label: "zMenu",
          files: [{ path: "large.yml", size: 8 * 1024 * 1024 + 1 }],
        },
      ],
    });
    const user = userEvent.setup();

    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("checkbox", { name: /large\.yml/i }));
    expect(screen.getByText(/8 mio/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /joindre/i })).toBeDisabled();
  });

  it("closes without attaching when cancelled", async () => {
    listImportSources.mockResolvedValue({ ok: true, sources: [] });
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onAttach = vi.fn();

    render(
      <ServerImportSourceDialog
        open
        onOpenChange={onOpenChange}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={onAttach}
      />,
    );

    await user.click(screen.getByRole("button", { name: /annuler/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onAttach).not.toHaveBeenCalled();
  });

  it("expands a folder from the keyboard and preserves focus", async () => {
    listImportSources.mockResolvedValue({
      ok: true,
      sources: [
        {
          id: "zmenu",
          label: "zMenu",
          files: [{ path: "categories/blocks.yml", size: 20 }],
        },
      ],
    });
    const user = userEvent.setup();

    render(
      <ServerImportSourceDialog
        open
        onOpenChange={vi.fn()}
        networkId="n"
        serverId="s"
        projectId="p"
        onAttach={vi.fn()}
      />,
    );

    const expand = await screen.findByRole("button", { name: /développer categories/i });
    expand.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("checkbox", { name: /blocks\.yml/i })).toBeInTheDocument();
    expect(expand).toHaveFocus();
  });
});
