- **Changed**: The pages of a module share one margin (`--page-pad`: 16 px, 24 px on a wide
  screen). A Document's header now starts at the top edge of the panel and spans its width, its
  title lined up with the body, instead of floating in the centred column under an empty band.
  Collections, screens, data sources and Document editors (command, dialog, trigger, module views)
  pad the same way; the pane beside the board keeps 12 px. A module bundle reads the margin with
  `var(--page-pad, 12px)` and looks unchanged on an older editor.
