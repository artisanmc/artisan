-- Add nullable column first so existing rows aren't rejected
ALTER TABLE "packs" ADD COLUMN "server_key_id" text;

-- Backfill: pick the oldest binding per pack.
-- NOTE: packs previously bound to multiple server_keys (M:N) are collapsed
-- to their oldest server_key. Other bindings are intentionally dropped —
-- multi-server sync is not supported in V1 (see spec §2 Non-goals).
UPDATE "packs" p SET "server_key_id" = (
  SELECT pb."server_key_id"
  FROM "pack_bindings" pb
  WHERE pb."pack_id" = p."id"
  ORDER BY pb."created_at" ASC
  LIMIT 1
)
WHERE p."server_key_id" IS NULL;

-- Drop orphan packs (no binding ever existed = unreachable from any plugin).
-- Cascades to pack_commits, pack_branches, and assets for each deleted pack.
DELETE FROM "packs" WHERE "server_key_id" IS NULL;

-- Enforce NOT NULL + cascade FK
ALTER TABLE "packs" ALTER COLUMN "server_key_id" SET NOT NULL;
ALTER TABLE "packs" ADD CONSTRAINT "packs_server_key_id_server_keys_id_fk"
  FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE cascade;

CREATE INDEX IF NOT EXISTS "packs_server_key_idx" ON "packs" USING btree ("server_key_id");

-- Drop the M:N table (and its indexes/constraints implicitly)
DROP TABLE "pack_bindings";
