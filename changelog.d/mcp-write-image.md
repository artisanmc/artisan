- **Added** (preview): AI apps connected through MCP can draw a menu's images into a draft
  (`write_image`: pixels written one by one, or a PNG made on the app's side) and look at the
  images a module has (`read_image`). Each image comes back enlarged, so the app checks what it
  drew. Nothing reaches players before the draft is deployed. The editor's assistant has the same
  tools and sees its images too, when its model reads images.
- **Added** (preview): AI apps and the editor's assistant can look at a whole menu as a picture
  (`render_menu`): the window, the title's images and texts, the image buttons and the items, as
  deployed or as a draft has it. A still picture: conditions and data are not evaluated.
