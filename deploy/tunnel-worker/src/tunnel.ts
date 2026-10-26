import { DurableObject } from "cloudflare:workers";
import { config, publicUrl, textResponse, type Config, type Env } from "./config";
import { offlinePage } from "./offline";
import {
  CHUNK, HOP_BY_HOP, T, decode, encode, encodeJson, json, text,
  type Frame, type HeaderList, type Hello, type NameRequest, type RequestHead, type ResponseHead, type WsClose,
} from "./protocol";

/** Headers the Worker sets for this object; stripped from what browsers send. */
export const INTERNAL = "x-tunnel-internal-";
export const ABSENT_HEADER = "X-Tunnel-Internal-Absent";

interface PluginTag { kind: "plugin"; key: string; id: string; member: string; address: string; at: number }
interface BrowserTag { kind: "browser"; stream: number; plugin: string }

interface HttpStream {
  plugin: string;
  head: (frame: Frame | null) => void;
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
  early: Uint8Array[];
  ended: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Opening {
  plugin: string;
  answer: (frame: Frame | null) => void;
  /** What the server sends between its own open and the browser's. */
  early: Frame[];
}

/** Servers of one network behind one address: one answers, the others wait their turn (TunnelServer.MAX_PER_ID). */
const MAX_PER_ID = 32;
const RESPONSE_TIMEOUT_MS = 60_000;
const OPEN_TIMEOUT_MS = 15_000;
const DAY = 86_400_000;
const NULL_BODY = new Set([101, 204, 205, 304]);

/**
 * One tunnel address (`<id>`), and every plugin holding it (ADR `peer-servers`): the last one connected
 * answers. Created next to the first plugin that connects, so a browser's request crosses Cloudflare's
 * network to the Minecraft server's side once, wherever the browser is. Stores only the address it
 * serves; plugin and browser WebSockets stay open while it hibernates.
 */
export class TunnelObject extends DurableObject<Env> {
  private readonly cfg: Config;
  private next = 1;
  private readonly http = new Map<number, HttpStream>();
  private readonly opening = new Map<number, Opening>();
  /** In memory, like TunnelLimits: a restart forgets it, which is fine for a cap that only makes abuse expensive. */
  private minute = 0;
  private requests = 0;
  private day = 0;
  private usedToday = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.cfg = config(env);
    for (const ws of ctx.getWebSockets()) {
      const tag = ws.deserializeAttachment() as PluginTag | BrowserTag | null;
      if (tag?.kind === "browser") this.next = Math.max(this.next, tag.stream + 1);
    }
  }

  /** Plugins connected here, oldest first. */
  private plugins(): { ws: WebSocket; tag: PluginTag }[] {
    return this.ctx.getWebSockets("plugin")
      .map((ws) => ({ ws, tag: ws.deserializeAttachment() as PluginTag }))
      .filter((p) => p.tag?.kind === "plugin")
      .sort((a, b) => a.tag.at - b.tag.at);
  }

  private plugin(key: string): WebSocket | null {
    return this.plugins().find((p) => p.tag.key === key)?.ws ?? null;
  }

  /** The plugin of [member] when a request names one, else the last connected. */
  private pick(member: string | null): { ws: WebSocket; tag: PluginTag } | null {
    const all = this.plugins();
    const found = member ? all.filter((p) => p.tag.member === member) : all;
    return found[found.length - 1] ?? null;
  }

  /** How many plugins hold this address: the Worker moves an address only when none does. */
  connected(): number {
    return this.plugins().length;
  }

  /** Every plugin of this address learns its address again: a name was taken or freed. */
  async hello(): Promise<void> {
    const plugins = this.plugins();
    if (plugins.length === 0) return;
    const id = plugins[0].tag.id;
    const name = await this.names().nameOf(id);
    const hello: Hello = { url: publicUrl(name ?? id, this.cfg), name, names: true };
    for (const { ws } of plugins) this.send(ws, encodeJson(T.HELLO, 0, hello));
  }

  private names() {
    return this.env.NAMES.get(this.env.NAMES.idFromName("names"));
  }

  async fetch(request: Request): Promise<Response> {
    return request.headers.get(`${INTERNAL}kind`) === "plugin" ? this.acceptPlugin(request) : this.browser(request);
  }

  private acceptPlugin(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (this.plugins().length >= MAX_PER_ID) {
      server.accept();
      server.close(4003, `too many servers on this address (${MAX_PER_ID})`);
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = request.headers.get(`${INTERNAL}id`)!;
    const tag: PluginTag = {
      kind: "plugin",
      key: crypto.randomUUID(),
      id,
      member: (request.headers.get(`${INTERNAL}member`) ?? "").slice(0, 64),
      address: request.headers.get(`${INTERNAL}address`) ?? "",
      at: Date.now(),
    };
    this.ctx.acceptWebSocket(server, ["plugin"]);
    server.serializeAttachment(tag);
    this.ctx.waitUntil((async () => {
      await this.hello();
      await this.names().seen(id);
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + DAY);
    })().catch((e) => console.error(`Tunnel ${id}: hello failed: ${e}`)));
    console.log(`Tunnel ${id} connected (${this.plugins().length} on this address)`);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** A held name does not expire while its address stays connected, even for months. */
  async alarm(): Promise<void> {
    const plugins = this.plugins();
    if (plugins.length === 0) return;
    await this.names().seen(plugins[0].tag.id);
    await this.ctx.storage.setAlarm(Date.now() + DAY);
  }

  private allowRequest(): boolean {
    const minute = Math.floor(Date.now() / 60_000);
    if (minute !== this.minute) { this.minute = minute; this.requests = 0; }
    if (this.overQuota()) return false;
    if (this.cfg.requestsPerMinute > 0 && this.requests >= this.cfg.requestsPerMinute) return false;
    this.requests++;
    return true;
  }

  private overQuota(): boolean {
    const day = Math.floor(Date.now() / DAY);
    if (day !== this.day) { this.day = day; this.usedToday = 0; }
    return this.cfg.bytesPerDay > 0 && this.usedToday >= this.cfg.bytesPerDay;
  }

  private consume(bytes: number): void {
    this.overQuota();
    this.usedToday += bytes;
  }

  private send(ws: WebSocket, data: ArrayBuffer): boolean {
    try {
      ws.send(data);
      return true;
    } catch {
      return false;
    }
  }

  private browser(request: Request): Promise<Response> | Response {
    const host = request.headers.get(`${INTERNAL}host`) ?? new URL(request.url).hostname;
    const picked = this.pick(request.headers.get("X-Artisan-Tunnel-Member"));
    if (!picked) return new Response(null, { status: 503, headers: { [ABSENT_HEADER]: "1" } });
    if (this.http.size + this.opening.size + this.ctx.getWebSockets().length - this.plugins().length >= this.cfg.maxStreams) {
      return textResponse(503, "Too many requests in flight for this server.");
    }
    if (!this.allowRequest()) return textResponse(429, "This server's editor is over its tunnel limits. Try again later.");
    const head: RequestHead = { method: request.method, path: pathAndQuery(request), headers: forwarded(request, this.cfg) };
    return request.headers.get("Upgrade")?.toLowerCase() === "websocket"
      ? this.openSocket(picked.ws, picked.tag.key, head)
      : this.proxy(request, picked.ws, picked.tag.key, head, host);
  }

  private async proxy(request: Request, ws: WebSocket, plugin: string, head: RequestHead, host: string): Promise<Response> {
    const stream = this.next++;
    let resolveHead!: (frame: Frame | null) => void;
    const answered = new Promise<Frame | null>((resolve) => { resolveHead = resolve; });
    const entry: HttpStream = { plugin, head: resolveHead, writer: null, early: [], ended: false, timer: null };
    this.http.set(stream, entry);
    const fail = () => { this.send(ws, encode(T.RESET, stream)); this.closeStream(stream); };
    try {
      this.send(ws, encodeJson(T.REQUEST, stream, head));
      if (request.body) {
        const reader = request.body.getReader();
        let total = 0;
        let chunk = new Uint8Array(CHUNK);
        let filled = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > this.cfg.maxBodyBytes) {
            fail();
            return textResponse(413, "Request too large for the tunnel server.");
          }
          this.consume(value.byteLength);
          let offset = 0;
          while (offset < value.byteLength) {
            const take = Math.min(CHUNK - filled, value.byteLength - offset);
            chunk.set(value.subarray(offset, offset + take), filled);
            filled += take;
            offset += take;
            if (filled === CHUNK) {
              this.send(ws, encode(T.REQUEST_BODY, stream, chunk));
              chunk = new Uint8Array(CHUNK);
              filled = 0;
            }
          }
        }
        if (filled > 0) this.send(ws, encode(T.REQUEST_BODY, stream, chunk.subarray(0, filled)));
      }
      this.send(ws, encode(T.REQUEST_END, stream));
    } catch (e) {
      fail();
      throw e;
    }

    this.arm(stream);
    const first = await answered;
    if (!first || first.type !== T.RESPONSE) {
      if (first === null && this.http.has(stream)) fail();
      this.closeStream(stream);
      return offlinePage(request, "no_answer", host);
    }
    const response = json<ResponseHead>(first);
    const headers = new Headers();
    for (const [name, value] of response.headers ?? []) {
      if (!HOP_BY_HOP.has(name.toLowerCase())) headers.append(name, value);
    }
    if (NULL_BODY.has(response.status) || request.method === "HEAD") {
      entry.early = [];
      if (entry.ended) this.closeStream(stream);
      return new Response(null, { status: response.status, headers });
    }
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    entry.writer = writable.getWriter();
    for (const bytes of entry.early) entry.writer.write(bytes).catch(() => {});
    entry.early = [];
    if (entry.ended) this.endStream(stream);
    return new Response(readable, { status: response.status, headers });
  }

  /** A stream the plugin goes quiet on for a minute is dropped, as on the Kotlin tunnel server. */
  private arm(stream: number): void {
    const entry = this.http.get(stream);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      const ws = this.plugin(entry.plugin);
      if (ws) this.send(ws, encode(T.RESET, stream));
      entry.head(null);
      entry.writer?.abort(new Error("tunnel stream timed out")).catch(() => {});
      this.closeStream(stream);
    }, RESPONSE_TIMEOUT_MS);
  }

  private endStream(stream: number): void {
    const entry = this.http.get(stream);
    entry?.writer?.close().catch(() => {});
    this.closeStream(stream);
  }

  private closeStream(stream: number): void {
    const entry = this.http.get(stream);
    if (entry?.timer) clearTimeout(entry.timer);
    this.http.delete(stream);
  }

  /**
   * A browser asks for a WebSocket: the plugin opens it on its own web port first, and the browser
   * gets the same answer (101, or the server's refusal).
   */
  private async openSocket(ws: WebSocket, plugin: string, head: RequestHead): Promise<Response> {
    const stream = this.next++;
    let answer!: (frame: Frame | null) => void;
    const answered = new Promise<Frame | null>((resolve) => { answer = resolve; });
    const opening: Opening = { plugin, answer, early: [] };
    this.opening.set(stream, opening);
    const timer = setTimeout(() => answer(null), OPEN_TIMEOUT_MS);
    this.send(ws, encodeJson(T.WS_OPEN, stream, head));
    const frame = await answered;
    clearTimeout(timer);
    this.opening.delete(stream);
    const opened = frame?.type === T.WS_OPENED ? json<ResponseHead>(frame) : null;
    if (!opened || opened.status !== 101) {
      if (frame === null) this.send(ws, encode(T.RESET, stream));
      const status = opened && opened.status >= 400 && opened.status <= 599 ? opened.status : 502;
      return textResponse(status, "The Artisan server refused the WebSocket.");
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [`b:${stream}`]);
    server.serializeAttachment({ kind: "browser", stream, plugin } satisfies BrowserTag);
    for (const early of opening.early) this.toBrowser(server, early);
    const headers = new Headers();
    const protocol = opened.headers?.find(([name]) => name.toLowerCase() === "sec-websocket-protocol");
    if (protocol) headers.set("Sec-WebSocket-Protocol", protocol[1]);
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  private browserSocket(stream: number): WebSocket | null {
    return this.ctx.getWebSockets(`b:${stream}`)[0] ?? null;
  }

  private toBrowser(socket: WebSocket, frame: Frame): void {
    try {
      if (frame.type === T.WS_TEXT) socket.send(text(frame));
      else if (frame.type === T.WS_BINARY) socket.send(frame.payload);
      else if (frame.type === T.WS_CLOSE) {
        const close = json<WsClose>(frame);
        socket.close(validCode(close.code), (close.reason ?? "").slice(0, 120));
      }
    } catch {
      // The browser left: its own close reaches the plugin.
    }
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const tag = ws.deserializeAttachment() as PluginTag | BrowserTag;
    if (tag.kind === "browser") return this.fromBrowser(tag, message);
    if (typeof message === "string") return;
    let frame: Frame;
    try {
      frame = decode(message);
    } catch {
      return;
    }
    switch (frame.type) {
      case T.RESPONSE:
      case T.RESPONSE_BODY:
      case T.RESPONSE_END:
      case T.RESET: {
        this.toStream(frame);
        this.opening.get(frame.stream)?.answer(frame);
        if (frame.type === T.RESET) this.browserSocket(frame.stream)?.close(1011, "server reset");
        break;
      }
      case T.WS_OPENED:
        this.opening.get(frame.stream)?.answer(frame);
        break;
      case T.WS_TEXT:
      case T.WS_BINARY:
      case T.WS_CLOSE: {
        this.consume(frame.payload.byteLength);
        const socket = this.browserSocket(frame.stream);
        if (socket) this.toBrowser(socket, frame);
        else this.opening.get(frame.stream)?.early.push(frame);
        break;
      }
      case T.NAME:
        await this.answerName(ws, tag, frame);
        break;
      default:
        break;
    }
  }

  private toStream(frame: Frame): void {
    const entry = this.http.get(frame.stream);
    if (!entry) return;
    if (frame.type === T.RESPONSE) {
      this.arm(frame.stream);
      entry.head(frame);
    } else if (frame.type === T.RESPONSE_BODY) {
      this.arm(frame.stream);
      this.consume(frame.payload.byteLength);
      // The payload is a view of the message: copied, since the runtime may reuse it.
      const bytes = frame.payload.slice();
      if (entry.writer) entry.writer.write(bytes).catch(() => {});
      else entry.early.push(bytes);
    } else if (frame.type === T.RESPONSE_END) {
      if (entry.writer) this.endStream(frame.stream);
      else entry.ended = true;
    } else {
      entry.head(null);
      entry.writer?.abort(new Error("server reset")).catch(() => {});
      this.closeStream(frame.stream);
    }
  }

  private fromBrowser(tag: BrowserTag, message: ArrayBuffer | string): void {
    const ws = this.plugin(tag.plugin);
    if (!ws) return;
    if (typeof message === "string") {
      const bytes = new TextEncoder().encode(message);
      this.consume(bytes.byteLength);
      this.send(ws, encode(T.WS_TEXT, tag.stream, bytes));
    } else {
      this.consume(message.byteLength);
      this.send(ws, encode(T.WS_BINARY, tag.stream, new Uint8Array(message)));
    }
  }

  private async answerName(ws: WebSocket, tag: PluginTag, frame: Frame): Promise<void> {
    let request: NameRequest;
    try {
      request = json<NameRequest>(frame);
    } catch {
      return;
    }
    const { result, changed } = await this.names().request(tag.id, request.name ?? "", request.check === true, tag.address);
    this.send(ws, encodeJson(T.NAME_RESULT, frame.stream, result));
    if (result.ok && !request.check && changed) await this.hello();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.closed(ws, code, reason);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.closed(ws, 1011, "error");
  }

  private closed(ws: WebSocket, code: number, reason: string): void {
    const tag = ws.deserializeAttachment() as PluginTag | BrowserTag | null;
    if (!tag) return;
    if (tag.kind === "browser") {
      const plugin = this.plugin(tag.plugin);
      if (plugin) this.send(plugin, encodeJson(T.WS_CLOSE, tag.stream, { code, reason } satisfies WsClose));
      return;
    }
    console.log(`Tunnel ${tag.id} disconnected (${this.plugins().length - 1} left on this address)`);
    for (const [stream, entry] of [...this.http]) {
      if (entry.plugin !== tag.key) continue;
      entry.head(null);
      entry.writer?.abort(new Error("server disconnected")).catch(() => {});
      this.closeStream(stream);
    }
    for (const opening of this.opening.values()) if (opening.plugin === tag.key) opening.answer(null);
    for (const socket of this.ctx.getWebSockets()) {
      const other = socket.deserializeAttachment() as PluginTag | BrowserTag | null;
      if (other?.kind === "browser" && other.plugin === tag.key) {
        try { socket.close(1001, "server disconnected"); } catch { /* already gone */ }
      }
    }
  }
}

function validCode(code: number): number {
  return code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 && code !== 1015 ? code : 1000;
}

function pathAndQuery(request: Request): string {
  const url = new URL(request.url);
  return url.pathname + url.search;
}

/**
 * The browser's headers as sent, `Host` and `Origin` included, plus where the request came from and
 * the scheme the browser used: the hub marks its session cookie `Secure` from it.
 */
function forwarded(request: Request, cfg: Config): HeaderList {
  const out: HeaderList = [["Host", request.headers.get(`${INTERNAL}host`) ?? new URL(request.url).host]];
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (lower === "host" || HOP_BY_HOP.has(lower) || lower.startsWith("x-forwarded-") || lower.startsWith(INTERNAL)) continue;
    out.push([name, value]);
  }
  out.push(["X-Forwarded-For", request.headers.get("CF-Connecting-IP") ?? ""]);
  out.push(["X-Forwarded-Proto", cfg.scheme]);
  return out;
}
