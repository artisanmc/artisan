- **Changed**: a theme holds its images like a module, under `assets/`: one named like a common
  image replaces it while the theme is in place. A redraw at its former place,
  `overrides/artisan/<image>.png`, is still read and moves to `assets/textures/` at the server's
  next start. A theme of its own folder opens from the places of **Resources** on its own
  Resources, where its images are changed; one that replaces an image below wears **Override**.
