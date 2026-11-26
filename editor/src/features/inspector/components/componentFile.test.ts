import type { Project } from "@/domain/types";
import { expect, it } from "vitest";
import {
  componentUses,
  editComponentParts,
  partText,
  partsLook,
  projectComponents,
  readComponent,
  setComponentParam,
} from "./componentFile";

const file = readComponent(
  'params:\n  text: { type: text, default: OK }\nparts:\n  - image: button\n  - label: "{text}"\n    anchor: right\n  - label: { en: Buy, fr: Acheter }\n',
);

it("reads the Project's components by name, an unreadable one as empty", () => {
  const project = {
    moduleData: {
      components: { __files: { "a.yml": "parts: []", "b.yaml": ": :", "x/c.yml": "" } },
    },
  } as unknown as Project;
  expect(Object.keys(projectComponents(project))).toEqual(["a", "b"]);
  expect(readComponent(": :")).toEqual({});
  expect(projectComponents(undefined)).toEqual({});
});

it("shows a file's parts as a look of pieces, its texts read by their place", () => {
  const look = partsLook(file);
  expect(look.parts).toHaveLength(3);
  expect(look.parts![0]).toEqual({ image: "button" });
  const second = look.parts![1] as { label: { key: string }; anchor: string };
  expect(second.anchor).toBe("right");
  expect(partText(file, second.label as never, "en")).toBe("{text}");
  const third = look.parts![2] as { label: { key: string } };
  expect(partText(file, third.label as never, "fr")).toBe("Acheter");
});

it("edits the parts as the panel of a button's pieces asks", () => {
  let next = editComponentParts(file, { type: "addImage", asset: "coin" }, "en");
  next = editComponentParts(next, { type: "patch", index: 3, patch: { anchor: "left" } }, "en");
  next = editComponentParts(next, { type: "move", index: 3, to: 1 }, "en");
  next = editComponentParts(next, { type: "text", index: 3, lang: "fr", value: "Payer" }, "fr");
  next = editComponentParts(next, { type: "patch", index: 2, patch: { anchor: undefined } }, "en");
  next = editComponentParts(next, { type: "addLabel", lang: "en" }, "en");
  expect(next.parts).toEqual([
    { image: "button" },
    { image: "coin", anchor: "left" },
    { label: "{text}" },
    { label: { en: "Buy", fr: "Payer" } },
    { label: "" },
  ]);
  expect(editComponentParts(next, { type: "remove", index: 0 }, "en").parts).toHaveLength(4);
  expect(next.params).toEqual(file.params);
});

it("declares, changes and removes a parameter", () => {
  const added = setComponentParam(file, "icon", { type: "image", default: "check" });
  expect(added.params).toEqual({
    text: { type: "text", default: "OK" },
    icon: { type: "image", default: "check" },
  });
  expect(setComponentParam(added, "icon", { type: "image", default: "" }).params!.icon).toEqual({
    type: "image",
  });
  const none = setComponentParam(setComponentParam(added, "icon", null), "text", null);
  expect(none).not.toHaveProperty("params");
  expect(none.parts).toEqual(file.parts);
});

it("lists the buttons that name a component, by its bare name or the module's", () => {
  const element = (id: string, display: unknown, states: unknown[] = []) => ({
    id,
    positions: "0",
    display,
    states,
  });
  const project = {
    id: "p",
    diskId: "shop",
    documents: {
      menu: [
        {
          id: "main",
          layers: [
            {
              elements: [
                element("a", { component: "confirm" }),
                element("b", { material: "STONE" }, [{ component: { name: "shop:confirm" } }]),
                element("c", { component: "artisan:confirm" }),
                element("d", { component: "other" }),
              ],
            },
          ],
        },
      ],
    },
  } as unknown as Project;
  expect(componentUses(project, "confirm")).toEqual([
    { menuId: "main", elementId: "a" },
    { menuId: "main", elementId: "b" },
  ]);
});
