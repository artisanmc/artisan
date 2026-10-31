- **Fixed**: An image without a descriptor beside it (a module's `assets/textures/<name>.png`) was
  sized 0 × 0 in the editor: invisible in a module's previews (`useAssetImage`) and in the HUD
  composer. Its size is now read from the image once it has loaded.
