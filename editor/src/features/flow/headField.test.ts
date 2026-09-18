import { describe, expect, it } from "vitest";
import { VIEWER_HEAD, buildHeadValue, headSourceOf, headValueOf } from "./headField";

describe("headSourceOf", () => {
  it("detects each prefix", () => {
    expect(headSourceOf("")).toBe("none");
    expect(headSourceOf("hdb:128276")).toBe("hdb");
    expect(headSourceOf("playerhead:Notch")).toBe("playerhead");
    expect(headSourceOf("basehead:eyJ0")).toBe("basehead");
    expect(headSourceOf("eyJ0ZXh0")).toBe("basehead"); // raw base64
  });
});

describe("headValueOf", () => {
  it("strips the prefix", () => {
    expect(headValueOf("hdb:128276")).toBe("128276");
    expect(headValueOf("playerhead:Notch")).toBe("Notch");
    expect(headValueOf("basehead:eyJ0")).toBe("eyJ0");
    expect(headValueOf("eyJ0")).toBe("eyJ0");
  });
});

describe("buildHeadValue", () => {
  it("VIEWER_HEAD is the canonical spelling of the viewing-player head", () => {
    expect(VIEWER_HEAD).toBe(buildHeadValue("playerhead", "{player.name}"));
    expect(headSourceOf(VIEWER_HEAD)).toBe("playerhead");
    expect(headValueOf(VIEWER_HEAD)).toBe("{player.name}");
  });
  it("prefixes by selected source", () => {
    expect(buildHeadValue("hdb", "128276")).toBe("hdb:128276");
    expect(buildHeadValue("playerhead", "Notch")).toBe("playerhead:Notch");
    expect(buildHeadValue("basehead", "abc")).toBe("basehead:abc");
  });
  it("re-detects pasted canonical values regardless of selected source", () => {
    expect(buildHeadValue("playerhead", "hdb:128276")).toBe("hdb:128276");
    expect(buildHeadValue("hdb", "eyJ0ZXh0")).toBe("basehead:eyJ0ZXh0");
  });
  it("empty input clears the value", () => {
    expect(buildHeadValue("hdb", "  ")).toBe("");
  });
});
