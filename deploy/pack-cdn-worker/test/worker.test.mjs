// The Worker on a local bucket (wrangler dev, test/wrangler.test.jsonc): `npm test`. Each run starts
// from an empty bucket and empty quotas.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = "http://127.0.0.1:8788";
let worker;
let state;
/** What the Worker posted to PACK_ALERT_WEBHOOK. */
const alerts = [];
const webhook = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => { alerts.push(JSON.parse(body).content); res.end(); });
});

before(async () => {
  await new Promise((r) => webhook.listen(8789, "127.0.0.1", r));
  state = mkdtempSync(join(tmpdir(), "pack-cdn-"));
  worker = spawn("npx", ["wrangler", "dev", "-c", "test/wrangler.test.jsonc", "--ip", "127.0.0.1", "--port", "8788", "--persist-to", state], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  let log = "";
  worker.stdout.on("data", (d) => { log += d; });
  worker.stderr.on("data", (d) => { log += d; });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev did not start:\n${log}`);
});

after(() => {
  webhook.close();
  if (worker) process.kill(-worker.pid, "SIGTERM");
  rmSync(state, { recursive: true, force: true });
});

/** A stored (uncompressed) zip of [files], enough for the Worker's reading of its central directory. */
function zip(files) {
  const locals = [];
  const entries = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    entries.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(entries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const sha1 = (bytes) => createHash("sha1").update(bytes).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const pack = (extra = "") => zip({
  "pack.mcmeta": `{"pack":{"pack_format":46,"description":"test${extra}"}}`,
  "assets/minecraft/textures/item/stick.png": randomBytes(2000),
});

function put(body, auth, hash = sha1(body)) {
  return fetch(`${base}/resource-pack/${hash}.zip`, { method: "PUT", body, headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
}

function touch(hash, auth) {
  return fetch(`${base}/resource-pack/${hash}.zip`, { method: "POST", headers: { Authorization: `Bearer ${auth}` } });
}

test("a pack goes up once and comes back byte for byte", async () => {
  const hub = secret();
  const body = pack();
  const hash = sha1(body);
  const first = await put(body, hub);
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { url: `${base}/resource-pack/${hash}.zip`, hash, stored: true });

  const download = await fetch(`${base}/resource-pack/${hash}.zip`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/zip");
  assert.match(download.headers.get("cache-control"), /immutable/);
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  assert.equal(sha1(Buffer.from(await download.arrayBuffer())), hash);

  const head = await fetch(`${base}/resource-pack/${hash}.zip`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(body.length));

  // Another hub with the same pack: nothing stored twice.
  const again = await put(body, secret());
  assert.equal(again.status, 200);
  assert.equal((await again.json()).stored, false);
});

test("touch answers 404 for an unknown pack and the url for a known one", async () => {
  const hub = secret();
  const body = pack("touch");
  const hash = sha1(body);
  assert.equal((await touch(hash, hub)).status, 404);
  assert.equal((await put(body, hub)).status, 201);
  const known = await touch(hash, hub);
  assert.equal(known.status, 200);
  assert.equal((await known.json()).url, `${base}/resource-pack/${hash}.zip`);
  // PACK_REFRESH_DAYS is 0 here: the touch rewrote the pack in place, unchanged.
  const download = await fetch(`${base}/resource-pack/${hash}.zip`);
  assert.equal(sha1(Buffer.from(await download.arrayBuffer())), hash);
});

test("refusals", async () => {
  const hub = secret();
  const body = pack("refused");
  assert.equal((await put(body, null)).status, 401, "no secret");
  assert.equal((await put(body, "short")).status, 401, "short secret");
  assert.equal((await put(body, hub, sha1(Buffer.from("other")))).status, 422, "SHA-1 of something else");
  assert.equal((await fetch(`${base}/resource-pack/${sha1(Buffer.from("other"))}.zip`)).status, 404, "nothing kept");

  const notAPack = zip({ "readme.txt": "hello", "virus.exe": randomBytes(500) });
  assert.equal((await put(notAPack, secret())).status, 422, "zip without pack.mcmeta");
  assert.equal((await fetch(`${base}/resource-pack/${sha1(notAPack)}.zip`)).status, 404);

  const nested = zip({ "sub/pack.mcmeta": "{}" });
  assert.equal((await put(nested, secret())).status, 422, "pack.mcmeta not at the root");

  const html = Buffer.from("<html><script>alert(1)</script></html>".repeat(4));
  assert.equal((await put(html, secret())).status, 422, "not a zip");

  const huge = Buffer.alloc(9 * 1024 * 1024);
  assert.equal((await put(huge, secret())).status, 413, "over PACK_MAX_MB");

  assert.equal((await fetch(`${base}/resource-pack/nothex.zip`)).status, 404);
  assert.equal((await fetch(`${base}/resource-pack/${sha1(body)}.zip`, { method: "DELETE" })).status, 405);
});

test("a server's daily quota", async () => {
  const hub = secret();
  // PACK_SERVER_UPLOADS_PER_DAY is 6 in test/wrangler.test.jsonc.
  for (let i = 0; i < 6; i++) assert.equal((await put(pack(`quota${i}`), hub)).status, 201, `upload ${i}`);
  const refused = await put(pack("quota-over"), hub);
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get("retry-after")) > 0);
  // Another server is not affected.
  assert.equal((await put(pack("quota-other"), secret())).status, 201);
});

test("an admin takes a pack down", async () => {
  const body = pack("takedown");
  const hash = sha1(body);
  assert.equal((await put(body, secret())).status, 201);
  const url = `${base}/admin/resource-pack/${hash}.zip`;
  assert.equal((await fetch(url, { method: "DELETE", headers: { Authorization: "Bearer wrong" } })).status, 401);
  const done = await fetch(url, { method: "DELETE", headers: { Authorization: "Bearer admin-token" } });
  assert.equal(done.status, 200);
  assert.equal((await done.json()).deleted, true);
  assert.equal((await fetch(`${base}/resource-pack/${hash}.zip`)).status, 404);
});

// Last: it uses up the global quota (PACK_GLOBAL_DAILY_MB is 2 here).
test("the global quota alerts at half, then when it refuses", async () => {
  const big = (tag) => zip({ "pack.mcmeta": `{"pack":{"pack_format":46,"description":"${tag}"}}`, "big.bin": randomBytes(1100 * 1024) });
  assert.equal((await put(big("half"), secret())).status, 201);
  await waitFor(() => alerts.length >= 1);
  assert.match(alerts[0], /of 2 MB uploaded today/);

  assert.equal((await put(big("full"), secret())).status, 429);
  await waitFor(() => alerts.length >= 2);
  assert.match(alerts[1], /daily quota of 2 MB reached/);

  // Once a day each.
  assert.equal((await put(big("again"), secret())).status, 429);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(alerts.length, 2);
});

async function waitFor(condition) {
  for (let i = 0; i < 50 && !condition(); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(condition(), "timed out");
}
