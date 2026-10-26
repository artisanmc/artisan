# Email validation — manual (requires a configured TEM domain)

User prerequisites: Scaleway project + validated TEM domain (SPF/DKIM/DMARC), SMTP credentials.

1. Fill in SMTP_HOST=smtp.tem.scw.cloud, SMTP_PORT=587, SMTP_USER, SMTP_PASS, MAIL_FROM in backend/.env.
2. `bun backend/scripts/send-test-email.ts <your address>` → mail received (check spam), correct FROM, html rendering.
3. fr variant: `... <address> fr`.
4. Real signup on the local editor → welcome mail received; signup with empty SMTP_* → nothing sent, no repeated WARN (a single one on the first attempt).
5. Coolify prod: add the env vars to the backend service before relying on it.
