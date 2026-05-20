import { app, websocket } from "./app";
import { backfillContentWidths } from "./lib/contentWidthBackfill";

const port = Number(process.env.PORT ?? 3001);

export default {
  port,
  fetch: app.fetch,
  websocket,
};

console.log(`Interfaze backend on http://localhost:${port}`);

// One-time migration: compute contentWidth for assets uploaded before the column existed.
backfillContentWidths().catch((err) => console.error("[backfill] contentWidth failed:", err));
