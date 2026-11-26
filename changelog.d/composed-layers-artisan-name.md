- **Fixed**: the composer lays out a composed image whose layers name a common image as
  `artisan:<name>`, which is what the assistant writes. Such a layer was missing from the
  stage and listed under a cut name.
- **Changed**: the composer and **New image** write a common image's layer as
  `artisan:<name>`. `kit:<name>` is read the same; a layer already written keeps it.
