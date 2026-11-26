- **Fixed**: over MCP, `render_menu` and `survey_ui` showed the server's own image of a module
  where the game shows the module's original, when that original's function fixes other
  measures. They now show what the pack shows, and `write_image` and `read_image` say of such an
  image that it is not taken (`not_taken`), with the measures to draw it at.
