- **Changed**: The editor tunnel costs fewer Cloudflare requests. On the Worker tunnel, a plugin now
  sends a response under 256 KiB as one frame instead of three (`RESPONSE_WHOLE`, only when the
  tunnel server's hello says it reads it, so older Workers and the Kotlin server are unchanged), and the
  Worker serves the editor's hashed `/assets/` from Cloudflare's cache instead of asking the hub each time.
