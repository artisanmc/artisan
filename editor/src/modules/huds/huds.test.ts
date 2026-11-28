import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import countdown from "../../../../docs/schema/hud/v1/examples/countdown.json";
import profile from "../../../../docs/schema/hud/v1/examples/profile.json";
import hudSchema from "../../../../docs/schema/hud/v1/schema.json";
import menuSchema from "../../../../docs/schema/menu/v1/schema.json";
import {
  DEFAULT_REFRESH,
  type Hud,
  hudFromFile,
  hudPackImages,
  hudPreview,
  hudToFile,
  lifetimeOf,
  nextTextName,
  readRefresh,
} from "./hud";

const opts = { projectId: "survie", lang: "fr" };

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(menuSchema);
const validate = ajv.compile(hudSchema);

describe("the hud/v1 examples", () => {
  it.each([
    ["profile", profile],
    ["countdown", countdown],
  ])("reads %s back and rewrites it identically, valid", (_, example) => {
    const { doc, unsupported } = hudFromFile({ id: "x", ...example }, opts);
    expect(unsupported).toEqual([]);
    const { id, ...written } = hudToFile(doc);
    expect(id).toBe("x");
    expect(written).toEqual(example);
    expect(validate(written), JSON.stringify(validate.errors)).toBe(true);
  });

  it("validates a HUD with conditions", () => {
    const hud = hudFromFile({ id: "q", when: [{ has_var: "season" }] }, opts).doc;
    expect(hud.conditions.length).toBe(1);
    const { id, ...written } = hudToFile(hud);
    expect(written.when).toEqual([{ has_var: "season" }]);
    expect(validate(written), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe("hud/v1", () => {
  it("reads a file and writes it back as it was", () => {
    const src = {
      schema: "hud/v1",
      id: "profile",
      slot: "action_bar",
      priority: 120,
      refresh: 100,
      layout: [
        { image: "panel", x: -60, y: 0 },
        { text: "name", x: -50, y: 4, width: 100 },
      ],
      texts: { name: "<b>{player}</b>" },
      notes: "kept",
    };
    const { doc, unsupported } = hudFromFile(src, opts);
    expect(unsupported).toEqual([]);
    expect(doc.slot).toBe("action_bar");
    expect(lifetimeOf(doc)).toBe("permanent");
    expect(hudToFile(doc)).toEqual(src);
  });

  it("leaves out the defaults, drops the texts of no layer", () => {
    const { doc } = hudFromFile(
      { id: "h", layout: [{ text: "a", width: 50 }], texts: { a: "x", gone: "y" } },
      opts,
    );
    expect(hudToFile(doc)).toEqual({
      schema: "hud/v1",
      id: "h",
      layout: [{ text: "a", width: 50 }],
      texts: { a: "x" },
    });
  });

  it("a disabled HUD is temporary; refresh is read as the server reads it", () => {
    expect(lifetimeOf(hudFromFile({ id: "t", enabled: false }, opts).doc)).toBe("temporary");
    expect(readRefresh(undefined)).toBe(DEFAULT_REFRESH);
    expect(readRefresh(0)).toBe(0);
    expect(readRefresh(1)).toBe(5);
    expect(readRefresh("99999")).toBe(1200);
    expect(readRefresh("soon")).toBe(DEFAULT_REFRESH);
  });

  it("names a list layer unsupported", () => {
    const { unsupported } = hudFromFile(
      { id: "h", layout: [{ list: "rows", width: 80, lines: 3 }] },
      opts,
    );
    expect(unsupported).toEqual(["layout: list rows"]);
  });

  it("asks the pack for each image layer, as Hud.packImages", () => {
    // Same case as HudTest's `pack images`.
    expect(
      hudPackImages({
        layout: [
          { image: "panel", x: -60, y: 2 },
          { text: "name", width: 100 },
          { image: "coin", x: 10, y: -4 },
        ],
      }),
    ).toEqual([
      { asset: "panel", rise: -2 },
      { asset: "coin", rise: 4 },
    ]);
  });

  it("previews each text with the catalog's samples, the others as written", () => {
    const hud = hudFromFile(
      { id: "h", layout: [{ text: "a", width: 80 }], texts: { a: "{player} {var.money}" } },
      opts,
    ).doc as Hud;
    const preview = hudPreview(hud, [
      { path: "player", type: "player", sample: "Steve", origin: "context" },
      { path: "var.money", type: "number", sample: null, origin: "context" },
    ]);
    expect(preview.text).toEqual({ a: "Steve {var.money}" });
  });

  it("names a new text layer after the existing ones", () => {
    expect(nextTextName([{ text: "text_1", width: 10 }])).toBe("text_2");
    expect(nextTextName([])).toBe("text_1");
  });
});
