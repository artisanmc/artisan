import { expect, test } from "bun:test";
import { allowedWebOrigin } from "./webOrigins";

test("accepts the editor and marketing origins without reflecting strangers", () => {
  const allow = allowedWebOrigin("https://editor.artisanmc.net", "https://artisanmc.net");
  expect(allow("https://editor.artisanmc.net")).toBe("https://editor.artisanmc.net");
  expect(allow("https://artisanmc.net")).toBe("https://artisanmc.net");
  expect(allow("https://evil.example")).toBe("");
});
