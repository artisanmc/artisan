import { expect, mock, test } from "bun:test";
import {
	type ImportSourcesReadFn,
	MAX_SERVER_ATTACHMENT_FILES,
	MAX_SERVER_ATTACHMENT_GROUPS,
	MAX_SERVER_ATTACHMENT_PATH_LENGTH,
	MAX_SERVER_ATTACHMENT_SOURCE_ID_LENGTH,
	resolveServerAttachments,
} from "./serverAttachments";

test("hosted context permits uploaded-only chat and rejects requested live attachments without WS", async () => {
  const read = mock(async () => { throw new Error("unexpected websocket"); });
  expect(await resolveServerAttachments(null, [], read)).toEqual({ ok: true, attachments: {} });
  expect(await resolveServerAttachments(null, [{ sourceId: "zmenu", paths: ["a.yml"] }], read)).toEqual({ ok: false, error: "server_unavailable", status: 422 });
  expect(read).not.toHaveBeenCalled();
});

test("namespaces returned server files", async () => {
	const read = mock(async () => ({
		kind: "result" as const,
		result: {
			type: "import_sources_read_result" as const,
			request_id: "r",
			ok: true,
			files: [
				{
					source_id: "zmenu",
					path: "shop.yml",
					content: "name: Shop",
				},
			],
		},
	}));

	await expect(
		resolveServerAttachments(
			"sk",
			[{ sourceId: "zmenu", paths: ["shop.yml"] }],
			read,
		),
	).resolves.toEqual({
		ok: true,
		attachments: { "server:zmenu/shop.yml": "name: Shop" },
	});
});

test("skips the plugin relay when no server attachment is requested", async () => {
	const read = mock(async () => {
		throw new Error("relay should not be called");
	});

	await expect(
		resolveServerAttachments("sk", undefined, read),
	).resolves.toEqual({
		ok: true,
		attachments: {},
	});
	expect(read).not.toHaveBeenCalled();
});

test("rejects malformed selections before contacting the plugin", async () => {
	const read = mock(async () => {
		throw new Error("relay should not be called");
	});
	const malformed = [
		null,
		{},
		[null],
		[{ sourceId: "", paths: ["shop.yml"] }],
		[{ sourceId: "   ", paths: ["shop.yml"] }],
		[{ sourceId: "zmenu", paths: [] }],
		[{ sourceId: "zmenu", paths: [""] }],
		[{ sourceId: "zmenu", paths: ["   "] }],
		[{ sourceId: "zmenu", paths: [1] }],
	];

	for (const raw of malformed) {
		await expect(resolveServerAttachments("sk", raw, read)).resolves.toEqual({
			ok: false,
			error: "invalid_input",
			status: 422,
		});
	}
	expect(read).not.toHaveBeenCalled();
});

test("rejects duplicate requested files before contacting the plugin", async () => {
	const read = mock(async () => {
		throw new Error("relay should not be called");
	});

	await expect(
		resolveServerAttachments(
			"sk",
			[
				{ sourceId: "zmenu", paths: ["shop.yml"] },
				{ sourceId: "zmenu", paths: ["shop.yml"] },
			],
			read,
		),
	).resolves.toEqual({ ok: false, error: "invalid_input", status: 422 });
	expect(read).not.toHaveBeenCalled();
});

test("rejects more than 200 requested files before contacting the plugin", async () => {
	const read = mock(async () => {
		throw new Error("relay should not be called");
	});
	const paths = Array.from(
		{ length: MAX_SERVER_ATTACHMENT_FILES + 1 },
		(_, index) => `menus/${index}.yml`,
	);

	await expect(
		resolveServerAttachments("sk", [{ sourceId: "zmenu", paths }], read),
	).resolves.toEqual({ ok: false, error: "invalid_input", status: 422 });
	expect(read).not.toHaveBeenCalled();
});

test("rejects more than 32 source groups before contacting the plugin", async () => {
	const read = mock(async () => {
		throw new Error("relay should not be called");
	});
	const selections = Array.from(
		{ length: MAX_SERVER_ATTACHMENT_GROUPS + 1 },
		(_, index) => ({
			sourceId: `source-${index}`,
			paths: ["menu.yml"],
		}),
	);

	await expect(
		resolveServerAttachments("sk", selections, read),
	).resolves.toEqual({
		ok: false,
		error: "invalid_input",
		status: 422,
	});
	expect(read).not.toHaveBeenCalled();
});

test("rejects oversized source ids, paths, and huge strings before contacting the plugin", async () => {
	const read = mock(async () => {
		throw new Error("relay should not be called");
	});
	const oversized = [
		[
			{
				sourceId: "s".repeat(MAX_SERVER_ATTACHMENT_SOURCE_ID_LENGTH + 1),
				paths: ["menu.yml"],
			},
		],
		[
			{
				sourceId: "zmenu",
				paths: ["p".repeat(MAX_SERVER_ATTACHMENT_PATH_LENGTH + 1)],
			},
		],
		[{ sourceId: "zmenu", paths: ["p".repeat(100_000)] }],
	];

	for (const selections of oversized) {
		await expect(
			resolveServerAttachments("sk", selections, read),
		).resolves.toEqual({ ok: false, error: "invalid_input", status: 422 });
	}
	expect(read).not.toHaveBeenCalled();
});

test("checks string length before trimming oversized source ids and paths", async () => {
	const read = mock(async () => {
		throw new Error("relay should not be called");
	});
	const originalTrim = String.prototype.trim;
	let results: Awaited<ReturnType<typeof resolveServerAttachments>>[] = [];
	String.prototype.trim = function trimWithoutHugeStrings() {
		if (this.length > MAX_SERVER_ATTACHMENT_SOURCE_ID_LENGTH) {
			throw new Error("oversized value was trimmed");
		}
		return originalTrim.call(this);
	};
	try {
		results = await Promise.all([
			resolveServerAttachments(
				"sk",
				[
					{
						sourceId: " ".repeat(MAX_SERVER_ATTACHMENT_SOURCE_ID_LENGTH + 1),
						paths: ["menu.yml"],
					},
				],
				read,
			),
			resolveServerAttachments(
				"sk",
				[
					{
						sourceId: "zmenu",
						paths: [" ".repeat(MAX_SERVER_ATTACHMENT_PATH_LENGTH + 1)],
					},
				],
				read,
			),
		]);
	} finally {
		String.prototype.trim = originalTrim;
	}

	expect(results).toEqual([
		{ ok: false, error: "invalid_input", status: 422 },
		{ ok: false, error: "invalid_input", status: 422 },
	]);
	expect(read).not.toHaveBeenCalled();
});

test("reports an offline server before an assistant turn", async () => {
	const read = mock(async () => ({ kind: "offline" as const }));

	await expect(
		resolveServerAttachments(
			"sk",
			[{ sourceId: "zmenu", paths: ["shop.yml"] }],
			read,
		),
	).resolves.toEqual({ ok: false, error: "server_offline", status: 503 });
});

test("reports an import read timeout before an assistant turn", async () => {
	const read = mock(async () => ({ kind: "timeout" as const }));

	await expect(
		resolveServerAttachments(
			"sk",
			[{ sourceId: "zmenu", paths: ["shop.yml"] }],
			read,
		),
	).resolves.toEqual({ ok: false, error: "fetch_timeout", status: 504 });
});

test("maps missing plugin sources and files to not found", async () => {
	for (const error of ["unknown_source", "not_found"]) {
		const read = mock(async () => ({
			kind: "result" as const,
			result: {
				type: "import_sources_read_result" as const,
				request_id: "r",
				ok: false,
				error,
				message: "shop.yml",
			},
		}));

		await expect(
			resolveServerAttachments(
				"sk",
				[{ sourceId: "zmenu", paths: ["shop.yml"] }],
				read,
			),
		).resolves.toEqual({
			ok: false,
			error,
			status: 404,
		});
	}
});

test("maps rejected plugin selections to unprocessable entity", async () => {
	const errors = [
		"invalid_input",
		"invalid_path",
		"unsupported_file",
		"too_many_files",
		"file_too_large",
		"too_large",
		"invalid_utf8",
	];
	for (const error of errors) {
		const read = mock(async () => ({
			kind: "result" as const,
			result: {
				type: "import_sources_read_result" as const,
				request_id: "r",
				ok: false,
				error,
			},
		}));

		await expect(
			resolveServerAttachments(
				"sk",
				[{ sourceId: "zmenu", paths: ["shop.yml"] }],
				read,
			),
		).resolves.toMatchObject({ ok: false, error, status: 422 });
	}
});

test("never exposes a plugin message, even for a known error code", async () => {
	const read = mock(async () => ({
		kind: "result" as const,
		result: {
			type: "import_sources_read_result" as const,
			request_id: "r",
			ok: false,
			error: "invalid_path",
			message: "C:\\servers\\private\\plugins\\zMenu\\menus\\shop.yml",
		},
	}));

	await expect(
		resolveServerAttachments(
			"sk",
			[{ sourceId: "zmenu", paths: ["shop.yml"] }],
			read,
		),
	).resolves.toEqual({ ok: false, error: "invalid_path", status: 422 });
});

test("turns a malformed plugin failure into a stable gateway error", async () => {
	const read = mock(async () => ({
		kind: "result" as const,
		result: {
			type: "import_sources_read_result" as const,
			request_id: "r",
			ok: false,
			error: 42,
			message: { path: "secret" },
		},
	}));

	await expect(
		resolveServerAttachments(
			"sk",
			[{ sourceId: "zmenu", paths: ["shop.yml"] }],
			read as unknown as ImportSourcesReadFn,
		),
	).resolves.toEqual({ ok: false, error: "read_error", status: 502 });
});

test("maps read errors and unknown plugin failures to bad gateway", async () => {
	for (const error of ["read_error", "future_plugin_error"]) {
		const read = mock(async () => ({
			kind: "result" as const,
			result: {
				type: "import_sources_read_result" as const,
				request_id: "r",
				ok: false,
				error,
				message: "C:\\servers\\secret\\plugins\\Artisan\\packs",
			},
		}));

		await expect(
			resolveServerAttachments(
				"sk",
				[{ sourceId: "zmenu", paths: ["shop.yml"] }],
				read,
			),
		).resolves.toEqual({ ok: false, error: "read_error", status: 502 });
	}
});

test("requires a strict boolean ok flag from the plugin", async () => {
	const read = mock(async () => ({
		kind: "result" as const,
		result: {
			type: "import_sources_read_result" as const,
			request_id: "r",
			ok: "true",
			files: [{ source_id: "zmenu", path: "shop.yml", content: "secret" }],
		},
	}));

	await expect(
		resolveServerAttachments(
			"sk",
			[{ sourceId: "zmenu", paths: ["shop.yml"] }],
			read as unknown as ImportSourcesReadFn,
		),
	).resolves.toEqual({ ok: false, error: "read_error", status: 502 });
});

test("rejects duplicate files returned by the plugin atomically", async () => {
	const read = mock(async () => ({
		kind: "result" as const,
		result: {
			type: "import_sources_read_result" as const,
			request_id: "r",
			ok: true,
			files: [
				{ source_id: "zmenu", path: "shop.yml", content: "one" },
				{ source_id: "zmenu", path: "shop.yml", content: "two" },
			],
		},
	}));

	await expect(
		resolveServerAttachments(
			"sk",
			[{ sourceId: "zmenu", paths: ["shop.yml"] }],
			read,
		),
	).resolves.toEqual({ ok: false, error: "read_error", status: 502 });
});

test("rejects a result containing any malformed file without returning partial content", async () => {
	const read = mock(async () => ({
		kind: "result" as const,
		result: {
			type: "import_sources_read_result" as const,
			request_id: "r",
			ok: true,
			files: [
				{ source_id: "zmenu", path: "shop.yml", content: "valid" },
				{ source_id: "zmenu", path: "broken.yml", content: 42 },
			],
		},
	}));

	await expect(
		resolveServerAttachments(
			"sk",
			[{ sourceId: "zmenu", paths: ["shop.yml", "broken.yml"] }],
			read as unknown as ImportSourcesReadFn,
		),
	).resolves.toEqual({ ok: false, error: "read_error", status: 502 });
});

test("rejects a partial successful result without returning any attachments", async () => {
	const read = mock(async () => ({
		kind: "result" as const,
		result: {
			type: "import_sources_read_result" as const,
			request_id: "r",
			ok: true,
			files: [{ source_id: "zmenu", path: "shop.yml", content: "valid" }],
		},
	}));

	await expect(
		resolveServerAttachments(
			"sk",
			[{ sourceId: "zmenu", paths: ["shop.yml", "missing.yml"] }],
			read,
		),
	).resolves.toEqual({ ok: false, error: "read_error", status: 502 });
});
