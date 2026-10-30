- **Added** (preview): API 2.21.0: HUD layouts. A module keeps its HUD as a YAML list of layers
  (`image`, `image_slot`, `text`, `list` with a cursor), read by `OverlayLayout.read` with problems
  by path and code, and `api.getOverlay().compose(layout, content)` builds the frame from the rows
  and images the module gives. The pack index records each HUD image's own height
  (`OverlayApi.imageHeight`), so a portrait can sit on its bottom edge.
