- **Added**: API 2.23.0, protocol 1.6. A module ships its own icon and logo in its jar: SVG files under
  `artisan-brand/` in its resources, no code needed (or `api.getModuleBrands().register(...)`). Static SVGs announced at Presence (`installed_modules[].brand`), served by the hub at
  `GET /api/v1/servers/:server/modules/:module/brand/:file.svg`, shown by the editor on the module's
  home and in the sidebar. The editor's copies of the suite's logos remain as a fallback for older jars.
