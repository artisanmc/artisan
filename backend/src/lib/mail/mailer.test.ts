import { describe, expect, it, beforeEach } from "bun:test";
import { createMailerFromEnv, getMailer, __setMailerForTests, type MailMessage } from "./mailer";

describe("mailer", () => {
  beforeEach(() => __setMailerForTests(null));

  it("is disabled and no-ops when env is incomplete", async () => {
    const m = createMailerFromEnv({});
    expect(m.enabled).toBe(false);
    await m.send({ to: "a@b.c", subject: "s", text: "t" }); // ne throw pas
  });

  it("is enabled when all SMTP vars are present", () => {
    const m = createMailerFromEnv({
      SMTP_HOST: "smtp.tem.scw.cloud", SMTP_PORT: "587",
      SMTP_USER: "u", SMTP_PASS: "p", MAIL_FROM: "Artisan <no-reply@artisanmc.net>",
    });
    expect(m.enabled).toBe(true);
  });

  it("getMailer honors the test override", async () => {
    const sent: MailMessage[] = [];
    __setMailerForTests({ enabled: true, send: async (msg) => { sent.push(msg); } });
    await getMailer().send({ to: "x@y.z", subject: "hello", text: "body" });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("hello");
  });

  it("transport errors are swallowed and logged, never thrown", async () => {
    // mailer enabled pointant vers un host invalide → send résout sans throw
    const m = createMailerFromEnv({
      SMTP_HOST: "127.0.0.1", SMTP_PORT: "1",
      SMTP_USER: "u", SMTP_PASS: "p", MAIL_FROM: "t@t.t",
    });
    await m.send({ to: "a@b.c", subject: "s", text: "t" }); // catch interne
  });
});
