- **Added** (preview): pictures from an image model. Set one in **Settings → Assistant** (or
  `ai.image` in `environment.yml`: `openai` or `google`, with that vendor's key) and the editor's
  assistant can ask it for what it cannot draw pixel by pixel, an illustration or a painted
  background (`generate_image`). Each picture is paid on that key, so the assistant asks first, in
  the conversation: **Allow once**, **Always allow** (taken back in Settings → AI apps) or
  **Deny**. An AI app connected over MCP gets the tool only when the player ticks it at consent,
  or switches "Can generate pictures" on in Settings → AI apps. A player has
  `ai.image.daily-limit` pictures a day (40). The picture is material: the assistant measures it
  and cuts what the menu needs into a draft, as from an attached screenshot.
- **Fixed**: a conversation of the assistant could be read as finished an instant before its
  last state was saved.
