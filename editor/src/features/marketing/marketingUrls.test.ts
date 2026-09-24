import { describe, expect, it } from "vitest";
import { editorHref } from "./marketingUrls";

describe("editorHref", () => {
  it("sends application links to the editor host in production", () => {
    expect(editorHref("/demo", "https://editor.artisanmc.net/")).toBe(
      "https://editor.artisanmc.net/demo",
    );
    expect(editorHref("/signup?next=%2Fpricing", "https://editor.artisanmc.net")).toBe(
      "https://editor.artisanmc.net/signup?next=%2Fpricing",
    );
  });

  it("keeps local development links relative", () => {
    expect(editorHref("/login", "")).toBe("/login");
  });
});
