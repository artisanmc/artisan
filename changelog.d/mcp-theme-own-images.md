- **Added**: the assistant writes a theme's own images. In a draft of a theme, `write_image`
  with the name `<theme>:<image>` (`noel:garland`) writes an image of the theme's own, and a menu
  names it the same way; `render_menu` draws it, deployed or as the theme's draft has it, and
  `survey_ui` lists each theme's own images (`common.themes[].own_images`).
