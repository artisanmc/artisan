import type { Project } from "@/domain/types";
import type { ServerDataSource } from "@/lib/api/dataSources";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { registerModule } from "@artisan/editor-sdk";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearRegistry } from "../../../../packages/editor-sdk/src/contract/registry";
import { SourceOriginBadge } from "./SourceOriginBadge";

const project = {
  id: "p1",
  documents: { menu: [], command: [] },
  dataSources: [],
  i18nKeys: {},
  defaultLang: "en",
} as unknown as Project;

const declare = (ref: string, origin: ServerDataSource["origin"]) =>
  useServerDataSourcesStore.setState({
    sources: [{ ref, moduleId: "m", schema: [], schemaHint: null, origin }],
  });

describe("SourceOriginBadge", () => {
  afterEach(() => {
    clearRegistry();
    useServerSnapshotsStore.setState({ rowsByRef: {} });
    useServerDataSourcesStore.setState({ sources: [] });
  });

  it("says Draft when the module computes the rows from the draft", () => {
    registerModule({
      id: "boutique",
      displayName: "Boutique",
      schemaVersion: "boutique/v1",
      sidebar: { icon: () => null, label: "Boutique", to: "/m/boutique" },
      routes: [],
      localPreviewRows: (_p, ref) => (ref === "boutique:items" ? [{ id: "a" }] : null),
    });
    declare("boutique:items", "content");
    render(<SourceOriginBadge project={project} sourceRef="boutique:items" />);
    expect(screen.getByTestId("source-origin-draft")).toBeTruthy();
  });

  it("warns when a content source can only show the deployed version", () => {
    declare("quests:quests", "content");
    useServerSnapshotsStore.setState({ rowsByRef: { "quests:quests": [{ id: "q" }] } });
    render(<SourceOriginBadge project={project} sourceRef="quests:quests" />);
    expect(screen.getByTestId("source-origin-stale")).toBeTruthy();
  });

  it("shows the in-game state for a runtime source, or one an older plugin does not qualify", () => {
    declare("auctions:listings", null);
    useServerSnapshotsStore.setState({ rowsByRef: { "auctions:listings": [{ id: 1 }] } });
    render(<SourceOriginBadge project={project} sourceRef="auctions:listings" />);
    expect(screen.getByTestId("source-origin-live")).toBeTruthy();
  });

  it("shows nothing for a Project source or before any row is known", () => {
    const { container } = render(
      <>
        <SourceOriginBadge project={project} sourceRef="pack:ranks" />
        <SourceOriginBadge project={project} sourceRef="auctions:listings" />
      </>,
    );
    expect(container.textContent).toBe("");
  });
});
