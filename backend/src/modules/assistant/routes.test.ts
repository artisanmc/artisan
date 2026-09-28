import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { app } from "../../app";
import { db } from "../../db/index";
import {
	aiModels,
	aiUsageLog,
	assistantConversations,
	assistantTasks,
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
import { requeueMigrationTask } from "./tasks";
import { buildManifest, hashJsonValue } from "./migration/manifest";
import {
	createRun,
	getRun,
	listRuns,
	transitionRun,
	claimNextStep,
	interruptStep,
	completeStep,
} from "./migration/repository";
import { resolveModel } from "../ai/modelRepo";
import { MigrationInputError } from "./migration/types";
import { getBalance, grantCredits } from "../ai/creditsRepo";
import { createModel, setDefaultModel } from "../ai/modelRepo";
import type { LlmProvider, LlmStreamEvent } from "./provider/types";
import { ATTACHMENT_NOTE_PREFIX, __setProviderForTests } from "./routes";
import {
	cleanupConn,
	connToServerId,
	handlePluginMessage,
	registerConn,
} from "../../ws/hub";

const validMenu = {
	schema: "menu/v1",
	id: "shop",
	title: [{ kind: "plain", value: { key: "k" } }],
	size: 27,
	layers: [
		{
			id: "l1",
			name: "d",
			elements: [{ id: "e1", positions: "0", material: "STONE" }],
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
let serverKeyId = "";
let userSessionId = "";

beforeAll(async () => {
	const network = await createNetwork("assistant-test-network");
	networkId = network.id;
	const generated = await generateServerKey();
	serverKeyId = generated.id;
	const { hash } = generated;
	await db
		.insert(serverKeys)
		.values({
			id: serverKeyId,
			hash,
			label: "assistant-test",
			networkId,
			createdAt: new Date(),
		})
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
		.values({
			id: "mem_test_assistant",
			userId: USER_ID,
			networkId,
			role: "owner",
			createdAt: new Date(),
		})
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

});
