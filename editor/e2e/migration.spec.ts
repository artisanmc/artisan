import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type {
	MigrationProposal,
	MigrationRun,
} from "../src/lib/api/assistantMigration";
const canonical = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.keys(value)
			.sort()
			.map(
				(key) =>
					`${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
			)
			.join(",")}}`;
	return JSON.stringify(value);
};
const proposals: MigrationProposal[] = Array.from({ length: 35 }, (_, i) => {
	const menu = {
		schema: "menu/v1",
		id: `m${i}`,
		title: `Menu ${i}`,
		size: 9,
		elements: [
			{
				id: "next",
				positions: "0",
				material: "STONE",
				title: "Next menu",
				click: { left: `open_menu m${(i + 1) % 35}` },
			},
		],
	};
	return {
		id: `proposal${i}`,
		stepId: `step${i}`,
		targetId: menu.id,
		baseHash: null,
		resultHash: createHash("sha256").update(canonical(menu)).digest("hex"),
		menu,
		issues: [],
	};
});
test("35 connected menus survive interruption, browser reload, explicit resume and conflict-safe draft application", async ({
	page,
}, testInfo) => {
	let run: MigrationRun | undefined;
	let generated = 0;
	let offline = false;
	let starts = 0;
	let resumes = 0;
	let creations = 0;
	let interruptedReads = 0;
	const unexpected: string[] = [];
	await page.routeWebSocket("**", (socket) => socket.close());
	await page.route("**/*", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (
			url.origin === "http://127.0.0.1:5183" &&
			!url.pathname.startsWith("/api/")
		) {
			await route.continue();
			return;
		}
		const base = "/api/v1/assistant/conversations/c/migrations";
		if (
			url.origin !== "http://localhost:3001" ||
			!url.pathname.startsWith(base)
		) {
			unexpected.push(`${request.method()} ${url}`);
			await route.abort();
			return;
		}
		if (offline && request.method() === "GET") {
			interruptedReads++;
			await route.abort();
			return;
		}
		const path = url.pathname.slice(base.length);
		if (request.method() === "POST" && path === "") {
			creations++;
			const body = request.postDataJSON();
			expect(body.serverAttachments[0].paths).toHaveLength(35);
			expect(body.maxCredits).toBe(100);
			run = {
				id: "r",
				conversationId: "c",
				projectId: "p",
				modelId: "model",
				revision: 0,
				status: "ready",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				budget: {
					maxCredits: 100,
					usedCredits: 0,
					contextTokens: 64000,
					maxOutputTokens: 8000,
				},
				manifest: { version: 1, hash: "manifest", entries: [], issues: [] },
				steps: proposals.map((p, i) => ({
					id: p.stepId,
					key: p.stepId,
					sourceFileId: `server:zmenu/menus/m${i}.yml`,
					targetId: p.targetId,
					status: "pending",
					attemptCount: 0,
					proposalId: null,
					credits: 0,
				})),
				issues: [],
			};
			await route.fulfill({ json: { run }, status: 201 });
			return;
		}
		if (
			request.method() === "POST" &&
			run &&
			(path === "/r/start" || path === "/r/resume")
		) {
			expect(request.postDataJSON().expectedRevision).toBe(run.revision);
			if (path.endsWith("start")) {
				starts++;
				generated = 7;
				run.status = "paused";
			} else {
				resumes++;
				generated = 35;
				run.status = "completed";
			}
			run.revision++;
			run.budget.usedCredits = generated;
			run.steps = run.steps.map((s, i) =>
				i < generated
					? {
							...s,
							status: "completed",
							proposalId: `proposal${i}`,
							attemptCount: 1,
							credits: 1,
						}
					: s,
			);
			await route.fulfill({ json: { run } });
			return;
		}
		if (request.method() === "GET") {
			if (path === "") {
				await route.fulfill({ json: { runs: run ? [run] : [] } });
				return;
			}
			if (path === "/r") {
				await route.fulfill({ json: { run } });
				return;
			}
			if (path === "/r/proposals") {
				await route.fulfill({
					json: { proposals: proposals.slice(0, generated) },
				});
				return;
			}
			if (path === "/r/events") {
				await route.fulfill({
					json: {
						events:
							generated === 7
								? [
										{
											sequence: 1,
											runId: "r",
											type: "step_interrupted",
											code: "provider_timeout",
											createdAt: new Date().toISOString(),
										},
									]
								: [],
					},
				});
				return;
			}
		}
		unexpected.push(`${request.method()} ${path}`);
		await route.abort();
	});
	await page.goto("/");
	await page
		.getByRole("button", { name: "Migrate this selection", exact: true })
		.click();
	await page
		.getByRole("spinbutton", { name: "Accepted budget (credits)" })
		.fill("100");
	await page
		.getByRole("button", { name: "Analyze selection", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Start migration", exact: true })
		.click();
	await expect(
		page.getByText("7 / 35 generated · 0 applied to this draft", {
			exact: true,
		}),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Apply available results", exact: true })
		.click();
	await expect(page.getByTestId("menu-count")).toHaveText("7 menus in draft");
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Object.keys(
						JSON.parse(localStorage.getItem("artisan.projectDrafts") ?? "{}")
							.state?.drafts?.p?.tree ?? {},
					).filter((p) => p.startsWith("menus/")).length,
			),
		)
		.toBe(7);
	await page.screenshot({
		path: testInfo.outputPath("migration-paused.png"),
		fullPage: true,
	});
	offline = true;
	await expect
		.poll(() => interruptedReads, { timeout: 10000 })
		.toBeGreaterThan(0);
	offline = false;
	await page.reload();
	await expect(page.getByTestId("menu-count")).toHaveText("7 menus in draft");
	await expect(
		page.getByText("7 / 35 generated · 7 applied to this draft", {
			exact: true,
		}),
	).toBeVisible();
	expect(starts).toBe(1);
	expect(resumes).toBe(0);
	expect(creations).toBe(1);
	await page.getByRole("button", { name: "Edit first menu locally" }).click();
	await page
		.getByRole("button", { name: "Resume migration", exact: true })
		.click();
	await expect(
		page.getByText("35 / 35 generated · 6 applied to this draft", {
			exact: true,
		}),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Apply available results", exact: true })
		.click();
	await expect(page.getByTestId("menu-count")).toHaveText("35 menus in draft");
	await expect(page.getByTestId("local-edit")).toHaveText(
		"LOCAL EDIT MUST SURVIVE",
	);
	await expect(
		page.getByText("Local changes — not overwritten", { exact: false }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Apply available results", exact: true }),
	).toBeDisabled();
	expect(starts).toBe(1);
	expect(resumes).toBe(1);
	expect(unexpected).toEqual([]);
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await expect(page.getByText("Working…", { exact: true })).toHaveCount(0);
	await page.screenshot({
		path: testInfo.outputPath("migration-completed-mobile.png"),
		fullPage: true,
	});
});
