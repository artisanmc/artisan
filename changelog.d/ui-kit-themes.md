- **Added** (preview): themes of the UI kit. A folder `themes/<name>/` of the `ui-kit` module gives
  the whole kit another look without a menu being touched: a PNG under `assets/textures/`
  redraws one image at its size. Every `kit:<name>` image and every image composed from them follows; a module's own PNG
  does not. The server's theme is `resource-pack.theme` in `config.yml`, picked in the editor's
  Configuration page (**Theme of the UI kit**), and the editor shows the kit in it. The editor's
  assistant and AI apps list a kit's themes (`survey_ui`), write one (`write_image` with `theme`) and show a menu in a theme before it is deployed (`render_menu`
  with `theme` and `kit_draft_id`).
