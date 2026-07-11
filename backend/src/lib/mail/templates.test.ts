import { describe, expect, it } from "bun:test";
import { welcomeEmail } from "./templates";

describe("welcomeEmail", () => {
  it("builds an english message by default", () => {
    const msg = welcomeEmail({ to: "iban@example.com", displayName: "Iban" });
    expect(msg.to).toBe("iban@example.com");
    expect(msg.subject).toBe("Welcome to Artisan");
    expect(msg.text).toContain("Iban");
    expect(msg.html).toContain("Iban");
  });

  it("builds french when asked", () => {
    const msg = welcomeEmail({ to: "a@b.c", displayName: "Iban", locale: "fr" });
    expect(msg.subject).toBe("Bienvenue sur Artisan");
  });

  it("escapes user-controlled values in the html part", () => {
    const msg = welcomeEmail({ to: "a@b.c", displayName: '<img src=x onerror="x">Iban' });
    expect(msg.html).not.toContain("<img");
    expect(msg.html).toContain("&lt;img");
    expect(msg.text).toContain('<img');
  });
});
