- **Fixed**: With the pack delegated to Nexo, Oraxen or ItemsAdder, a server restart could
  leave players without Artisan's images (missing textures on image buttons, squares in
  titles) until the host plugin was reloaded by hand. At boot Artisan wrote its files again
  and reloaded the host while the host was building its pack. It now remembers the pack the
  host already holds and leaves it alone.
