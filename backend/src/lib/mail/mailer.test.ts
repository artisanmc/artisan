import { describe, expect, it, beforeEach } from "bun:test";
import { createMailerFromEnv, getMailer, sendSafely, __setMailerForTests, type MailMessage } from "./mailer";

describe("mailer", () => {
  beforeEach(() => __setMailerForTests(null));

  it("reports transport failure when delivery is required", async () => {
    const m = createMailerFromEnv({ SMTP_HOST: "127.0.0.1", SMTP_PORT: "1", SMTP_USER: "u", SMTP_PASS: "p", MAIL_FROM: "t@t.t" });
    await expect(m.send({ to: "a@b.c", subject: "s", text: "t" }, { throwOnError: true })).rejects.toThrow();
  });

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

describe("sendSafely", () => {
  beforeEach(() => __setMailerForTests(null));

  it("delivers the message via the current mailer", async () => {
    const sent: MailMessage[] = [];
    __setMailerForTests({ enabled: true, send: async (msg) => { sent.push(msg); } });
    sendSafely({ to: "x@y.z", subject: "hi", text: "body" });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
  });

  it("never throws when send() rejects asynchronously", () => {
    __setMailerForTests({ enabled: true, send: async () => { throw new Error("boom"); } });
    expect(() => sendSafely({ to: "x@y.z", subject: "hi", text: "body" })).not.toThrow();
  });

  it("never throws when the mailer's send() throws synchronously (not a promise)", () => {
    // A non-async send() that throws before ever returning a promise — the
    // bare `.catch()` chain can't protect against this, only a sync try/catch can.
    __setMailerForTests({
      enabled: true,
      send: (() => {
        throw new Error("sync boom");
      }) as unknown as (msg: MailMessage) => Promise<void>,
    });
    expect(() => sendSafely({ to: "x@y.z", subject: "hi", text: "body" })).not.toThrow();
  });
});
