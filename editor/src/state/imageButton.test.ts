import { elementId, type menuId, projectId } from "@/domain/ids";
import { dropImageButton } from "@/features/canvas/imageButtonDrop";
import { setStageSlotHitTest } from "@/features/canvas/stageDropTarget";
import { mockAccount } from "@/mock/fixtures";
import { beforeEach, expect, it } from "vitest";
import { useAccountStore } from "./accountStore";

const p = projectId("p_personal");
let m: ReturnType<typeof menuId>;
const e = elementId("image");
const target = () => ({ projectId: p, menuId: m, elementId: e });
const current = () =>
  useAccountStore
    .getState()
    .account.projects.find((project) => project.id === p)!
    .menus.find((menu) => menu.id === m)!;
beforeEach(() => {
  useAccountStore.setState({ account: mockAccount() });
  m = useAccountStore.getState().createMenu({ projectId: p, id: "images" });
  useAccountStore.setState((state) => ({
    account: {
      ...state.account,
      projects: state.account.projects.map((project) =>
        project.id !== p
          ? project
          : {
              ...project,
              menus: project.menus.map((menu) =>
                menu.id !== m
                  ? menu
                  : {
                      ...menu,
                      rows: 3,
                      layers: [
                        {
                          id: "main" as never,
                          name: "main",
                          elements: [
                            { id: e, positions: "0", display: { material: "STONE" }, states: [] },
                            {
                              id: elementId("other"),
                              positions: "8",
                              display: { material: "DIAMOND" },
                              states: [],
                            },
                          ],
                        },
                      ],
                    },
              ),
            },
      ),
    },
  }));
});

it("changes the appearance to an image, resizes and moves the entire rectangle", () => {
  const store = useAccountStore.getState();
  store.setAppearanceImage({ ...target(), image: { asset: "buy", fit: "contain" } });
  store.setElementPositions({ ...target(), positions: "0-2,9-11" });
  store.moveElementPosition({ ...target(), fromPosition: 1, toPosition: 2 });
  expect(current().layers[0]!.elements[0]).toMatchObject({
    positions: "1-3,10-12",
    display: { image: { asset: "buy" } },
  });
  expect(current().layers[0]!.elements[0]!.display.material).toBeUndefined();
});

it("rejects collisions and nonrectangular edits without changing either element", () => {
  const store = useAccountStore.getState();
  store.setAppearanceImage({ ...target(), image: { asset: "buy" } });
  const before = structuredClone(current());
  expect(() => store.setElementPositions({ ...target(), positions: "7-8" })).toThrow();
  expect(() => store.setElementPositions({ ...target(), positions: "0,2" })).toThrow();
  expect(current()).toEqual(before);
});

it("creates a correctly sized image button directly and refuses an occupied rectangle atomically", () => {
  const store = useAccountStore.getState();
  store.addImageButton({
    projectId: p,
    menuId: m,
    position: 1,
    asset: { id: "tall", width: 16, height: 48 },
  });
  expect(current().layers[0]!.elements.at(-1)).toMatchObject({
    positions: "1,10,19",
    display: { image: { asset: "tall", fit: "native" } },
    states: [],
  });
  const before = structuredClone(current());
  expect(() =>
    store.addImageButton({
      projectId: p,
      menuId: m,
      position: 6,
      asset: { id: "wide", width: 48, height: 16 },
    }),
  ).toThrow();
  expect(() =>
    store.addImageButton({
      projectId: p,
      menuId: m,
      position: 20,
      asset: { id: "tall", width: 16, height: 48 },
    }),
  ).toThrow();
  expect(current()).toEqual(before);
});

it("drops an image on the resolved slot, selects it and does nothing outside a menu", () => {
  const asset = { id: "wide", projectId: p, width: 48, height: 16 };
  setStageSlotHitTest((x, y) => (x === 50 && y === 60 ? { menuId: m, position: 2 } : null));
  try {
    expect(dropImageButton(p, asset, 0, 0)).toBe(false);
    expect(current().layers[0]!.elements).toHaveLength(2);
    expect(dropImageButton(p, asset, 50, 60)).toBe(true);
    expect(current().layers[0]!.elements.at(-1)).toMatchObject({
      positions: "2-4",
      display: { image: { asset: "wide", fit: "native" } },
    });
  } finally {
    setStageSlotHitTest(null);
  }
});

it("converts and resizes together, and preserves the old item when its image area is occupied", () => {
  const store = useAccountStore.getState();
  const before = structuredClone(current());
  expect(() =>
    store.setAppearanceImage({
      ...target(),
      image: { asset: "wide", fit: "native" },
      positions: "0-8",
    }),
  ).toThrow();
  expect(current()).toEqual(before);
  store.setAppearanceImage({
    ...target(),
    image: { asset: "tall", fit: "native" },
    positions: "0,9,18",
  });
  expect(current().layers[0]!.elements[0]).toMatchObject({
    positions: "0,9,18",
    display: { image: { asset: "tall" } },
  });
});
