- **Changed**: one atelier for every image. A single drawing and an image of several layers
  open in the same editor, with one history: strokes, moves, resizes and layers added or
  removed are undone in the order they were made, whatever layer or tool is in hand.
- **Changed**: the atelier writes nothing before **Save**. Switching layer or tool no longer
  saves the pixels drawn, a **Drawing** layer gets its file when the image is saved, and a PNG
  given layers becomes a composed image at that save, where each of these wrote files at once.
  **Flatten** asks for the image to be saved first.
