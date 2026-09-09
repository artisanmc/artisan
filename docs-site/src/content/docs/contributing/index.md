---
title: Contributing
description: Architecture and development guide for contributors and forkers.
---

The contributing guide is under construction.

Sections planned:
- Repo layout (editor / backend / plugin)
- Running the stack locally (Docker Compose)
- Self-hosting your own backend
- WebSocket protocol and bundle format
- Adding a new feature end-to-end

## Google sign-in for local development

Create an OAuth client of type **Web application** in Google Cloud Console. Configure the consent screen and, while the app is in testing, add the intended test users. Register `http://localhost:3001/api/v1/auth/google/callback` as an authorized redirect URI.

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in your local `.env` (see `.env.example`). Keep the secret on the backend. Docker Compose forwards these values; apply with `docker compose up -d --no-deps backend`. Its startup runs database migrations, including migration 0034, which preserves existing Discord links.

For a hosted installation, use the public HTTPS backend callback URL and set `EDITOR_URL` to the editor's public origin. All three Google settings must be present for the button to appear. An actual Google login requires valid credentials and the exact registered callback; automated tests use locally signed test tokens.
