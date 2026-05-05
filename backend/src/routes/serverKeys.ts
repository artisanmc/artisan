import { Hono } from "hono";
import { db } from "../db/index";
import { serverKeys } from "../db/schema";
import { generateServerKey } from "../lib/auth";

const router = new Hono();

router.post("/", async (c) => {
  const body = await c.req.json<{ label?: string }>();
  const { id, key, hash } = await generateServerKey();
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
