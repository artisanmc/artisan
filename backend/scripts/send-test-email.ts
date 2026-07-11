#!/usr/bin/env bun
/**
 * Test script to send a real welcome email via configured SMTP.
 * Usage: bun backend/scripts/send-test-email.ts <adresse> [en|fr]
 *
 * Requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM in .env.
 * Fails loudly on SMTP error (unlike the prod Mailer which silently logs failures).
 */

import { createTransport } from "nodemailer";
import { welcomeEmail } from "../src/lib/mail/templates";

const to = process.argv[2];
if (!to) {
  console.error("Usage: bun backend/scripts/send-test-email.ts <adresse> [en|fr]");
  process.exit(1);
}

const locale = (process.argv[3] ?? "en") as "en" | "fr";
if (!["en", "fr"].includes(locale)) {
  console.error("Locale must be 'en' or 'fr'");
  process.exit(1);
}

// Check SMTP configuration
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_FROM) {
  console.error("SMTP_* not configured in .env (SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM required)");
  process.exit(1);
}

// Build nodemailer transport directly (option a: script is self-contained, doesn't swallow errors).
const transport = createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT) || 587,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

try {
  const msg = welcomeEmail({
    to,
    displayName: to.split("@")[0],
    locale,
  });

  await transport.sendMail({
    from: MAIL_FROM,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });

  console.log(`✓ Email sent to ${to} (locale: ${locale})`);
} catch (err) {
  console.error("✗ Failed to send email:", err);
  process.exit(1);
} finally {
  await transport.close();
}
