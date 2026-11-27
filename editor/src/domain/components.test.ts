import { packComponents } from "@/lib/pack/components";
import { afterEach, expect, it } from "vitest";
import { choiceNames, componentLook, componentParams, setComponents } from "./components";
import { appearanceImages, appearanceLabels, elementLabels } from "./imageButton";
import type { Appearance, Menu } from "./types";

afterEach(() => setComponents(new Map()));

const feed = () => {
  const expandOf = packComponents([
    {
      folder: "shop",
      files: [
        {
          path: "components/price.yml",
          content:
            'params:\n  amount: { type: text, default: "0" }\nparts:\n  - image: tag\n  - label: "{amount} $"\n    anchor: right\n',
        },
      ],
    },
    {
      folder: "artisan",
      files: [
        {
          path: "originals/components/confirm.yml",
          content:
            'params:\n  text: { type: text, default: OK }\nparts:\n  - image: button.3x1\n  - label: "{text}"\n',
        },
      ],
    },
  ]);
  setComponents(new Map([["p1", { folder: "shop", expand: expandOf("shop"), list: [] }]]));
};

it("draws a look's component as its parts, its own images named without their module", () => {
  feed();
  const price = { component: { name: "price", amount: 12 } } as Appearance;
  expect(appearanceImages(price, "p1")).toEqual([{ asset: "tag", fit: "native" }]);
  expect(appearanceLabels(price, "p1")).toMatchObject([{ literal: "12 $", align: "right" }]);
  const confirm = { component: { name: "confirm", text: { en: "Buy", fr: "Acheter" } } };
  expect(appearanceImages(confirm as Appearance, "p1")).toEqual([
    { asset: "artisan:button.3x1", fit: "native" },
  ]);
  expect(appearanceLabels(confirm as Appearance, "p1")[0]?.literal).toEqual({
    en: "Buy",
    fr: "Acheter",
  });
});

it("draws nothing for a component nothing answers, or a Project it does not know", () => {
  feed();
  expect(componentLook({ component: "nowhere" } as Appearance, "p1")).toBeNull();
  expect(appearanceImages({ component: "price" } as Appearance, "p2")).toEqual([]);
  expect(appearanceImages({ component: "price" } as Appearance)).toEqual([]);
});

it("places a component's text over its element as a label", () => {
  feed();
  const menu = {
    id: "m",
    projectId: "p1",
    rows: 3,
    title: [],
    layers: [
      {
        elements: [{ id: "buy", positions: "0-2", display: { component: "confirm" }, states: [] }],
      },
    ],
  } as unknown as Menu;
  expect(elementLabels(menu)).toMatchObject([
    { elementId: "buy", layer: { kind: "textarea", literal: "OK", alignment: "center" } },
  ]);
});

it("reads a component's parameters, a choice with the names it offers", () => {
  expect(
    componentParams({
      params: {
        text: { type: "text", default: "OK" },
        color: { type: "choice", default: "green", values: { green: "a", red: "b" } },
        size: { type: "choice", values: ["small", 3, "large"] },
        icon: { type: "image" },
        odd: null,
      },
    }),
  ).toEqual([
    { name: "text", type: "text", default: "OK" },
    { name: "color", type: "choice", default: "green", values: ["green", "red"] },
    { name: "size", type: "choice", values: ["small", "large"] },
    { name: "icon", type: "image" },
    { name: "odd", type: "text" },
  ]);
  expect(choiceNames(undefined)).toEqual([]);
});
