- **Fixed**: Reading an assistant conversation at the moment its turn ended could show it stopped
  without its final `done` event: `running` is now read before the events.
