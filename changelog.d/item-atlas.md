- **Changed**: The editor's item grids (Library, item picker) load every vanilla icon in one
  image, `GET /api/v1/item-atlas/:version`, built once by the hub, instead of one request per
  item. Through the editor tunnel, a grid no longer counts against its per-minute limit as it
  scrolls. Until the hub has the textures and icons, the grids load the icons one by one as before.
