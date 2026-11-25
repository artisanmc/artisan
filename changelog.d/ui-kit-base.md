- **Added** (preview): the UI kit's base. Every server has 19 plain images under names that never
  change (`kit:button.3x1`, `kit:window.6`, `kit:close.1x1`…): a menu names one in an element's
  `image` or as its title's background, and looks right on any server. The server's `ui-kit`
  module restyles one with an image of the same name and size, and any other image of that
  module is `kit:<its name>`. In the editor, **UI kit** beside Item and Image picks one; the
  editor's assistant and AI apps see the base in `survey_ui` and draw with it.
