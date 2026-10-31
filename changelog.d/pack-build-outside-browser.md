- **Added**: `npm run pack -- build <projects-dir>` (editor) builds a server's Java resource pack from
  Project folders on disk, with the same bytes as the editor after a publication, without a browser.
  `npm run pack -- vectors` checks the pack conformance vectors, which now also record each entry's
  SHA-256 and cover module images (`pack.images`). First step towards the hub building packs itself.
