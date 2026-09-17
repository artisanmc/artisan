import { describe, expect, it } from "bun:test";
import OpenAI from "openai";
import {
	startAssistantHeartbeat,
	assistantFailureCode,
	assistantFailureDiagnostics,
} from "./transport";

describe("assistant transport", () => {
	it("distinguishes provider HTTP failures while keeping diagnostic fields private-safe", () => {
		for (const [status, code] of [
			[400, "provider_request_rejected"],
			[401, "provider_auth_failed"],
			[402, "provider_payment_required"],
			[403, "provider_auth_failed"],
			[404, "provider_model_unavailable"],
			[408, "provider_timeout"],
			[413, "provider_payload_too_large"],
			[422, "provider_request_rejected"],
			[429, "provider_rate_limited"],
			[500, "provider_unavailable"],
			[504, "provider_timeout"],
		] as const) {
			const error = new OpenAI.APIError(
				status,
				{ code: "SECRET_FILE", param: "SECRET_KEY" },
				"PRIVATE_SOURCE",
				new Headers(),
			);
			expect(assistantFailureCode(error)).toBe(code);
			expect(assistantFailureDiagnostics(error)).toEqual({
				code,
				httpStatus: status,
			});
		}
		expect(assistantFailureDiagnostics(new Error("PRIVATE_SOURCE"))).toEqual({
			code: "engine_error",
		});
		expect(
			assistantFailureDiagnostics(
				new OpenAI.APIError(
					429,
					{ code: "insufficient_quota" },
					"SECRET",
					new Headers(),
				),
			),
		).toEqual({
			code: "provider_payment_required",
			httpStatus: 429,
			providerCode: "insufficient_quota",
		});
		expect(
			assistantFailureDiagnostics(
				new OpenAI.APIError(
					400,
					{ code: "invalid_request_error", param: "messages" },
					"SECRET",
					new Headers(),
				),
			),
		).toEqual({
			code: "provider_request_rejected",
			httpStatus: 400,
			providerCode: "invalid_request_error",
			parameter: "messages",
		});
	});
	it("recognizes explicit context rejections without confusing output limits or unrelated API errors", () => {
		for (const [status, message, expected] of [
			[400, "max_tokens exceeds the output limit", "provider_request_rejected"],
			[429, "context_length_exceeded", "provider_rate_limited"],
			[413, "payload too large", "provider_payload_too_large"],
		] as const)
			expect(
				assistantFailureCode(
					new OpenAI.APIError(status, {}, message, new Headers()),
				),
			).toBe(expected);
		for (const error of [
			new OpenAI.APIError(
				400,
				{ code: "context_length_exceeded" },
				"private content",
				new Headers(),
			),
			new OpenAI.APIError(
				400,
				{
					message:
						"This model's maximum context length is 1000000 tokens. Your messages resulted in 1000001 tokens.",
				},
				undefined,
				new Headers(),
			),
			new OpenAI.APIError(
				400,
				{ message: "prompt is too long: 210000 tokens > 200000 maximum" },
				undefined,
				new Headers(),
			),
		])
			expect(assistantFailureCode(error)).toBe("provider_context_full");
	});
	it("keeps a silent stream alive and stops on completion", async () => {
		let writes = 0;
		const stop = startAssistantHeartbeat(
			{
				writeSSE: async () => {
					writes++;
				},
				onAbort: () => {},
			},
			() => {},
			5,
		);
		await Bun.sleep(25);
		expect(writes).toBeGreaterThan(0);
		stop();
		const previous = writes;
		await Bun.sleep(20);
		expect(writes).toBe(previous);
	});

	it("stops and reports a closed SSE once without throwing", async () => {
		let close: () => void = () => {};
		let closed = 0;
		let writes = 0;
		const stop = startAssistantHeartbeat(
			{
				writeSSE: async () => {
					writes++;
				},
				onAbort: (callback) => {
					close = callback;
				},
			},
			() => {
				closed++;
			},
			5,
		);
		close();
		close();
		await Bun.sleep(20);
		expect(closed).toBe(1);
		expect(writes).toBe(0);
		stop();
	});

	it("does not queue heartbeats behind a backpressured write", async () => {
		let release: () => void = () => {};
		let writes = 0;
		const stop = startAssistantHeartbeat(
			{
				writeSSE: () => {
					writes++;
					return new Promise<void>((resolve) => {
						release = resolve;
					});
				},
				onAbort: () => {},
			},
			() => {},
			5,
		);
		await Bun.sleep(25);
		expect(writes).toBe(1);
		stop();
		release();
	});

	it("classifies SDK failures without exposing provider messages or sources", () => {
		expect(assistantFailureCode(new OpenAI.APIConnectionTimeoutError())).toBe(
			"provider_timeout",
		);
		expect(
			assistantFailureCode(
				new OpenAI.APIConnectionError({ message: "secret source" }),
			),
		).toBe("provider_network_error");
		expect(
			assistantFailureCode(
				new OpenAI.APIError(500, {}, "secret source", new Headers()),
			),
		).toBe("provider_unavailable");
		expect(assistantFailureCode(new Error("secret source"))).toBe(
			"engine_error",
		);
	});
});
