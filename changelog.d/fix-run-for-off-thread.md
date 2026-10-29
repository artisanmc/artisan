- **Fixed**: `TaskScheduler.runFor` / `runForLater` / `isOwnedByCurrentThread` called from an async
  task threw "Asynchronous Chunk getEntities call!" on Leaf and Folia: the scheduler looked the
  entity up again by UUID (a world scan) instead of using the entity it was given. Daily Rewards
  hit it at every join.
