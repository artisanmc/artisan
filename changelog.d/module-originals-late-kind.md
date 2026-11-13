- **Fixed**: A module page opened directly (reload or link) showed only the owner's files: the
  Documents the module ships, of a kind its view registers after the read, were left out, and
  an autosave then recorded that partial state. They are now read when the kind arrives.
- **Fixed**: A module's home page counted the Documents of the project as it was opened: those
  read once the module's kinds arrived showed in the sidebar but not on the page (0 everywhere).
