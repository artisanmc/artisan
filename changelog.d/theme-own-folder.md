- **Added**: a theme can be a folder of its own, `plugins/Artisan/themes/<name>/`, beside the
  common images: its colours in `overrides/colors.yml`, its redraws of the common images in
  `overrides/artisan/<image>.png`. The server reads it at start; the editor lists it with the
  other themes, and it is put in place, stacked and shown by the assistant's tools like them.
  A theme kept in the common images' folder is still read where it is, and a server's pack
  does not change.
