# Pack host as a Cloudflare Worker

ADR `pack-host`. Hubs upload the resource pack the editor builds, once per version; players download it
from `https://cdn.artisanmc.net/resource-pack/<sha1>.zip`, served from an R2 bucket. The hub's port, or
its tunnel, carries no player download.

## Routes

| Route | Who | What |
|---|---|---|
| `GET`, `HEAD /resource-pack/<sha1>.zip` | players, leaves | The pack. `immutable` for a year; this colo's cache keeps it a day. |
| `POST /resource-pack/<sha1>.zip` | hub, bearer tunnel secret | "I still serve it": 200 `{url}`, rewritten if older than `PACK_REFRESH_DAYS`; 404: upload it. |
| `PUT /resource-pack/<sha1>.zip` | hub, bearer tunnel secret | The zip, `Content-Length` required. 201 `{url}`, 200 if already there, 401, 411, 413, 422 (SHA-1 mismatch, or no `pack.mcmeta` at the root), 429 (quota, `Retry-After` until midnight UTC). |
| `DELETE /admin/resource-pack/<sha1>.zip` | bearer `PACK_ADMIN_TOKEN` | Takes a pack down; answers which server sent it. Other colos' caches keep it a day at most. |
| `GET /health` | | `ok` |

## How it works

- The hub sends its tunnel secret (`plugins/Artisan/tunnel-secret`, or the network's); the Worker derives
  the tunnel's `<id>` from it (`../tunnel-worker/src/protocol.ts`) and never stores it. It counts quotas;
  it does not authorize: anyone can generate a secret.
- An upload streams to `incoming/<sha1>-<uuid>.zip` with R2's SHA-1 check, then reads its end by ranges
  (`src/zip.ts`): the central directory must list `pack.mcmeta` at the root. Only then is it copied to
  `packs/<sha1>.zip`, where players download. Nothing loads a whole zip in memory.
- Quotas (`src/quota.ts`): one Durable Object per `server:<id>`, `ip:<address>` and `global`, per UTC day.

| Variable | Default | |
|---|---|---|
| `PACK_PUBLIC_URL` | | Base of the addresses handed to hubs. |
| `PACK_MAX_MB` | `100` | Largest pack. Cloudflare's own limit on a request body is 100 MB on Free and Pro. |
| `PACK_SERVER_UPLOADS_PER_DAY`, `PACK_SERVER_DAILY_MB` | `50`, `1024` | Per server (touches count as requests). |
| `PACK_IP_UPLOADS_PER_DAY`, `PACK_IP_DAILY_MB` | `200`, `2048` | Per uploading IP. |
| `PACK_GLOBAL_DAILY_MB` | `51200` | All hubs together. |
| `PACK_REFRESH_DAYS` | `7` | A touched pack older than this is rewritten, for the lifecycle rule. |
| `PACK_ADMIN_TOKEN` | | Secret (`wrangler secret put`). Unset: no admin route. |

## Run locally and test

```bash
npm ci
npm test            # starts wrangler dev on a fresh local bucket, port 8788
npm run typecheck
```

A hub tries it with `web.pack-cdn: "http://127.0.0.1:8788"` in `environment.yml` and `npm run dev:test`.

## Deployment

Not deployed yet. On Iban's Cloudflare account, the zone `artisanmc.net` must be on Cloudflare for the
custom domain.

```bash
npx wrangler r2 bucket create artisan-packs
# Delete a pack 30 days after its last write, an interrupted upload after a day.
npx wrangler r2 bucket lifecycle add artisan-packs packs-30d packs/ --expire-days 30
npx wrangler r2 bucket lifecycle add artisan-packs incoming-1d incoming/ --expire-days 1
npx wrangler secret put PACK_ADMIN_TOKEN
npx wrangler deploy     # creates cdn.artisanmc.net as the Worker's custom domain
curl https://cdn.artisanmc.net/health
```

The bucket gets no public access and no R2 custom domain: every read goes through the Worker, which
serves only `packs/`. Rollback: `web.pack-cdn: ""` on the hubs, or delete the Worker; hubs then serve
their packs themselves.
