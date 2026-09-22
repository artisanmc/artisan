import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
const state = JSON.parse(await readFile("../backend/.phase5-local-state.json", "utf8"));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addCookies([
  { name: "artisan_user_session", value: state.session, domain: "localhost", path: "/" },
]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(
  `http://localhost:5173/networks/${state.server.networkId}/projects/${state.source.id}`,
);
await page.waitForTimeout(3000);
console.log((await page.locator("body").innerText()).slice(0, 10000));
if (!(await page.locator("body").innerText()).includes("2\n+ Nouveau projet")) {
  await page.getByRole("button", { name: "Nouveau menu", exact: true }).click();
  await page.waitForTimeout(500);
  console.log("AFTER CREATE", (await page.locator("body").innerText()).slice(-8000));
  console.log(
    "INPUTS",
    await page
      .locator("input")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({ placeholder: n.placeholder, type: n.type, value: n.value })),
      ),
  );
  await page.getByPlaceholder("my_menu").fill("ui_copy_menu");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
}
await page.waitForTimeout(1800);
await page.reload();
await page.waitForTimeout(1800);
console.log("RELOADED", (await page.locator("body").innerText()).slice(-6000));
await page.getByRole("button", { name: "Copier vers Minecraft", exact: true }).click();
await page.waitForTimeout(1000);
console.log("COPY DIALOG", (await page.locator("body").innerText()).slice(-6000));
await page
  .locator("select")
  .filter({ has: page.locator(`option[value="${state.server.id}"]`) })
  .selectOption(state.server.id, { timeout: 30000 });
await page.getByLabel("DOSSIER DU PROJET", { exact: false }).fill(`${state.id}_ui`);
await page.getByLabel("Appliquer mon brouillon, puis copier", { exact: true }).check();
await page.getByRole("button", { name: "Appliquer et copier", exact: true }).click();
await page.waitForURL(/\/servers\/.+\/projects\//, { timeout: 60000 });
console.log("COPIED UI", page.url());
await page.screenshot({
  path: "../.scratch/phase5-integration-20260913/hosted-ui.png",
  fullPage: true,
});
await writeFile("../.scratch/phase5-integration-20260913/ui-errors.json", JSON.stringify(errors));
await browser.close();
