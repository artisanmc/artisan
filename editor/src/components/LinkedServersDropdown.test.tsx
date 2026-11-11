import "@/i18n";
import * as api from "@/lib/api/servers";
import type { ServerSummary } from "@/lib/api/servers";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinkedServersDropdown, ServerRow, relTime } from "./LinkedServersDropdown";

vi.mock("@/lib/api/servers");

// Stub t: echo interpolation values so assertions don't depend on locale text.
const t = ((k: string, o?: Record<string, unknown>) =>
  o?.when !== undefined
    ? `Last seen ${o.when}`
    : o?.count !== undefined
      ? `x${o.count}`
      : k) as unknown as Parameters<typeof ServerRow>[0]["t"];

function entry(over: Partial<ServerSummary>): ServerSummary {
  return {
    id: "sk",
    label: "Srv",
    online: false,
    minecraftVersion: null,
    lastSeenAt: null,
    ...over,
  };
}

describe("relTime", () => {
  it("formats recent minutes", () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relTime(iso, "en")).toMatch(/min/i);
  });
  it("formats hours", () => {
    const iso = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(relTime(iso, "en")).toMatch(/hour|hr/i);
  });
});

describe("ServerRow", () => {
  it("online row shows the Minecraft version", () => {
    render(
      <ServerRow
        s={entry({ id: "b", label: "Lobby", online: true, minecraftVersion: "1.21.4" })}
        lang="en"
        t={t}
      />,
    );
    expect(screen.getByText(/Lobby/)).toBeInTheDocument();
    expect(screen.getByText(/1\.21\.4/)).toBeInTheDocument();
  });

  it("offline row with a last hello shows last-seen", () => {
    const iso = new Date(Date.now() - 2 * 3_600_000).toISOString();
    render(
      <ServerRow
        s={entry({ id: "a", label: "Survival", online: false, lastSeenAt: iso })}
        lang="en"
        t={t}
      />,
    );
    expect(screen.getByText(/Last seen/)).toBeInTheDocument();
  });

  it("never-connected row shows the never-connected label", () => {
    render(<ServerRow s={entry({ id: "c", label: "Events" })} lang="en" t={t} />);
    expect(screen.getByText("linkedServers.neverConnected")).toBeInTheDocument();
  });

  it("a server the hub flags updateRequired says so", () => {
    render(<ServerRow s={entry({ online: true, updateRequired: true })} lang="en" t={t} />);
    expect(screen.getByText("linkedServers.updateRequired")).toBeInTheDocument();
  });
});

describe("LinkedServersDropdown", () => {
  beforeEach(() => vi.clearAllMocks());

  // The trigger describes the server that HOLDS the open project: its disk
  // conditions everything (ADR `server-disk-only-storage`). The hub aggregate
  // could show "2/3" while this very server was the missing one.
  it("announces the current server's state, not the aggregate", async () => {
    vi.mocked(api.listServers).mockResolvedValue([
      entry({ id: "a", online: false }),
      entry({ id: "b", online: true }),
      entry({ id: "c", online: true }),
    ]);
    render(<LinkedServersDropdown currentServerKeyId="a" />);

    expect(await screen.findByText(/Offline|Hors ligne/)).toBeInTheDocument();
    expect(screen.queryByText("2/3")).toBeNull();
  });

  it("falls back to the aggregate when no current server is in scope", async () => {
    vi.mocked(api.listServers).mockResolvedValue([
      entry({ id: "a", online: false }),
      entry({ id: "b", online: true }),
      entry({ id: "c", online: true }),
    ]);
    render(<LinkedServersDropdown />);
    expect(await screen.findByText("2/3")).toBeInTheDocument();
  });

  // Offline is not a banner: the badge carries it, with a tooltip giving the
  // exact reason (copy date, draft, never published).
  it("explains the current server's offline state in a tooltip on the badge", async () => {
    vi.mocked(api.listServers).mockResolvedValue([entry({ id: "a", online: false })]);
    render(
      <LinkedServersDropdown
        currentServerKeyId="a"
        downHint="Serveur hors ligne — version du 01/10/2026. Ton brouillon reste modifiable."
      />,
    );
    const trigger = await screen.findByRole("button", { name: /Serveurs liés/ });
    fireEvent.focus(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /Serveur hors ligne — version du 01\/10\/2026/,
    );
  });

  it("announces 'update required' for an incompatible current server", async () => {
    vi.mocked(api.listServers).mockResolvedValue([
      entry({ id: "lobby", online: true, updateRequired: true }),
    ]);
    render(<LinkedServersDropdown currentServerKeyId="lobby" />);
    expect(await screen.findByText(/Update required|Mise à jour requise/)).toBeInTheDocument();
  });

  it("renders nothing while the hub has not answered", () => {
    vi.mocked(api.listServers).mockReturnValue(new Promise(() => {}));
    const { container } = render(<LinkedServersDropdown />);
    expect(container).toBeEmptyDOMElement();
  });
});
