- **Changed**: an image that replaces another at another size is taken as it is, in the editor,
  the pack and the game: a theme's drawing of a common image, the server's image of a piece of
  Artisan's base, your version of an image a module ships. It was left out before, and the
  image it replaced kept showing. The image is marked **Other size than the one it replaces**,
  with both sizes; a menu laid out for the other size may look off.
- **Changed**: over MCP, `write_image` no longer refuses an image of another size than the
  common image or the piece it replaces: it writes it and says so (`other_size`).
  `list_documents` lists such images under `images_other_size` (was `images_not_taken`), and
  `survey_ui` says `other_size` on a piece (was `ignored`).
