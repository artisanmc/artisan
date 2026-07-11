// backend/src/routes/userWsTicket.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { issueTicket } from "../lib/wsTickets";
import type { AuthUser } from "../middleware/userAuth";

type Vars = { user: AuthUser | null };

export const userWsTicketRouter = new Hono<{ Variables: Vars }>();

// POST /api/v1/user/ws-ticket — mint a one-shot ticket (TTL 30s) redeemable
// at the /ws/editor upgrade as an alternative to the session-token `?token=`
// path. Cookie-authenticated (userAuth middleware mounted by the caller).
userWsTicketRouter.post("/", (c: Context<{ Variables: Vars }>) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ ticket: issueTicket(user.id) });
});
