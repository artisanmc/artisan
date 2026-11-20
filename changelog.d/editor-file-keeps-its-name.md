- **Fixed**: Every Deploy after capturing an item conflicted on `.artisan/editor.yml` ("deleted in your
  version"). Publishing a draft respelled the editor's new `.artisan/editor.yaml` as `.yml`, a file
  the editor neither reads nor writes. `.artisan*` metadata now keeps its name, and a start moves a
  stray `.artisan/editor.yml` back to `.artisan/editor.yaml` (the captured items' names come back).
