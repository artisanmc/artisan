import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import {
	aiModels,
	assistantConversations,
	memberships,
	networks,
	projects,
	serverKeys,
	users,
} from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { generateServerKey } from "../../lib/auth";
import { saveConversation } from "./conversationRepo";
import { grantCredits } from "../ai/creditsRepo";
import { createModel, setDefaultModel } from "../ai/modelRepo";
import type { LlmProvider, LlmStreamEvent } from "./provider/types";
import { ATTACHMENT_NOTE_PREFIX, __setProviderForTests } from "./routes";

const validMenu = {
	schema: "menu/v1",
	id: "shop",
	title: [{ kind: "plain", value: { key: "k" } }],
	size: 27,
	layers: [
		{
			id: "l1",
			name: "d",
			elements: [
				{ id: "e1", positions: "0", material: "STONE" },
			],
		},
	],
};

const scripted: LlmStreamEvent[][] = [
	[
		{
			type: "tool_use",
			id: "c1",
			name: "upsert_menu",
			input: { menu: validMenu },
		},
		{ type: "done", stopReason: "tool_calls" },
	],
	[
		{ type: "text", text: "Created the shop." },
		{ type: "done", stopReason: "end_turn" },
	],
];
function fakeProvider(): LlmProvider {
	let i = 0;
	return {
		async *streamTurn() {
			const t = scripted[i++] ?? [{ type: "done", stopReason: "end_turn" }];
			for (const e of t) yield e;
		},
	};
}

// Minimal fixtures in the test DB for the cookie-auth (web login) path.
const PACK_ID = "pack_test_assistant";
const USER_ID = "usr_test_assistant";
let networkId = "";
let userSessionId = "";

beforeAll(async () => {
	const network = await createNetwork("assistant-test-network");
	networkId = network.id;
	const { id: serverKeyId, hash } = await generateServerKey();
	await db
		.insert(serverKeys)
		.values({ id: serverKeyId, hash, label: "assistant-test", networkId, createdAt: new Date() })
		.onConflictDoNothing();
	// The turn now debits the network of the conversation's project → the
	// project must exist, the catalog must hold an active default model, and
	// the network needs a positive balance.
	await db
		.insert(projects)
		.values({
			id: PACK_ID,
			networkId,
			serverKeyId,
			name: "Assistant Test Project",
			hash: "",
			filesJson: "{}",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.onConflictDoNothing();
	const testModel = await createModel({
		displayName: "Routes Test Model",
		description: "",
		badge: "balanced",
		provider: "openai",
		providerModelId: "test-model",
		creditsPerMInput: 1000,
		creditsPerMOutput: 2000,
		realUsdPerMInput: 0,
		realUsdPerMOutput: 0,
		isActive: true,
	});
	await setDefaultModel(testModel.id);
	await grantCredits({ networkId, amount: 100_000 });
	await db
		.insert(users)
		.values({
			id: USER_ID,
			email: "assistant-cookie-test@example.com",
			name: "Assistant Cookie Test",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.onConflictDoNothing();
	await db
		.insert(memberships)
		.values({ id: "mem_test_assistant", userId: USER_ID, networkId, role: "owner", createdAt: new Date() })
		.onConflictDoNothing();
	userSessionId = (await createSession(USER_ID)).id;
	__setProviderForTests(fakeProvider());
});

afterAll(async () => {
	__setProviderForTests(null);
	await db
		.delete(assistantConversations)
		.where(eq(assistantConversations.projectId, PACK_ID));
	await db.delete(users).where(eq(users.id, USER_ID)); // cascades userSessions
	await db.delete(aiModels);
	if (networkId) await db.delete(networks).where(eq(networks.id, networkId));
});

function cookieHeader() {
	return {
		Cookie: `artisan_user_session=${userSessionId}`,
		"Content-Type": "application/json",
	};
}

describe("assistant routes", () => {
	it("401 without a valid session", async () => {
		const res = await app.request("/api/v1/assistant/conversations", {
			method: "POST",
			body: "{}",
			headers: { "Content-Type": "application/json" },
		});
		expect(res.status).toBe(401);
	});

	it("accepts the projectId wire name (project→project rename) on create and list", async () => {
		// The editor sends { projectId } since the wire flip — projectId is the
		// legacy alias. Reading only projectId made every create 404 and the
		// assistant UI show "Interrompu" on the very first message.
		const created = await app.request("/api/v1/assistant/conversations", {
			method: "POST",
			headers: cookieHeader(),
			body: JSON.stringify({ projectId: PACK_ID }),
		});
		expect(created.status).toBe(200);
		const { conversationId } = await created.json();
		expect(typeof conversationId).toBe("string");

		const listed = await app.request(
			`/api/v1/assistant/conversations?projectId=${PACK_ID}`,
			{ headers: cookieHeader() },
		);
		expect(listed.status).toBe(200);
		const { conversations } = await listed.json();
		expect(conversations.some((c: { id: string }) => c.id === conversationId)).toBe(true);
	});

	it("creates a conversation and streams engine events for a message", async () => {
		const created = await app.request("/api/v1/assistant/conversations", {
			method: "POST",
			headers: cookieHeader(),
			body: JSON.stringify({ projectId: PACK_ID }),
		});
		expect(created.status).toBe(200);
		const { conversationId } = await created.json();
		expect(typeof conversationId).toBe("string");

		const res = await app.request(
			`/api/v1/assistant/conversations/${conversationId}/messages`,
			{
				method: "POST",
				headers: cookieHeader(),
				body: JSON.stringify({ text: "make a shop" }),
			},
		);
		expect(res.status).toBe(200);
		const sse = await res.text();
		expect(sse).toContain("event: menu_written");
		expect(sse).toContain("event: done");
	});

	it("persists the transcript: lists the conversation and resumes its messages", async () => {
		const created = await app.request("/api/v1/assistant/conversations", {
			method: "POST",
			headers: cookieHeader(),
			body: JSON.stringify({ projectId: PACK_ID }),
		});
		const { conversationId } = await created.json();
		const sent = await app.request(
			`/api/v1/assistant/conversations/${conversationId}/messages`,
			{
				method: "POST",
				headers: cookieHeader(),
				body: JSON.stringify({ text: "build a kit menu" }),
			},
		);
		expect(sent.status).toBe(200);
		await sent.text(); // drain the stream so the persistence (finally) runs

		// Listed for the workspace, titled from the first user message.
		const listed = await app.request(
			`/api/v1/assistant/conversations?projectId=${PACK_ID}`,
			{
				headers: cookieHeader(),
			},
		);
		expect(listed.status).toBe(200);
		const { conversations } = await listed.json();
		const row = conversations.find(
			(x: { id: string }) => x.id === conversationId,
		);
		expect(row).toBeTruthy();
		expect(row.title).toBe("build a kit menu");

		// Resumable: the transcript includes the user message.
		const one = await app.request(
			`/api/v1/assistant/conversations/${conversationId}`,
			{
				headers: cookieHeader(),
			},
		);
		expect(one.status).toBe(200);
		const conv = await one.json();
		expect(
			conv.messages.some(
				(m: { role: string; content?: string }) =>
					m.role === "user" && m.content === "build a kit menu",
			),
		).toBe(true);
	});

	it("tells the model which files are attached (system note before the user message)", async () => {
		// Capture the exact messages the provider receives.
		let seen: { role: string; content: string | null }[] = [];
		__setProviderForTests({
			async *streamTurn({ messages }) {
				seen = messages.map((m) => ({
					role: m.role,
					content: "content" in m ? (m.content as string | null) : null,
				}));
				yield { type: "text", text: "ok" };
				yield { type: "done", stopReason: "end_turn" };
			},
		});
		try {
			const created = await app.request("/api/v1/assistant/conversations", {
				method: "POST",
				headers: cookieHeader(),
				body: JSON.stringify({ projectId: PACK_ID }),
			});
			const { conversationId } = await created.json();
			const res = await app.request(
				`/api/v1/assistant/conversations/${conversationId}/messages`,
				{
					method: "POST",
					headers: cookieHeader(),
					body: JSON.stringify({
						text: "migre ces fichiers",
						attachments: { "menu.yml": "size: 54", "kits.yml": "size: 27" },
					}),
				},
			);
			expect(res.status).toBe(200);
			await res.text();

			const sysIdx = seen.findIndex(
				(m) =>
					m.role === "system" &&
					!!m.content?.includes("menu.yml") &&
					!!m.content?.includes("kits.yml"),
			);
			const userIdx = seen.findIndex(
				(m) => m.role === "user" && m.content === "migre ces fichiers",
			);
			expect(sysIdx).toBeGreaterThan(0); // present, and not the head system prompt
			expect(userIdx).toBeGreaterThan(sysIdx); // announced before the user message
			expect(seen[sysIdx]?.content).toContain("read_attachment");

			// No attachments → no extra system note for that turn.
			const res2 = await app.request(
				`/api/v1/assistant/conversations/${conversationId}/messages`,
				{
					method: "POST",
					headers: cookieHeader(),
					body: JSON.stringify({ text: "merci" }),
				},
			);
			await res2.text();
			const notes = seen.filter(
				(m, i) => i > 0 && m.role === "system" && m.content?.includes("read_attachment"),
			);
			expect(notes.length).toBe(1);
		} finally {
			__setProviderForTests(fakeProvider());
		}
	});

	it("titles a text-less first message from its attachment names", async () => {
		const created = await app.request("/api/v1/assistant/conversations", {
			method: "POST",
			headers: cookieHeader(),
			body: JSON.stringify({ projectId: PACK_ID }),
		});
		const { conversationId } = await created.json();
		const res = await app.request(
			`/api/v1/assistant/conversations/${conversationId}/messages`,
			{
				method: "POST",
				headers: cookieHeader(),
				body: JSON.stringify({
					text: "",
					attachments: { "menu.yml": "size: 54", "kits.yml": "size: 27" },
				}),
			},
		);
		expect(res.status).toBe(200);
		await res.text();

		const listed = await app.request(
			`/api/v1/assistant/conversations?projectId=${PACK_ID}`,
			{ headers: cookieHeader() },
		);
		const { conversations } = await listed.json();
		const row = conversations.find(
			(x: { id: string }) => x.id === conversationId,
		);
		expect(row.title).toBe("menu.yml, kits.yml");
	});

	it("passes commands from the request body into the working copy", async () => {
		// Turn 1: the model calls list_commands. Turn 2: capture the messages so we
		// can read the tool result the loop appended (successful tool results don't
		// surface in the streamed `tool` event, only in the tool message history).
		let toolResult: string | null = null;
		let i = 0;
		__setProviderForTests({
			async *streamTurn({ messages }) {
				if (i++ === 0) {
					yield { type: "tool_use", id: "lc1", name: "list_commands", input: {} };
					yield { type: "done", stopReason: "tool_calls" };
					return;
				}
				const toolMsg = messages.find(
					(m) => m.role === "tool" && "toolCallId" in m && m.toolCallId === "lc1",
				);
				toolResult =
					toolMsg && "content" in toolMsg ? (toolMsg.content as string) : null;
				yield { type: "text", text: "Found the commands." };
				yield { type: "done", stopReason: "end_turn" };
			},
		});
		try {
			const created = await app.request("/api/v1/assistant/conversations", {
				method: "POST",
				headers: cookieHeader(),
				body: JSON.stringify({ projectId: PACK_ID }),
			});
			const { conversationId } = await created.json();
			const res = await app.request(
				`/api/v1/assistant/conversations/${conversationId}/messages`,
				{
					method: "POST",
					headers: cookieHeader(),
					body: JSON.stringify({
						text: "what commands exist?",
						commands: [{ schema: "command/v1", id: "heal", name: "heal" }],
					}),
				},
			);
			expect(res.status).toBe(200);
			await res.text();

			expect(toolResult).toBeTruthy();
			expect(toolResult).toContain("heal");
		} finally {
			__setProviderForTests(fakeProvider());
		}
	});

	it("strips a stale grounding system message and injects fresh grounding", async () => {
		// Seed a conversation whose persisted transcript already has a stale
		// grounding system message at index 0, as if created before the per-turn
		// grounding migration (commit bc787f28). We create the conversation via the
		// API then mutate its stored messages directly via saveConversation.
		const created = await app.request("/api/v1/assistant/conversations", {
			method: "POST",
			headers: cookieHeader(),
			body: JSON.stringify({ projectId: PACK_ID }),
		});
		const { conversationId } = await created.json();

		// Inject a stale grounding message as if it were persisted by an old build.
		await saveConversation(
			conversationId,
			[{ role: "system", content: "OLD GROUNDING — stale" }],
			"",
		);

		// Capture the messages the provider actually receives.
		let receivedMessages: { role: string; content: unknown }[] = [];
		__setProviderForTests({
			async *streamTurn({ messages }) {
				receivedMessages = messages.map((m) => ({
					role: m.role,
					content: "content" in m ? m.content : null,
				}));
				yield { type: "text", text: "ok" };
				yield { type: "done", stopReason: "end_turn" };
			},
		});
		try {
			const res = await app.request(
				`/api/v1/assistant/conversations/${conversationId}/messages`,
				{
					method: "POST",
					headers: cookieHeader(),
					body: JSON.stringify({ text: "hello" }),
				},
			);
			expect(res.status).toBe(200);
			await res.text();

			// The stale grounding must not appear anywhere in what the provider saw.
			const stalePresent = receivedMessages.some(
				(m) =>
					typeof m.content === "string" &&
					m.content.includes("OLD GROUNDING — stale"),
			);
			expect(stalePresent).toBe(false);

			// runTurn prepends the FRESH grounding as messages[0] via the `system`
			// param — so there is exactly one system message, and it is the fresh one.
			const systemMessages = receivedMessages.filter((m) => m.role === "system");
			expect(systemMessages.length).toBe(1);
			// The fresh grounding is not the stale content.
			expect(typeof systemMessages[0]?.content).toBe("string");
			expect((systemMessages[0]?.content as string).includes("OLD GROUNDING")).toBe(false);
		} finally {
			__setProviderForTests(fakeProvider());
		}
	});

	it("does not leak a conversation owned by another user", async () => {
		const created = await app.request("/api/v1/assistant/conversations", {
			method: "POST",
			headers: cookieHeader(),
			body: JSON.stringify({ projectId: PACK_ID }),
		});
		const { conversationId } = await created.json();

		// A second user, also a member of the network, tries to access the first
		// user's conversation — ownerKey differs (`user:<id>`) → 404.
		const otherId = "usr_test_assistant_other";
		await db.insert(users).values({
			id: otherId, email: "assistant-other@example.com", name: "Other", createdAt: new Date(), updatedAt: new Date(),
		}).onConflictDoNothing();
		await db.insert(memberships).values({
			id: "mem_test_assistant_other", userId: otherId, networkId, role: "owner", createdAt: new Date(),
		}).onConflictDoNothing();
		const otherSessionId = (await createSession(otherId)).id;
		try {
			const res = await app.request(
				`/api/v1/assistant/conversations/${conversationId}/messages`,
				{
					method: "POST",
					headers: { Cookie: `artisan_user_session=${otherSessionId}`, "Content-Type": "application/json" },
					body: JSON.stringify({ text: "x" }),
				},
			);
			expect(res.status).toBe(404);
			const got = await app.request(
				`/api/v1/assistant/conversations/${conversationId}`,
				{
					headers: { Cookie: `artisan_user_session=${otherSessionId}`, "Content-Type": "application/json" },
				},
			);
			expect(got.status).toBe(404);
		} finally {
			await db.delete(users).where(eq(users.id, otherId));
		}
	});
});
