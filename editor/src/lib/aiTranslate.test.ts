import type { I18nKey, Project } from "@/domain/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type MissingText, batches, missingTexts, translateMissing } from "./aiTranslate";

const api = vi.hoisted(() => ({ translateTexts: vi.fn() }));
vi.mock("@/lib/api/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/ai")>()),
  translateTexts: api.translateTexts,
}));

const k = (key: string) => key as I18nKey;

function project(i18nKeys: Project["i18nKeys"]): Project {
  return { id: "u-local.shop", defaultLang: "fr", i18nKeys } as unknown as Project;
}

describe("the texts to translate", () => {
  it("lists each text with the languages it lacks, neutral and blank sources left out", () => {
    const p = project({
      [k("title")]: { fr: "Boutique", en: "Shop", es: "" },
      [k("back")]: { fr: "Retour" },
      [k("price")]: { fr: "{price} $" },
      [k("blank")]: { fr: "", en: "" },
      [k("done")]: { fr: "Fini", en: "Done", es: "Hecho" },
    });
    expect(
      missingTexts(p, undefined, (key) => (key === "back" ? "menus/shop.yml" : undefined)),
    ).toEqual([
      { id: "title", text: "Boutique", langs: ["es"] },
      { id: "back", text: "Retour", langs: ["en", "es"], context: "menus/shop.yml" },
    ]);
    expect(missingTexts(p, ["en"]).map((t) => t.id)).toEqual(["back"]);
  });

  it("groups the texts by the languages they lack, within the hub's limits", () => {
    const texts: MissingText[] = [
      { id: "a", text: "x".repeat(5000), langs: ["en", "es"] },
      { id: "b", text: "y".repeat(3500), langs: ["es", "en"] },
      { id: "c", text: "z", langs: ["en"] },
      { id: "d", text: "w".repeat(3000), langs: ["en"] },
      ...Array.from({ length: 120 }, (_, i) => ({ id: `n${i}`, text: "ok", langs: ["en"] })),
    ];
    const calls = batches(texts);
    // "a" is longer than the hub takes; texts lacking the same languages travel together.
    expect(calls.map((c) => [c.targets.join(","), c.texts.length])).toEqual([
      ["en,es", 1],
      ["en", 100],
      ["en", 22],
    ]);
    expect(calls[0]?.texts[0]).toEqual({ id: "b", text: "y".repeat(3500) });
  });
});

describe("translating the missing ones", () => {
  beforeEach(() => api.translateTexts.mockReset());

  it("writes each translation that came back and counts the rest", async () => {
    api.translateTexts.mockResolvedValue({
      translations: { back: { en: "Back" } },
      failed: ["back"],
      inputTokens: 1,
      outputTokens: 1,
    });
    const written: string[] = [];
    const progress: [number, number][] = [];
    const outcome = await translateMissing(
      [{ id: "back", text: "Retour", langs: ["en", "es"], context: "menus/shop.yml" }],
      "fr",
      (id, lang, value) => written.push(`${id}.${lang}=${value}`),
      { module: "u-local.shop", onProgress: (done, total) => progress.push([done, total]) },
    );
    expect(api.translateTexts).toHaveBeenCalledWith({
      source: "fr",
      targets: ["en", "es"],
      texts: [{ id: "back", text: "Retour", context: "menus/shop.yml" }],
      module: "u-local.shop",
    });
    expect(written).toEqual(["back.en=Back"]);
    expect(outcome).toEqual({ written: 1, failed: 1 });
    expect(progress).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });
});
