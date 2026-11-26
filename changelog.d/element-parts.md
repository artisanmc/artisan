- **Added**: A menu button can be made of several pieces: `parts`, a list of images and
  texts drawn bottom to top over its slots, each placed by an `anchor` (centre, an edge or a
  corner) and offsets. A background with fixed edges, an icon and a text that changes per
  player make one button, and the same background serves every icon. `image` and `label`
  keep working. In the editor, the **Parts** section of a button's properties adds, places,
  orders and removes the pieces; the canvas shows them.
- **Fixed**: A duplicated state shared its label's text with the original: editing
  one changed the other.
