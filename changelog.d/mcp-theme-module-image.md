- **Changed**: the assistant replaces a module's own image in a theme. In a draft of a
  theme, `write_image` with `name: <module>:<image>` writes `overrides/<module>/<image>.png`
  (refused before), `render_menu` shows a module's image as the themes asked for draw it, and
  `survey_ui` lists what each theme replaces in modules (`module_images`).
