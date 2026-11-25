- **Changed**: a name alone in a menu now reaches the server's common image of that name before
  another module's image: a module that draws its own `button.3x1` shows it in its own menus
  only. In the pack, that module's image is filed under `modules/<folder>/`; `<module>:<name>`
  reaches it as before. A server where no module's image has a common image's name keeps its
  pack byte for byte. The editor's picker writes `artisan:<name>` only when the open module
  holds an image of that name.
