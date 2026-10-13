import "@/i18n"; // initialise the default react-i18next instance for useTranslation
import * as api from "@/lib/api/networks";
import type { ServerStatusEntry } from "@/lib/api/networks";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinkedServersDropdown, ServerRow, relTime } from "./LinkedServersDropdown";

vi.mock("@/lib/api/networks");

// Stub t: echo interpolation values so assertions don't depend on locale text.
const t = ((k: string, o?: Record<string, unknown>) =>
  o?.when !== undefined
    ? `Last seen ${o.when}`
    : o?.count !== undefined
      ? `x${o.count}`
      : k) as unknown as Parameters<typeof ServerRow>[0]["t"];

function entry(over: Partial<ServerStatusEntry>): ServerStatusEntry {
  return {
    id: "sk",
    label: "Srv",
    online: false,
    lastMcVersion: null,
    lastSeenAt: null,
    lastSeenIp: null,
    isCurrent: false,
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
  it("online row shows IP and version", () => {
    render(
      <ServerRow
        s={entry({
          id: "b",
          label: "Lobby",
          online: true,
          lastMcVersion: "1.21.4",
          lastSeenIp: "1.2.3.5",
        })}
        lang="en"
        t={t}
      />,
    );
    expect(screen.getByText(/Lobby/)).toBeInTheDocument();
    expect(screen.getByText(/1\.2\.3\.5/)).toBeInTheDocument();
    expect(screen.getByText(/1\.21\.4/)).toBeInTheDocument();
    // Plus de multiplicateur d'instances : une clé = un serveur vivant, le
    // backend évince l'ancienne connexion (ADR `server-disk-only-storage`).
    expect(screen.queryByText(/x2/)).toBeNull();
  });

  it("offline row with a last hello shows last-seen + last IP", () => {
    const iso = new Date(Date.now() - 2 * 3_600_000).toISOString();
    render(
      <ServerRow
        s={entry({
          id: "a",
          label: "Survival",
          online: false,
          lastSeenAt: iso,
          lastSeenIp: "1.2.3.4",
        })}
        lang="en"
        t={t}
      />,
    );
    expect(screen.getByText(/Last seen/)).toBeInTheDocument();
    expect(screen.getByText(/1\.2\.3\.4/)).toBeInTheDocument();
  });

  it("never-connected row shows the never-connected label and no IP", () => {
    render(<ServerRow s={entry({ id: "c", label: "Events" })} lang="en" t={t} />);
    expect(screen.getByText("linkedServers.neverConnected")).toBeInTheDocument();
  });

  it("a server the hub flags updateRequired says so instead of the outdated hint", () => {
    render(<ServerRow s={entry({ online: true, updateRequired: true })} lang="en" t={t} />);
    expect(screen.getByText("linkedServers.updateRequired")).toBeInTheDocument();
    expect(screen.queryByText("linkedServers.pluginOutdated")).toBeNull();
  });
});

describe("ServerRow — mise à jour du plugin en attente", () => {
  it("n'offre rien de plus quand la mise à jour attend le redémarrage", () => {
    render(<ServerRow s={entry({ online: true, pluginUpdatePending: "1.0.4" })} lang="en" t={t} />);
    expect(screen.getByText("linkedServers.pluginUpdatePending")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("LinkedServersDropdown", () => {
  beforeEach(() => vi.clearAllMocks());

  // Le déclencheur parle du serveur qui PORTE le project ouvert : son disque
  // conditionne tout (ADR `server-disk-only-storage`). L'agrégat réseau pouvait
  // afficher « 2/3 » pendant que ce serveur-là était justement celui qui manquait.
  it("annonce l'état du serveur courant, pas l'agrégat du réseau", async () => {
    vi.mocked(api.getNetworkServersStatus).mockResolvedValue({
      online: 2,
      total: 3,
      servers: [
        entry({ id: "a", online: false, isCurrent: true }),
        entry({ id: "b", online: true }),
        entry({ id: "c", online: true }),
      ],
    });
    render(<LinkedServersDropdown networkId="net1" currentServerKeyId="a" />);

    expect(await screen.findByText(/Offline|Hors ligne/)).toBeInTheDocument();
    expect(screen.queryByText("2/3")).toBeNull();
    expect(api.getNetworkServersStatus).toHaveBeenCalledWith("net1", "a");
  });

  it("retombe sur l'agrégat quand aucun serveur courant n'est en portée", async () => {
    vi.mocked(api.getNetworkServersStatus).mockResolvedValue({
      online: 2,
      total: 3,
      servers: [entry({ id: "b", online: true }), entry({ id: "c", online: true })],
    });
    render(<LinkedServersDropdown networkId="net1" />);
    expect(await screen.findByText("2/3")).toBeInTheDocument();
  });

  // Le hors-ligne n'est plus un bandeau : c'est le badge qui le porte, et son
  // infobulle qui donne la raison exacte (date de la copie, brouillon, jamais publié).
  it("explique le hors-ligne du serveur courant en infobulle sur le badge", async () => {
    vi.mocked(api.getNetworkServersStatus).mockResolvedValue({
      online: 0,
      total: 1,
      servers: [entry({ id: "a", online: false, isCurrent: true })],
    });
    render(
      <LinkedServersDropdown
        networkId="net1"
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

  it("annonce « mise à jour requise » pour un serveur courant incompatible", async () => {
    vi.mocked(api.getNetworkServersStatus).mockResolvedValue({
      online: 1,
      total: 1,
      servers: [entry({ id: "lobby", online: true, isCurrent: true, updateRequired: true })],
    });
    render(<LinkedServersDropdown networkId="local" currentServerKeyId="lobby" />);
    expect(await screen.findByText(/Update required|Mise à jour requise/)).toBeInTheDocument();
  });

  it("renders nothing without a networkId", () => {
    const { container } = render(<LinkedServersDropdown networkId={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
