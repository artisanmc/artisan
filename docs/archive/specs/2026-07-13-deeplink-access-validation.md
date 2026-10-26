# Deep link + access request validation — manual

1. /artisan editor → link to the exact /networks/<slug>/servers/<slug>.
2. Anonymous clicks → login (next) → lands on the server page after signing in.
3. Account WITHOUT membership opens the link → "Request access" panel (no bounce) → sends a request (optional message).
4. Owner: email received (if SMTP) + request visible in Members → Approve → the requester sees the network on reload.
5. Re-request while pending → "already pending"; after deny → new request possible.
6. Real 404 (deleted network) → /networks bounce kept.
