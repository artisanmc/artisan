import { type LlmProvider, LlmRequestError } from "./types";

export function withInactivityTimeout(
	provider: LlmProvider,
	idleMs = 240000,
): LlmProvider {
	return {
		async *streamTurn(input) {
			const idle = new AbortController();
			const signal = input.signal
				? AbortSignal.any([input.signal, idle.signal])
				: idle.signal;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const touch = () => {
				clearTimeout(timer);
				if (!signal.aborted)
					timer = setTimeout(
						() => idle.abort(new LlmRequestError("provider_timeout")),
						idleMs,
					);
			};
			signal.throwIfAborted();
			touch();
			try {
				for await (const event of provider.streamTurn({
					...input,
					signal,
					maxRetries: 0,
					onProgress: () => {
						touch();
						input.onProgress?.();
					},
				})) {
					signal.throwIfAborted();
					touch();
					yield event;
				}
			} catch (error) {
				throw idle.signal.aborted ? idle.signal.reason : error;
			} finally {
				clearTimeout(timer);
			}
		},
	};
}
