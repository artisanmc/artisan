import { expect, test } from "@playwright/test";

test("background activity survives reload; only Stop sends a cancellation", async ({
  page,
}, testInfo) => {
  let stops = 0;
  const task = {
    id: "task",
    conversationId: "c",
    message: "Migrate these 35 connected menus into Artisan.",
    status: "running",
    createdAt: new Date(Date.now() - 75000).toISOString(),
    updatedAt: new Date().toISOString(),
    events: [
      { type: "accepted", messageOffset: 0 },
      {
        type: "activity",
        name: "read_source",
        target: "menus/shop.yml",
        at: new Date(Date.now() - 45000).toISOString(),
      },
      {
        type: "reasoning",
        text: "I will preserve the shared navigation and check the target menu links before proposing changes.",
        at: new Date(Date.now() - 40000).toISOString(),
      },
      {
        type: "text",
        text: "The shared navigation is identified. Preparing the shop menu and its dependencies.",
        at: new Date(Date.now() - 35000).toISOString(),
      },
      {
        type: "activity",
        name: "menu_completed",
        target: "main",
        at: new Date(Date.now() - 30000).toISOString(),
      },
      {
        type: "activity",
        name: "read_source",
        target: "menus/shop.yml",
        at: new Date(Date.now() - 20000).toISOString(),
      },
    ],
  };
  const writes: string[] = [];
  await page.route("**/api/v1/assistant/conversations/c/tasks**", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().url());
      stops++;
      task.status = "cancelled";
      await route.fulfill({ json: { task } });
    } else await route.fulfill({ json: { tasks: [task] } });
  });
  await page.goto("/?tasks");
  await expect(page.getByText(task.message)).toBeVisible();
  await expect(
    page.getByText("The shared navigation is identified.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  expect(stops).toBe(0);
  await page.getByText("Model reasoning", { exact: true }).click();
  await expect(
    page.getByText("I will preserve the shared navigation", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("assistant-task-running.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toContain("/tasks/task/stop");
  await page.screenshot({
    path: testInfo.outputPath("assistant-task-stopped.png"),
    fullPage: true,
  });
});
