- **Added**: a layer's `tint` takes a name (`tint: primary`), whose colour is read in
  `palette.yml` of the themes in place, then of the library, then in a default palette
  (`neutral`, `primary`, `success`, `danger`, `warning`). A theme recolours tinted images
  without redrawing them.
