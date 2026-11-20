- **Added**: the Deploy review says what a change does to the players already in the game. A
  module that owns a Document kind can now check a changed file (`DocumentChangeCheck`, module API
  1.9.0): it can refuse a file it would not load, and report what players lose or keep, with how
  many are concerned. The review lists this above the diff, and a deployment that makes players
  lose something asks for a confirmation first. ArtisanQuests uses it for quests in progress.
