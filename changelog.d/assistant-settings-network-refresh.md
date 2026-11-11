- **Fixed**: the servers of one database, which share a tunnel address and each answer the
  editor, now follow the assistant's settings saved from any of them: each reads them again every
  30 s. Before, a server kept what it read at startup, so the assistant could vanish or run on an
  old key depending on which server the address reached.
