- **Changed**: A module's folder now holds every file the module ships at its own path, editable
  in place: `originals/` is gone. `artisan-shipped.yml` (written by the server) records what each
  file was written from, so a file left as shipped follows the module's updates, an edited one is
  merged, a deleted optional one stays deleted and a required one comes back. Messages are one
  `lang/<code>.yml` merged key by key. The first start migrates each folder after checking that
  the server loads the same content and builds the same pack from both layouts; a folder that
  would differ keeps `originals/` and is tried again at the next start. The theme `artisan` is
  migrated the same way. The editor's YAML tab of a shipped Document is no longer empty.
  - Going back to an older Artisan keeps working, except that the messages of a migrated folder
    read as the owner's (they stop following the module until saved from the editor), and a
    YAML file reformatted by hand stays a full copy until the next module update.
- **Added**: MCP `restore_document` and `read_document` with `shipped: true`; `list_documents`
  gives each Document's origin from `artisan-shipped.yml` and lists the shipped ones deleted.
