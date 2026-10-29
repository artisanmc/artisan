- **Added**: the editor's assistant is set up from the editor, in **Settings → Assistant**
  (`artisan.editor.config`): API, address, model, key, effort and steps, saved in the suite
  database (`artisan_settings`), shared by every server of the network and applied without a
  restart. The key is write-only: only its last four characters come back, and changing the API
  or the address asks for it again. environment.yml's `ai` section still works and wins; the
  editor then shows it read-only. The startup log names where the assistant's requests go
  (`anthropic API at api.deepseek.com, model deepseek-chat`).
