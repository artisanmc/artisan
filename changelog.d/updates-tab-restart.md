- **Added**: a **Restart the server** button on a server's **Updates** tab, for those who may
  configure it. It asks for a confirmation, tells the players, then restarts the server after
  ten seconds so the staged jars load. The server only comes back up where its host starts it
  again (a `restart-script` in `spigot.yml`, a container that restarts, a panel that treats a
  stop as a crash): elsewhere it stays off until started by hand. Protocol 1.8.
