- **Added** (preview): An AI client connected through MCP can deploy, once the player allows it: a
  box on the consent page, or "Can deploy" in Settings → AI apps (needs `artisan.editor.publish`;
  off by default). New tools `draft_publish` (the editor's Deploy: draft revision compare-and-swap,
  server files unchanged since, every file checked; `dry_run` returns the diff first; the answer
  gives the diff and the new Version), `list_versions` and `version_rollback`. Each such deploy is a
  Version marked "<player> via <client>" in the history. The editor's assistant still never deploys.
