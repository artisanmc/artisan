import { Hono } from "hono";
import { db } from "../db/index";
import { serverKeys } from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { createNetwork } from "../lib/networkManager";
import {userAuth} from '../middleware/userAuth';
import {requireAdmin} from '../middleware/requireAdmin';

const router = new Hono();
router.use('*',userAuth(),requireAdmin());

router.post("/", async (c) => {
  const body = await c.req.json<{ label?: string }>();
  const { id, key, hash } = await generateServerKey();
  const network = await createNetwork(`Network ${id.slice(0, 6)}`);
  await db.insert(serverKeys).values({
    id,
    hash,
    label: body.label ?? null,
    networkId: network.id,
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
      keyPrefix: r.hash?`${r.hash.slice(0, 8)}...`:null,
    })),
  );
});

export { router as serverKeysRouter };
