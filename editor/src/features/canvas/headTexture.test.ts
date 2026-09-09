import { describe, expect, it } from "vitest";
import { headPreviewUrl } from "./headTexture";

// {"textures":{"SKIN":{"url":"http://textures.minecraft.net/texture/20732e7fb4694c6777948d3bfa3d02b3d5c15ccb1ca2eace9dbc2d6283b41bf1"}}}
const B64 =
  "eyJ0ZXh0dXJlcyI6eyJTS0lOIjp7InVybCI6Imh0dHA6Ly90ZXh0dXJlcy5taW5lY3JhZnQubmV0L3RleHR1cmUvMjA3MzJlN2ZiNDY5NGM2Nzc3OTQ4ZDNiZmEzZDAyYjNkNWMxNWNjYjFjYTJlYWNlOWRiYzJkNjI4M2I0MWJmMSJ9fX0=";
const HASH = "20732e7fb4694c6777948d3bfa3d02b3d5c15ccb1ca2eace9dbc2d6283b41bf1";

describe("headPreviewUrl", () => {
  it("decodes basehead base64 to an mc-heads texture render", () => {
    expect(headPreviewUrl(`basehead:${B64}`)).toBe(`https://mc-heads.net/head/${HASH}`);
  });

  it("accepts raw base64 without prefix", () => {
    expect(headPreviewUrl(B64)).toBe(`https://mc-heads.net/head/${HASH}`);
  });

  it("renders literal player names via mc-heads", () => {
    expect(headPreviewUrl("playerhead:Notch")).toBe("https://mc-heads.net/head/Notch");
  });

  it("returns undefined for placeholder player names", () => {
    expect(headPreviewUrl("playerhead:%player%")).toBeUndefined();
    expect(headPreviewUrl("playerhead:{owner}")).toBeUndefined();
  });

  it("leaves HDB resolution to the server-backed preview hook", () => {
    expect(headPreviewUrl("hdb:128276")).toBeUndefined();
  });

  it("returns undefined for empty, invalid base64, and unknown values", () => {
    expect(headPreviewUrl(undefined)).toBeUndefined();
    expect(headPreviewUrl("")).toBeUndefined();
    expect(headPreviewUrl("basehead:%%%")).toBeUndefined();
    expect(headPreviewUrl("wat:1")).toBeUndefined();
  });
});
