// Un modèle scripté, derrière l'API Chat Completions : il sert à enregistrer la scène de l'assistant
// sans clé ni fournisseur. Le hub le prend pour un vrai modèle (`ai.provider: "openai"`,
// `ai.base-url: "http://localhost:3902/v1"`) : ses outils s'exécutent réellement, le brouillon est
// réellement écrit et vérifié par le serveur. Seul le choix des appels et le texte viennent d'ici.
//   node scripts/model.mjs            écoute sur le port 3902
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.env.MODEL_PORT ?? 3902);
const menu = readFileSync(new URL("./model-vip.yml", import.meta.url), "utf8");
const PATH = "menus/vip.yml";

/** Le résultat du dernier appel de l'outil `name`, lu dans l'historique envoyé par le hub. */
function result(messages, name) {
  const calls = new Map();
  for (const m of messages) for (const c of m.tool_calls ?? []) calls.set(c.id, c.function.name);
  const found = messages.filter((m) => m.role === "tool" && calls.get(m.tool_call_id) === name).pop();
  return found ? JSON.parse(found.content) : null;
}

/** Les réponses, dans l'ordre : la n-ième est celle qui suit n réponses déjà données dans ce tour. */
const STEPS = [
  () => ({
    text: "I'll look at how your menus are built first.",
    calls: [{ name: "artisan_overview", args: {} }],
  }),
  (messages) => {
    const projects = result(messages, "artisan_overview").servers.flatMap((server) => server.projects);
    const project = projects.find((id) => id.endsWith(".survival")) ?? projects[0];
    return {
      calls: [
        { name: "read_document", args: { project, path: "menus/shop.yml" } },
        { name: "get_kind_guide", args: { kind: "menu" } },
      ],
    };
  },
  (messages) => ({
    text: "Your shop already sells a VIP rank. I'll give the ranks their own menu, in the same style.",
    calls: [{ name: "start_draft", args: { project: result(messages, "read_document").project, name: "AI: VIP ranks menu" } }],
  }),
  (messages) => {
    const draft = result(messages, "start_draft");
    return { calls: [{ name: "write_document", args: { project: draft.project, draft_id: draft.draft_id, path: PATH, content: menu } }] };
  },
  () => ({
    text: "Done. `menus/vip.yml` has three ranks, VIP, Elite and Legend. Each one checks the balance, takes the price, grants the rank through LuckPerms and shows as owned once the player has it. It is in the draft \"AI: VIP ranks menu\": review it, then deploy.",
  }),
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pieces = (text, size) => text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [];

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) return res.writeHead(404).end();
  const body = JSON.parse(Buffer.concat(chunks).toString());
  if (process.env.MODEL_LOG) writeFileSync(process.env.MODEL_LOG, JSON.stringify(body, null, 1));
  // Les réponses déjà données depuis le dernier message du joueur.
  const lastUser = body.messages.map((m) => m.role).lastIndexOf("user");
  const given = body.messages.slice(lastUser).filter((m) => m.role === "assistant").length;
  const step = (STEPS[given] ?? STEPS.at(-1))(body.messages);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const send = (delta, finish = null) =>
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  for (const piece of pieces(step.text ?? "", 5)) {
    send({ content: piece });
    await wait(25);
  }
  for (const [index, call] of (step.calls ?? []).entries()) {
    send({ tool_calls: [{ index, id: `call_${given}_${index}`, type: "function", function: { name: call.name, arguments: "" } }] });
    for (const piece of pieces(JSON.stringify(call.args), 14)) {
      send({ tool_calls: [{ index, function: { arguments: piece } }] });
      await wait(25);
    }
  }
  send({}, step.calls?.length ? "tool_calls" : "stop");
  res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } })}\n\n`);
  res.end("data: [DONE]\n\n");
}).listen(port, () => console.log(`modèle scripté sur http://localhost:${port}/v1`));
