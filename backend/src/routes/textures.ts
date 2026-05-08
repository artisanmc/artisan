import { Hono } from "hono";

const router = new Hono();

router.get("/:version/*", async (c) => {
  const version = c.req.param("version");
  const fullPath = c.req.path;
  const prefix = `/${version}/`;
  const rest = fullPath.includes(prefix) ? fullPath.split(prefix)[1] : "";
  const url = `https://assets.mcasset.cloud/${version}/assets/minecraft/textures/${rest}.png`;

  let upstream: Response;
  try {
    upstream = await fetch(url);
  } catch {
    return c.newResponse(null, 502);
  }

  if (!upstream.ok) return c.newResponse(null, upstream.status as 404 | 502);

  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
});

export { router as texturesRouter };
