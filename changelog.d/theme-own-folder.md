- **Added**: a theme can be a folder of its own, `plugins/Artisan/themes/<name>/`, beside the
  common images: it holds its images like a module, under `assets/`, and one named like a common image
  replaces it. The
  server reads it at start; the editor lists it with the other themes, and it is put in place,
  stacked and shown by the assistant's tools like them. A theme kept in the common images'
  folder is still read where it is, and a server's pack does not change.
