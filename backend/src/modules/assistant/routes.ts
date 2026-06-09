import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { validateAccessToken } from "../../lib/auth";
import { resolveProviderConfig, createProvider } from "./provider/config";
import type { LlmProvider } from "./provider/types";
import { runTurn } from "./loop";
import { ConversationStore } from "./conversations";

const store = new ConversationStore();

let providerOverride: LlmProvider | null = null;
/** Test hook: inject a fake provider (and skip env resolution). */
export function __setProviderForTests(p: LlmProvider | null): void { providerOverride = p; }

function resolve(): { provider: LlmProvider; model: string } | null {
  if (providerOverride) return { provider: providerOverride, model: "test-model" };
  const cfg = resolveProviderConfig(process.env as Record<string, string | undefined>);
  return cfg ? { provider: createProvider(cfg), model: cfg.model } : null;
}

export function buildAssistantRouter(): Hono {
  const r = new Hono();

  r.use("*", async (c, next) => {
    const h = c.req.header("Authorization");
    const token = h?.startsWith("Bearer ") ? h.slice(7) : "";
    const session = token ? await validateAccessToken(token) : null;
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    c.set("serverKeyId", session.serverKeyId);
    return next();
  });

  r.post("/conversations", async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const menus = Array.isArray((body as any).menus) ? (body as any).menus : [];
    const attachments = (body as any).attachments && typeof (body as any).attachments === "object" ? (body as any).attachments : {};
    const id = store.create({ menus, attachments, serverKeyId: c.get("serverKeyId") as string });
    return c.json({ conversationId: id });
  });

  r.post("/conversations/:id/messages", async (c) => {
    const conv = store.get(c.req.param("id"));
    if (!conv || conv.serverKeyId !== (c.get("serverKeyId") as string)) return c.json({ error: "Not found" }, 404);
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    if (Array.isArray((body as any).menus)) store.reseed(conv, (body as any).menus, (body as any).attachments ?? {});
    const pm = resolve();
    if (!pm) return c.json({ error: "Assistant disabled: no provider configured (set ASSISTANT_API_KEY)." }, 503);

    conv.messages.push({ role: "user", content: typeof (body as any).text === "string" ? (body as any).text : "" });

    return streamSSE(c, async (stream) => {
      try {
        for await (const ev of runTurn({ provider: pm.provider, model: pm.model, messages: conv.messages, wc: conv.wc })) {
          await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
        }
      } catch (e) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message: e instanceof Error ? e.message : String(e) }) });
      }
    });
  });

  return r;
}
