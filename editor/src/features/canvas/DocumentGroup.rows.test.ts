import { describe, expect, it } from "vitest";
import { markerTexts } from "./DocumentGroup";
import { DOCUMENT_ITEMS, documentRowHeight } from "./menuLayout";

describe("a module Document's rows", () => {
  it("are tall as soon as one row has a caption", () => {
    expect(documentRowHeight([{}, {}])).toBe(DOCUMENT_ITEMS.row);
    expect(documentRowHeight([{}, { caption: "Break 64 stone" }])).toBe(DOCUMENT_ITEMS.tall);
  });

  it("draw ranks on the same number of digits, two at least", () => {
    const rows = (...m: string[]) => m.map((marker, i) => ({ id: String(i), label: "", marker }));
    expect(markerTexts(rows("1", "2"))).toEqual(["01", "02"]);
    expect(markerTexts(rows("9", "10", "100"))).toEqual(["009", "010", "100"]);
  });

  it("keep any other mark as given", () => {
    expect(
      markerTexts([
        { id: "a", label: "", marker: "A" },
        { id: "b", label: "" },
      ]),
    ).toEqual(["A", undefined]);
  });
});
