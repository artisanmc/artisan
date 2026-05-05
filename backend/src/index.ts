import { app } from "./app";

const port = Number(process.env.PORT ?? 3001);

export default {
  port,
  fetch: app.fetch,
};

console.log(`Interfaze backend listening on http://localhost:${port}`);
