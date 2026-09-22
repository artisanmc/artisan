import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const s = JSON.parse(await readFile("../backend/.phase5-local-state.json", "utf8"));
const b = await chromium.launch({ headless: true });
const c = await b.newContext();
await c.addCookies([
  { name: "artisan_user_session", value: s.session, domain: "localhost", path: "/" },
]);
const p = await c.newPage();
await p.goto(
  "http://localhost:5173/networks/net_47909109799a/servers/srv_4b613417afd1/projects/copy_a29caeeba058cb9b8c6f91f8e06fd957?tab=overview",
);
await expect(p.locator("canvas").first()).toBeVisible({ timeout: 60000 });
await expect(p.getByText("Lecture des fichiers du serveur…", { exact: true })).toHaveCount(0);
await p.screenshot({
  path: "../.scratch/phase5-integration-20260913/server-copy-loaded.png",
  fullPage: true,
});
console.log("Loaded canvas verified", await p.locator("canvas").count());
console.log((await p.locator("body").innerText()).slice(-3000));
await b.close();
