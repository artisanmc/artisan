import { describe, expect, it } from "bun:test";
import { inviteEmail, welcomeEmail } from "./templates";

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

describe("inviteEmail", () => {
  const base = {
    to: "invitee@example.com",
    networkName: "My Network",
    inviterName: "Iban",
    url: "https://editor.artisanmc.net/invite?code=ABCD1234",
  };

  it("builds an english message by default with the exact subject", () => {
    const msg = inviteEmail(base);
    expect(msg.to).toBe("invitee@example.com");
    expect(msg.subject).toBe("You're invited to join My Network on Artisan");
    expect(msg.text).toContain(base.url);
    expect(msg.html).toContain(base.url);
  });

  it("builds french when asked with the exact subject", () => {
    const msg = inviteEmail({ ...base, locale: "fr" });
    expect(msg.subject).toBe("Invitation à rejoindre My Network sur Artisan");
  });

  it("escapes user-controlled networkName/inviterName in html, raw in text", () => {
    const msg = inviteEmail({
      ...base,
      networkName: "<x>Evil</x>",
      inviterName: "<y>Bad</y>",
    });
    expect(msg.html).not.toContain("<x>");
    expect(msg.html).toContain("&lt;x&gt;");
    expect(msg.html).not.toContain("<y>");
    expect(msg.html).toContain("&lt;y&gt;");
    expect(msg.text).toContain("<x>Evil</x>");
    expect(msg.text).toContain("<y>Bad</y>");
  });
});
