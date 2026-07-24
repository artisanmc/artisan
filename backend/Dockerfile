# Production image for the Artisan backend (Bun + Hono + WS).
# BUILD CONTEXT MUST BE THE REPO ROOT (not backend/): the assistant module
# imports docs/schema/* at runtime via `../../../../docs/...`, so docs/ has to
# sit at /docs (sibling of /app) — exactly like the dev docker-compose mount.
#
# Coolify: Build Pack = Dockerfile, Base Directory = `/`, Dockerfile = backend/Dockerfile
#
#   docker build -f backend/Dockerfile -t artisan-backend .   # run from repo root
FROM oven/bun:1 AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Deps first for layer caching (only re-installs when manifests change).
COPY backend/package.json backend/bun.lock ./
RUN bun install --frozen-lockfile

# App source (node_modules + data/ excluded via .dockerignore) ...
COPY backend ./
# ... and the docs/ tree the assistant + schema validators import at runtime.
# Must land at /docs to match the relative imports from backend/src.
COPY docs /docs
# ... and the editor sources the backend imports at runtime (Action DSL codec:
# assistant/validate.ts reaches ../../../../editor/src/lib/actionDsl).
# Must land at /editor to match those relative imports — mirrors the dev
# docker-compose ./editor:/editor mount.
COPY editor/src /editor/src

ENV NODE_ENV=production
# PORT is read from the environment (default 3001); Bun.serve binds 0.0.0.0.
EXPOSE 3001

# /app/data is a PERSISTENT VOLUME (mc-assets icons + per-server runtime data).
# Seed it once with deploy/seed-data.sh — it is NOT baked into the image.
VOLUME ["/app/data"]

# Apply DB migrations (retry until Postgres is reachable), then start.
CMD ["sh", "-c", "until bun run db:migrate; do echo '[deploy] migrate failed — DB not ready? retrying in 3s'; sleep 3; done; bun run start"]
