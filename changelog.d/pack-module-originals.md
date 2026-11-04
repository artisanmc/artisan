- **Fixed**: The resource pack ignored what a module ships in `originals/`: a shipped HUD mode
  asked for no image and the shipped textures were not packed, so ArtisanConversations' HUD fell
  back to the chat. The pack now reads them, the owner's file winning.
