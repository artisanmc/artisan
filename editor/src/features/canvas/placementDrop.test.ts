import { beforeEach, describe, expect, it } from "vitest";
import type { ElementId, MenuId, Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { usePaginationStore } from "@/state/paginationStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import { pinPlacementRow } from "./placementDrop";

const PID = "p1" as ProjectId;
const MID = "m1" as MenuId;
const EID = "e1" as ElementId;

function makeProject(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [
      {
        id: MID,
        projectId: PID,
        title: [],
        rows: 3,
        contextInputs: [{ kind: "sourceRef", name: "shops", ref: "shop:items" as never }],
        layers: [
          {
            id: "L1" as never,
            name: "l",
            elements: [
              {
                id: EID,
                positions: "0",
                appearances: [{ material: "{item.material}", count: 1, title: { key: "t" as never } }],
                places: { source: "shops", alias: "item", keyField: "id", placements: [] },
              },
            ],
          },
        ],
      } as never,
    ],
    commands: [],
    templates: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: { t: { en: "{item.name}" } } as Project["i18nKeys"],
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  } as Project;
}

function currentPlaces() {
  const el = useAccountStore
    .getState()
    .account.projects[0]!.menus[0]!.layers[0]!.elements[0]!;
  return el.places!;
}

beforeEach(() => {
  useAccountStore.setState({
    account: { id: "acc" as never, projects: [makeProject()], projectOrder: [PID] },
  } as never);
  useUiStore.setState({ activeLang: "en" } as never);
  usePaginationStore.setState({ pageByElement: {} } as never);
  useServerSnapshotsStore.setState({
    rowsByRef: { "shop:items": [{ id: "sword", material: "DIAMOND_SWORD", name: "Sword" }] },
  } as never);
});

describe("pinPlacementRow", () => {
  it("upserts a placement with the current page + a captured display cache", () => {
    usePaginationStore.getState().setPage(EID, 2);
    pinPlacementRow({ projectId: PID, menuId: MID, elementId: EID, key: "sword", position: 4 });

    const placements = currentPlaces().placements;
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ key: "sword", page: 2, position: 4 });
    // cachedDisplay snapshots the live-resolved appearance for offline render.
    expect(placements[0]!.cachedDisplay).toEqual({ name: "Sword", material: "DIAMOND_SWORD" });
  });

  it("re-pinning the same row moves it (upsert by key, single entry)", () => {
    useAccountStore.getState().setElementPlacement({
      projectId: PID,
      menuId: MID,
      elementId: EID,
      placement: { key: "sword", page: 0, position: 1 },
    });
    pinPlacementRow({ projectId: PID, menuId: MID, elementId: EID, key: "sword", position: 7 });

    const placements = currentPlaces().placements;
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ key: "sword", position: 7 });
  });

  it("is a no-op when the element is not in placement mode", () => {
    useAccountStore.getState().setElementPlaces({
      projectId: PID,
      menuId: MID,
      elementId: EID,
      places: undefined,
    });
    pinPlacementRow({ projectId: PID, menuId: MID, elementId: EID, key: "sword", position: 4 });
    expect(
      useAccountStore.getState().account.projects[0]!.menus[0]!.layers[0]!.elements[0]!.places,
    ).toBeUndefined();
  });
});
