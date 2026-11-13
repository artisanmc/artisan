- **Fixed**: The resource pack ignored what a module ships in `originals/`: a shipped HUD mode
  asked for no image and the shipped textures were not packed, so ArtisanConversations' HUD fell
  back to the chat. The pack now reads them, the owner's file winning.
- **Fixed**: The editor's asset library and module previews (a HUD mode's box, its cursor) did
  not see the images a module ships in `originals/assets/`. They are listed, read-only, under
  the owner's.
