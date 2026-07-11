import { createTransport } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
  readonly enabled: boolean;
}

let warnedDisabled = false;

function disabledMailer(): Mailer {
  return {
    enabled: false,
    async send() {
      if (!warnedDisabled) {
        warnedDisabled = true;
        console.warn("mailer disabled — SMTP_* not configured");
      }
    },
  };
}

export function createMailerFromEnv(env: Record<string, string | undefined> = {}): Mailer {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_FROM) {
    return disabledMailer();
  }

  const transport = createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  return {
    enabled: true,
    async send(msg: MailMessage) {
      try {
        await transport.sendMail({
          from: MAIL_FROM,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        });
      } catch (err) {
        console.error("mailer: failed to send", err);
      }
    },
  };
}

let singleton: Mailer | null = null;
let testOverride: Mailer | null = null;

export function __setMailerForTests(m: Mailer | null): void {
  testOverride = m;
  singleton = null;
  warnedDisabled = false;
}

export function getMailer(): Mailer {
  if (testOverride) return testOverride;
  if (!singleton) singleton = createMailerFromEnv(process.env as Record<string, string | undefined>);
  return singleton;
}
