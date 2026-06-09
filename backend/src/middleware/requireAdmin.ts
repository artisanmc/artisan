import { createMiddleware } from "hono/factory";

/** Must run AFTER userAuth() (reads c.var.user). 403 if not an admin. */
export const requireAdmin = () => createMiddleware(async (c, next) => {
  const user = c.var.user;
  if (!user?.isAdmin) return c.json({ error: "forbidden" }, 403);
  return next();
});
