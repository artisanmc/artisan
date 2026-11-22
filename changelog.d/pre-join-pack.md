- **Fixed**: `has_resource_pack` (and the `textured`-style variants that test it) was false for
  every player when the pack is sent before joining, as Nexo does with `send_pre_join`: Paper
  fires no pack status event in the configuration phase. Artisan now reads the client's answer on
  each connection and counts a pack loaded before join (any pack when delegated, its own when it
  sends the pack). A player already online when Artisan starts counts after rejoining.
