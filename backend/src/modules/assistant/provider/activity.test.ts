import { expect, test } from "bun:test";
import { withInactivityTimeout } from "./activity";
import type { LlmProvider } from "./types";

test("real progress keeps a general assistant call alive; silence aborts without retry", async () => {
	let calls = 0;
	const provider: LlmProvider = {
		async *streamTurn(input) {
			calls++;
			for (let i = 0; i < 8; i++) {
				await new Promise((resolve) => setTimeout(resolve, 20));
				input.signal?.throwIfAborted();
				input.onProgress?.();
			}
			yield { type: "done", stopReason: "stop" };
		},
	};
	for await (const event of withInactivityTimeout(provider, 100).streamTurn({
		messages: [],
		tools: [],
		model: "m",
	}))
		expect(event.type).toBe("done");
	const silent: LlmProvider = {
		async *streamTurn(input) {
			calls++;
			await new Promise<void>((_, reject) =>
				input.signal?.addEventListener(
					"abort",
					() => reject(input.signal?.reason),
					{ once: true },
				),
			);
			yield { type: "done", stopReason: "stop" };
		},
	};
	let code = "";
	try {
		for await (const _ of withInactivityTimeout(silent, 30).streamTurn({
			messages: [],
			tools: [],
			model: "m",
		})) {
		}
	} catch (error) {
		code = (error as { code: string }).code;
	}
	expect(code).toBe("provider_timeout");
	expect(calls).toBe(2);
});
