- **Fixed**: In the atelier, **Add layers** on an image a module ships failed with "Not found":
  it asked to rename a file the server does not hold. The image's drawing is now copied as
  your first layer and the composed image is your version of that name. The pack (editor and
  server) takes the owner's composed image over the PNG the module ships; it used to keep
  the shipped PNG, so such layers showed nothing.
- **Fixed**: The atelier's **Title** guide was barely visible on a window's light grey: it is
  drawn as a plain line and a hatch in a colour that stands out.
