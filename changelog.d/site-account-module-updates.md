- **Added**: an **Updates** tab on each server. Link the network once to your artisanmc.net
  account (a code to approve on the site, no key to paste), then update Artisan and its modules,
  or install the ones your account owns, in one click. The server downloads the jar from the
  site, checks its SHA-256 and keeps it for its next restart (`plugins/update/` for an update,
  `plugins/` for a new module). Releases by default, development builds on request. Linking,
  unlinking and installing need `artisan.editor.config`. New `site.url` in `environment.yml`
  (default `https://artisanmc.net`); protocol 1.7 (`plugins_fetch`, `module_install`).
