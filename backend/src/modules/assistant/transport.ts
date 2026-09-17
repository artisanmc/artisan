import OpenAI from "openai";
import { LlmRequestError } from "./provider/types";

export function assistantFailureCode(error: unknown): string {
	if (error instanceof LlmRequestError) return error.code;
	if (error instanceof OpenAI.APIConnectionTimeoutError)
		return "provider_timeout";
	if (error instanceof OpenAI.APIUserAbortError) return "provider_cancelled";
	if (error instanceof OpenAI.APIConnectionError)
		return "provider_network_error";
	if (
		error instanceof OpenAI.APIError &&
		[400, 413, 422].includes(error.status ?? 0)
	) {
		if (
			error.code === "context_length_exceeded" ||
			/maximum context length|context (?:length|window).*(?:exceed|too (?:long|large))|prompt is too long/i.test(
				error.message,
			)
		)
			return "provider_context_full";
	}
	if (error instanceof OpenAI.APIError) {
		switch (error.status) {
			case 401:
			case 403:
				return "provider_auth_failed";
			case 402:
				return "provider_payment_required";
			case 404:
				return "provider_model_unavailable";
			case 408:
			case 504:
				return "provider_timeout";
			case 413:
				return "provider_payload_too_large";
			case 429:
				return error.code === "insufficient_quota"
					? "provider_payment_required"
					: "provider_rate_limited";
			case 400:
			case 422:
				return "provider_request_rejected";
		}
		if ((error.status ?? 0) >= 500) return "provider_unavailable";
		return "provider_error";
	}
	return "engine_error";
}

/** Never copy provider messages, request bodies, headers or arbitrary error fields. */
export function assistantFailureDiagnostics(error: unknown) {
	return {
		code: assistantFailureCode(error),
		...(error instanceof OpenAI.APIError &&
		Number.isInteger(error.status) &&
		error.status! >= 100 &&
		error.status! <= 599
			? { httpStatus: error.status }
			: {}),
		...(error instanceof OpenAI.APIError &&
		[
			"invalid_request_error",
			"invalid_api_key",
			"insufficient_quota",
			"model_not_found",
			"rate_limit_exceeded",
			"context_length_exceeded",
		].includes(error.code ?? "")
			? { providerCode: error.code }
			: {}),
		...(error instanceof OpenAI.APIError &&
		[
			"messages",
			"tools",
			"max_tokens",
			"model",
			"stream_options",
			"temperature",
			"tool_choice",
		].includes(error.param ?? "")
			? { parameter: error.param }
			: {}),
	};
}

/** One pending write at most: slow readers must not accumulate timer writes. */
export function startAssistantHeartbeat(
	stream: {
		writeSSE(message: { event: string; data: string }): Promise<unknown>;
		onAbort(callback: () => void): void;
	},
	onDisconnect: () => void,
	intervalMs = 15_000,
): () => void {
	let stopped = false;
	let pending = false;
	const stop = () => {
		stopped = true;
		clearInterval(timer);
	};
	const disconnected = () => {
		if (stopped) return;
		stop();
		onDisconnect();
	};
	const timer = setInterval(() => {
		if (stopped || pending) return;
		pending = true;
		void stream
			.writeSSE({ event: "heartbeat", data: "{}" })
			.catch(disconnected)
			.finally(() => {
				pending = false;
			});
	}, intervalMs);
	stream.onAbort(disconnected);
	return stop;
}
