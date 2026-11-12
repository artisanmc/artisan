// Enregistre une conversation avec l'assistant du vrai hub, instant par instant, dans
// fixtures/assistant.json. Le hub rejoué la sert ensuite au pas de la scène (voir hub.mjs).
//   HUB_RECORD=http://localhost:8765 HUB_COOKIE='<cookie>' node scripts/record-assistant.mjs <serveur> "<message>"
import { writeFileSync } from "node:fs";

const [server, text] = process.argv.slice(2);
const hub = process.env.HUB_RECORD;
const call = async (path, body) => {
  const res = await fetch(`${hub}/api/v1/ai/conversations${path}`, {
    method: body ? "POST" : "GET",
    headers: { cookie: process.env.HUB_COOKIE ?? "", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${path} : ${res.status} ${await res.text()}`);
  return res.json();
};

const conversation = await call("", { project: null, server });
await call(`/${conversation.id}/messages`, { text });
const snapshots = [];
let last = "";
for (;;) {
  const { events, live = null, running, ...summary } = await call(`/${conversation.id}?after=0`);
  const now = JSON.stringify({ events, live, running });
  if (now !== last) snapshots.push({ events, live, running });
  last = now;
  if (!running) {
    Object.assign(conversation, summary);
    break;
  }
  await new Promise((r) => setTimeout(r, 40));
}
writeFileSync(
  new URL("../fixtures/assistant.json", import.meta.url),
  `${JSON.stringify({ conversation, snapshots })}\n`,
);
console.log(`${snapshots.length} instants, ${snapshots.at(-1).events.length} lignes`);
for (const e of snapshots.at(-1).events) console.log(JSON.stringify(e).slice(0, 220));
