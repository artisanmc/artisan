- **Fixed**: A module whose files Artisan keeps under `originals/` showed its texts as raw
  `{i18n:…}` keys in game, and lost the data sources and models it ships: `lang/`, `data/` and
  `models/` were read from the owner's folder only. They are now read like Documents, the
  owner's file over the module's original of the same name.
