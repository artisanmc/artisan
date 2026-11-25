- **Added**: a theme created as a folder of its own is renamed and deleted from its page
  (**Rename**, **Delete**). A renamed theme keeps its place among the themes in place; a
  deleted one is taken off, and its folder moved to `themes/.artisan-trash/` on the server,
  never erased. The server's pack is rebuilt when the theme was in place.
