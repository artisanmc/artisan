- **Fixed**: A module's Config screens (Daily rewards' Settings and Rewards) showed "No data for
  this screen" until the owner had their own copy of the data: the editor now reads
  `originals/data/` and `originals/models/` where the owner has none, and writes the owner's copy
  only once it differs from what the module ships.
