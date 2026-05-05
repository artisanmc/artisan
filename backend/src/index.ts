import { app, websocket } from "./app";

const port = Number(process.env.PORT ?? 3001);

export default {
  port,
  fetch: app.fetch,
  websocket,
};

console.log(`Interfaze backend on http://localhost:${port}`);
