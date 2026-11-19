- **Fixed**: The editor's Captured items tab never showed the player field to load an inventory:
  the hub answered `captureInGame: false` for every project. It now offers capture whenever the
  project's server is online, and says so when it is offline instead of pointing to a field that
  is not there.
