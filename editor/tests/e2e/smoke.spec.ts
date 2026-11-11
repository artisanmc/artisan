import { expect, test } from "@playwright/test";

// Runs against `npm run dev` with no hub behind it: every API call answers 401,
// as the hub does without a session. The app must boot, route, and land an
// anonymous visitor on /login.
test("anonymous visitor lands on the sign-in page", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.addInitScript(() => window.localStorage.clear());
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"error":"unauthorized"}',
      }),
  );

  await page.goto("/servers");

  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(page.getByText("/artisan editor", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
