- **Added**: A module's export takes the server's common images its menus name: each one
  reached by its name alone is copied into the archive, which notes it
  (`artisan-export.yml`). On the server it arrives on, the import leaves out the copies that
  server already has as common images and keeps the others in the module, without asking.
  Before it writes anything, the import lists the images the server lacks: base images of a
  newer Artisan, common images named as `artisan:<name>`, images of a module that is not
  installed.
