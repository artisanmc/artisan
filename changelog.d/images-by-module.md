- **Changed**: two modules that each hold an image of the same name no longer collide. Each
  module's menus show their own image, where one of the two showed in every menu before. A
  menu names another module's image with its module: `image: { asset: "guilds:gold" }`. In the
  pack, the first module that holds a name keeps it; a later one's image is `<module>:<name>`,
  under `modules/<module>/`. The pack of a server where no two modules share an image name does
  not change.
