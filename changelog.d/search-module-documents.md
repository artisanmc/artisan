- **Fixed**: The search palette missed the Documents of a module: the server's other projects were
  read once, sometimes before the modules' views arrived, and kept without their kinds' Documents
  until their files changed. A kind registered later now has the cached files read again.
- **Changed**: The search palette also finds the texts of a module's Documents (a conversation's
  pages, a shop category's articles…), from the kind's `ltextSites`, and any Document by its id.
