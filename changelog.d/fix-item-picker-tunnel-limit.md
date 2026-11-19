- **Fixed**: Opening the item picker (an item field of a module's config screen, a menu's
  material) loaded the icon of every catalogue item at once, about 1,600 requests in a few
  seconds. Through the editor tunnel this went over its per-minute limit and the whole editor
  answered "over its tunnel limits" for a minute. The picker now loads only the icons in view.
