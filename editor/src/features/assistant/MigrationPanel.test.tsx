import * as api from "@/lib/api/assistantMigration";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MigrationPanel } from "./MigrationPanel";

it("offers explicit paid compression on context exhaustion without automatically starting it", async () => {
	const paused = { ...run, canCompress: true };
	vi.mocked(api.listMigrations).mockResolvedValue([paused]);
	vi.mocked(api.getMigration).mockResolvedValue(paused);
	vi.mocked(api.controlMigration).mockResolvedValue({
		...paused,
		status: "running",
		compressing: true,
		revision: 8,
	});
	render(<MigrationPanel {...props} />);
	const button = await screen.findByText("assistant.migration.compress");
	expect(api.controlMigration).not.toHaveBeenCalled();
	expect(screen.queryByText("assistant.migration.resume")).toBeNull();
	expect(screen.getByText("assistant.migration.compressionHelp")).toBeTruthy();
	fireEvent.click(button);
	await waitFor(() =>
		expect(api.controlMigration).toHaveBeenCalledExactlyOnceWith(
			"c",
			"r",
			"compress",
			7,
		),
	);
});

it("starts all 35 files directly and preserves the request ID after an uncertain response", async () => {
	vi.mocked(api.listMigrations).mockResolvedValue([]);
	vi.mocked(api.createMigration)
		.mockRejectedValueOnce(new Error("connection lost"))
		.mockResolvedValueOnce({ ...run, status: "ready" });
	vi.mocked(api.controlMigration).mockResolvedValueOnce({
		...run,
		status: "running",
		revision: 8,
	});
	const groups = [
		{
			sourceId: "zmenu",
			label: "zMenu",
			files: Array.from({ length: 35 }, (_, i) => ({
				path: `m${i}.yml`,
				size: 100,
			})),
		},
	];
	render(<MigrationPanel {...props} groups={groups} />);
	fireEvent.click(screen.getByText("assistant.migration.selection"));
	expect(screen.queryByLabelText("assistant.migration.budget")).toBeNull();
	fireEvent.click(screen.getByText("assistant.migration.start"));
	await screen.findByText("assistant.migration.errors.migration_error");
	fireEvent.click(screen.getByText("assistant.migration.start"));
	await waitFor(() =>
		expect(api.controlMigration).toHaveBeenCalledExactlyOnceWith(
			"c",
			"r",
			"start",
			7,
		),
	);
	const calls = vi.mocked(api.createMigration).mock.calls;
	expect(calls[0]?.[1].serverAttachments[0]?.paths).toHaveLength(35);
	expect(calls[0]?.[1]).not.toHaveProperty("maxCredits");
	expect(calls[0]?.[1].requestId).toBe(calls[1]?.[1].requestId);
	expect(screen.queryByText("assistant.migration.analyze")).toBeNull();
});

it("ignores a control response after switching conversation in the same Project", async () => {
	const pending = Promise.withResolvers<api.MigrationRun>();
	vi.mocked(api.controlMigration).mockReturnValueOnce(pending.promise);
	const view = render(<MigrationPanel {...props} />);
	fireEvent.click(await screen.findByText("assistant.migration.resume"));
	vi.mocked(api.listMigrations).mockResolvedValue([]);
	view.rerender(<MigrationPanel {...props} conversationId="another" />);
	await act(async () => pending.resolve({ ...run, status: "running" }));
	expect(screen.queryByText("assistant.migration.status.running")).toBeNull();
});

it("drains event pages so recent interruption reasons are visible", async () => {
	vi.mocked(api.getMigrationEvents)
		.mockResolvedValueOnce(
			Array.from({ length: 200 }, (_, i) => ({
				sequence: i + 1,
				runId: "r",
				type: "step",
				createdAt: "",
			})),
		)
		.mockResolvedValueOnce([
			{
				sequence: 201,
				runId: "r",
				type: "step_interrupted",
				code: "provider_timeout",
				createdAt: "",
			},
		]);
	render(<MigrationPanel {...props} />);
	await screen.findByText("assistant.migration.errors.provider_timeout");
	expect(api.getMigrationEvents).toHaveBeenLastCalledWith(
		"c",
		"r",
		expect.any(AbortSignal),
		200,
	);
});
vi.mock("@/lib/api/assistantMigration", async (original) => ({
	...(await original<typeof api>()),
	listMigrations: vi.fn(),
	getMigration: vi.fn(),
	getMigrationProposals: vi.fn(),
	getMigrationEvents: vi.fn(),
	createMigration: vi.fn(),
	controlMigration: vi.fn(),
}));

it("shows the tool and translated reason after repeated invalid calls", async () => {
	vi.mocked(api.getMigrationEvents).mockResolvedValueOnce([
		{
			sequence: 8,
			runId: "r",
			type: "step_interrupted",
			code: "invalid_tool:read_source:invalid_offset",
			createdAt: "",
		},
	]);
	render(<MigrationPanel {...props} />);
	await screen.findByText(
		"assistant.migration.errors.invalid_offset (read_source)",
	);
});

it("shows the precise interruption code instead of only generic connection advice", async () => {
	vi.mocked(api.getMigrationEvents).mockResolvedValueOnce([
		{
			sequence: 8,
			runId: "r",
			type: "step_interrupted",
			code: "missing_proposal",
			createdAt: "",
		},
	]);
	render(<MigrationPanel {...props} />);
	await screen.findByText("missing_proposal", { selector: "code" });
});
vi.mock("./migrationProposal", () => ({
	inspectMigrationProposal: () => ({ status: "available" }),
	applyMigrationProposal: vi.fn(),
	canPersistMigrationDraft: () => true,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
const run: api.MigrationRun = {
	id: "r",
	conversationId: "c",
	projectId: "p",
	modelId: "m",
	status: "paused",
	revision: 7,
	manifest: { version: 1, hash: "h", entries: [], issues: [] },
	budget: {
		maxCredits: 20,
		usedCredits: 7,
		contextTokens: 64000,
		maxOutputTokens: 8000,
	},
	steps: [],
	issues: [],
	createdAt: "",
	updatedAt: "",
};
const props = {
	projectId: "p",
	conversationId: "c",
	ensureConversation: async () => "c",
	modelId: "m",
	groups: [],
	disabled: false,
};
beforeEach(() => {
	vi.mocked(api.listMigrations).mockResolvedValue([run]);
	vi.mocked(api.getMigration).mockResolvedValue(run);
	vi.mocked(api.getMigrationProposals).mockResolvedValue([]);
	vi.mocked(api.getMigrationEvents).mockResolvedValue([]);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
it("rediscovers a paused run on refresh with GET only", async () => {
	render(<MigrationPanel {...props} />);
	await screen.findByText("assistant.migration.status.paused");
	expect(api.createMigration).not.toHaveBeenCalled();
	expect(api.controlMigration).not.toHaveBeenCalled();
});
it("requires explicit resume and never retries a revision conflict", async () => {
	vi.mocked(api.controlMigration).mockRejectedValue(
		new api.MigrationRequestError("revision_conflict", 409),
	);
	render(<MigrationPanel {...props} />);
	fireEvent.click(await screen.findByText("assistant.migration.resume"));
	await screen.findByText("assistant.migration.errors.revision_conflict");
	expect(api.controlMigration).toHaveBeenCalledExactlyOnceWith(
		"c",
		"r",
		"resume",
		7,
	);
});
it("ignores an old discovery response after switching Project/conversation", async () => {
	let resolve: (runs: api.MigrationRun[]) => void = () => {};
	vi.mocked(api.listMigrations)
		.mockImplementationOnce(
			() =>
				new Promise((r) => {
					resolve = r;
				}),
		)
		.mockResolvedValueOnce([]);
	const view = render(<MigrationPanel {...props} />);
	view.rerender(
		<MigrationPanel {...props} projectId="other" conversationId="other-c" />,
	);
	resolve([run]);
	await waitFor(() => expect(api.listMigrations).toHaveBeenCalledTimes(2));
	expect(screen.queryByText("assistant.migration.status.paused")).toBeNull();
});
