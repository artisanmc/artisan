- **Fixed**: After a server restart, players could be left without the images of the add-ons'
  modules (missing textures on image buttons, squares in titles), most visibly with the pack
  delegated to Nexo, Oraxen or ItemsAdder, until the host plugin was reloaded by hand. The
  load made while Artisan enables was announced before the add-ons had registered their
  modules, so the hub built and applied a pack without them, then the whole one seconds later;
  a pack host building its own pack in between kept the first. The first load is now announced
  at the server's first tick, with every module. In delegation Artisan also remembers the pack
  the host already holds and leaves it alone on a restart.
