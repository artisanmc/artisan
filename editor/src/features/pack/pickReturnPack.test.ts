import { describe, expect, it } from "vitest";
import { pickReturnPack } from "./pickReturnPack";

const packs = [{ id: "pack_a" }, { id: "pack_b" }, { id: "pack_c" }];

describe("pickReturnPack", () => {
  it("returns the last-active pack when it is among the session packs", () => {
    // The bug: a reload landed on packs[0] instead of where you were.
    expect(pickReturnPack(packs, "pack_c")).toEqual({ id: "pack_c" });
    expect(pickReturnPack(packs, "pack_b")).toEqual({ id: "pack_b" });
  });

  it("falls back to the first pack when lastActivePackId is not in the list", () => {
    expect(pickReturnPack(packs, "pack_from_another_server")).toEqual({ id: "pack_a" });
  });

  it("falls back to the first pack when no lastActivePackId is recorded", () => {
    expect(pickReturnPack(packs, null)).toEqual({ id: "pack_a" });
  });

  it("returns undefined when there are no packs", () => {
    expect(pickReturnPack([], "pack_a")).toBeUndefined();
    expect(pickReturnPack([], null)).toBeUndefined();
  });
});
