// Le hub de l'éditeur, rejoué depuis des réponses enregistrées (fixtures/hub/).
//
// Il sert aussi le bundle Remotion (build/) et editor/public : l'éditeur monté dans la vidéo est
// sur la même origine que son hub, comme quand le plugin le sert. API, textures, WebSocket.
// Sans HUB_RECORD, seules les réponses enregistrées sont servies : le rendu ne dépend d'aucun
// serveur Minecraft. Avec HUB_RECORD=<origine du vrai hub> et HUB_COOKIE=<cookie de session>, une
// lecture inconnue est demandée au vrai hub puis enregistrée.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "fixtures/hub");
const bodies = join(dir, "bodies");
const indexFile = join(dir, "index.json");
mkdirSync(bodies, { recursive: true });

const { port } = JSON.parse(readFileSync(join(root, "scripts/hub.json"), "utf8"));
const upstream = process.env.HUB_RECORD;
const cookie = process.env.HUB_COOKIE ?? "";
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : {};
const missing = new Set();
/** Les brouillons créés pendant ce rendu : le hub rejoué les relit comme le vrai. */
const drafts = new Map();
const draftPath = /\/drafts\/([^/]+)$/;

const save = () => {
  const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(indexFile, `${JSON.stringify(sorted, null, 1)}\n`);
};

/** Les lectures faites en POST : rejouées par corps de requête. */
const READ_POSTS = [/\/checks?$/, /\/preview/, /\/resolve/, /\/read$/, /\/validate/, /\/render/];

const keyOf = (method, url, body) =>
  method === "GET" ? `GET ${url}` : `${method} ${url} ${createHash("sha1").update(body).digest("hex").slice(0, 12)}`;

/** `/ext/<hôte>/<chemin>` : une image que l'éditeur prend ailleurs (têtes de joueurs), enregistrée elle aussi. */
function recordExternal(url) {
  const bytes = execFileSync("curl", ["-sSfL", "-m", "30", `https://${url.slice("/ext/".length)}`], {
    maxBuffer: 1 << 26,
  });
  const name = createHash("sha1").update(bytes).digest("hex").slice(0, 20);
  writeFileSync(join(bodies, name), bytes);
  return { status: 200, type: "image/png", body: name };
}

async function record(method, url, body, headers) {
  if (url.startsWith("/ext/")) return recordExternal(url);
  const res = await fetch(upstream + url, {
    method,
    headers: {
      cookie,
      ...(headers["content-type"] ? { "content-type": headers["content-type"] } : {}),
    },
    ...(method === "GET" ? {} : { body }),
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  const name = createHash("sha1").update(bytes).digest("hex").slice(0, 20);
  writeFileSync(join(bodies, name), bytes);
  const entry = { status: res.status, type: res.headers.get("content-type") ?? "", body: name };
  return entry;
}

// La conversation de l'assistant, enregistrée instant par instant (scripts/record-assistant.mjs).
// Le hub la rejoue au pas que la scène lui donne (`POST /api/promo/assistant?step=n`) : ce que le
// modèle écrit avance avec les images de la vidéo, pas avec l'horloge.
const talkFile = join(root, "fixtures/assistant.json");
const talk = existsSync(talkFile) ? JSON.parse(readFileSync(talkFile, "utf8")) : null;
const playing = { started: false, step: 0 };
const talkDrafts = new Set((talk?.snapshots.at(-1).events ?? []).map((event) => event.draft?.id).filter(Boolean));
function assistant(method, url, res) {
  const [path, query = ""] = url.split("?");
  const json = (status, value) => {
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
    return true;
  };
  if (path === "/api/promo/assistant") {
    const step = new URLSearchParams(query).get("step");
    playing.started = step !== null;
    playing.step = Math.min(Number(step ?? 0), (talk?.snapshots.length ?? 1) - 1);
    return json(200, { steps: talk?.snapshots.length ?? 0 });
  }
  if (!talk || !path.startsWith("/api/v1/ai/conversations")) return false;
  const now = talk.snapshots[playing.step];
  const summary = { ...talk.conversation, running: now.running };
  if (path === "/api/v1/ai/conversations")
    return method === "POST" ? json(201, summary) : json(200, { conversations: playing.started ? [summary] : [] });
  if (method !== "GET") return json(200, {});
  const after = Number(new URLSearchParams(query).get("after") ?? 0);
  return json(200, { ...summary, events: now.events.slice(after), live: now.live });
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
const statics = [join(root, "build"), join(root, "../editor/public")];

/** Un fichier du bundle Remotion ou de editor/public ; la racine est la page du bundle. */
function staticFile(url) {
  const rel = normalize(decodeURIComponent(url.split("?")[0])).replace(/^([/\\]|\.\.)+/, "");
  for (const base of statics) {
    const file = join(base, rel || "index.html");
    if (file.startsWith(base) && existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/api/") && !req.url?.startsWith("/ext/")) {
    const file = req.method === "GET" ? staticFile(req.url ?? "/") : null;
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    return res.end(readFileSync(file));
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const method = req.method ?? "GET";
  const url = req.url ?? "/";
  if (assistant(method, url, res)) return;
  const read = method === "GET" || (method === "POST" && READ_POSTS.some((p) => p.test(url.split("?")[0])));

  if (!read) {
    // Une écriture (brouillon, préférences) : acceptée, sans effet. Rien ne part vers le vrai hub.
    // Un brouillon reçoit la réponse du hub : sa révision monte à chaque enregistrement.
    let answer = {};
    if (/\/drafts(\/[^/]+)?$/.test(url.split("?")[0]) && (method === "POST" || method === "PUT")) {
      const sent = JSON.parse(body.toString() || "{}");
      const draft = {
        schema: "artisan-draft/v1",
        id: sent.id ?? url.split("/").pop(),
        ownerId: "00000000-0000-0000-0000-000000000000",
        name: sent.name ?? "Draft",
        revision: (sent.revision ?? 0) + 1,
        status: "active",
      };
      drafts.set(draft.id, { ...draft, snapshot: sent.snapshot });
      answer = { ok: true, draft: method === "POST" ? drafts.get(draft.id) : draft };
    }
    res.writeHead(method === "POST" ? 201 : 200, { "Content-Type": "application/json" }).end(JSON.stringify(answer));
    return;
  }
  // Un brouillon n'existe que le temps d'un rendu, sous un identifiant tiré au hasard : jamais enregistré.
  const draftId = method === "GET" ? draftPath.exec(url.split("?")[0])?.[1] : undefined;
  // Un brouillon enregistré (celui que l'assistant a écrit) se rejoue comme toute autre lecture.
  if (draftId && !index[`GET ${url}`]) {
    const draft = drafts.get(draftId);
    const real = !draft && upstream ? await record(method, url, body, req.headers).catch(() => null) : null;
    if (real?.status === 200) {
      index[`GET ${url}`] = real;
      save();
    } else {
      res.writeHead(draft ? 200 : 404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(draft ? { draft } : { error: "not_found" }));
    }
  }
  const key = keyOf(method, url, body);
  let entry = index[key];
  // Une lecture en POST dont le corps diffère d'un octet : la réponse enregistrée pour cette adresse.
  if (!entry && !upstream && method === "POST")
    entry = Object.entries(index).find(([k]) => k.startsWith(`POST ${url} `))?.[1];
  if (!entry && upstream) {
    try {
      entry = await record(method, url, body, req.headers);
      index[key] = entry;
      save();
      console.log(`enregistré ${entry.status} ${key}`);
    } catch (e) {
      console.error(`échec ${key}: ${e.message}`);
    }
  }
  if (!entry) {
    if (!missing.has(key)) console.error(`inconnu ${key}`);
    missing.add(key);
    res.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"not_found"}');
    return;
  }
  res.writeHead(entry.status, {
    ...(entry.type ? { "Content-Type": entry.type } : {}),
    "Cache-Control": "public, max-age=3600",
  });
  let answer = readFileSync(join(bodies, entry.body));
  // Le brouillon écrit par l'assistant n'existe que dans sa scène : les autres montrent le module tel qu'il est déployé.
  if (talkDrafts.size > 0 && req.headers["x-promo-scene"] !== "assistant" && /\/drafts$/.test(url.split("?")[0]) && entry.status === 200) {
    const listed = JSON.parse(answer.toString());
    answer = JSON.stringify({ ...listed, drafts: listed.drafts.filter((draft) => !talkDrafts.has(draft.id)) });
  }
  res.end(answer);
});

// Le canal de l'éditeur : ouvert et silencieux (aucun rechargement du serveur pendant la vidéo).
const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  sockets.handleUpgrade(req, socket, head, () => {});
});

server.listen(port, () => {
  console.log(`hub rejoué sur http://localhost:${port}${upstream ? ` (enregistre depuis ${upstream})` : ""}`);
});
