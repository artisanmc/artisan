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
	if (error instanceof OpenAI.APIError) return "provider_error";
	return "engine_error";
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
