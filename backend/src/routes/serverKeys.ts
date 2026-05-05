import { Hono } from "hono";
import { db } from "../db/index";
import { serverKeys } from "../db/schema";

const router = new Hono();

router.post("/", async (c) => {
  const body = await c.req.json<{ label?: string }>();

  const rawBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = "sk_" + Array.from(rawBytes, (b) => b.toString(16).padStart(2, "0")).join("");

  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");

  const id = crypto.randomUUID();
  await db.insert(serverKeys).values({
    id,
    hash,
    label: body.label ?? null,
    createdAt: new Date(),
  });

  return c.json({ id, key }, 201);
});

router.get("/", async (c) => {
  const rows = await db.select().from(serverKeys);
  return c.json(
    rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt,
      keyPrefix: `${r.hash.slice(0, 8)}...`,
    })),
  );
});

export { router as serverKeysRouter };
