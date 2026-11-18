- **Fixed**: Opening a module whose kinds arrive late (ArtisanQuests' quest groups) created a
  draft without any edit, holding only the editor's reformatting and the module's shipped
  example written out as the owner's file; discarding it brought it straight back. Reading
  those kinds now counts as part of opening, and a shipped Document left as shipped is
  never written.
- **Fixed**: A link filled in game (`group: "{q.group}"`) was reported as a link to a missing
  Document in the deploy checks.
