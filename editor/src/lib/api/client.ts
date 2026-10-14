/**
 * The editor's one transport to the hub (issue #45): every `lib/api/*` module
 * and every one-off call goes through here. One `API_URL`, the session cookie
 * on every request, and one error class carrying the hub's `error` code and
 * the HTTP status, so callers decide by code (as the hub's `ErrorStatus`
 * does), never by status alone.
 */

/** The hub's origin; empty in production, where the editor is served by the hub itself. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? "";

/** An absolute URL for a hub path; a URL already absolute is returned as is. */
export const apiUrl = (path: string): string =>
  /^https?:\/\//.test(path) ? path : `${API_URL}${path}`;

/** What the hub puts in a refused answer: `{error, message?}` plus route-specific fields. */
export interface ApiErrorBody {
  error?: string;
  message?: string;
  [key: string]: unknown;
}

/**
 * A refused or failed call. `code` is the hub's `error` (`http_<status>` when
 * the body carries none), `status` the HTTP status; a transport failure is
 * `network_error` with status 0, a local timeout `fetch_timeout` with 504
 * (the hub's own code and status for a plugin that did not answer), an
 * aborted request `aborted` with status 0.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly body: ApiErrorBody | null = null,
    /** The hub's `message`, when it explains the code. */
    readonly detail?: string,
  ) {
    super(code);
    this.name = "ApiError";
  }

  /** The hub sent a code of its own (as opposed to a bare HTTP status). */
  get hasCode(): boolean {
    return !this.code.startsWith("http_");
  }

  /** Any failure as an `ApiError`, so a `catch` never has to guess the shape. */
  static from(error: unknown, signal?: AbortSignal): ApiError {
    if (error instanceof ApiError) return error;
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      const reason = signal?.reason ?? error;
      return reason instanceof DOMException && reason.name === "TimeoutError"
        ? new ApiError("fetch_timeout", 504)
        : new ApiError("aborted", 0);
    }
    if (error instanceof DOMException && error.name === "TimeoutError")
      return new ApiError("fetch_timeout", 504);
    return new ApiError(
      "network_error",
      0,
      null,
      error instanceof Error ? error.message : undefined,
    );
  }
}

export interface ApiRequest {
  method?: string;
  /** Sent JSON-encoded, with its content type. */
  json?: unknown;
  /** Sent as is (bytes, form data); `contentType` names it. */
  body?: BodyInit;
  contentType?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Gives up after this delay: `fetch_timeout`, like the hub's own. */
  timeoutMs?: number;
}

/**
 * The hub's answer as a `Response`: credentials, body encoding, timeout and
 * transport failures are handled here; reading the status is the caller's,
 * for the few routes whose status is part of the contract (202, binaries).
 */
export async function apiRequest(path: string, init: ApiRequest = {}): Promise<Response> {
  const headers: Record<string, string> = { ...init.headers };
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.contentType) headers["Content-Type"] = init.contentType;
  const signal = init.signal ?? (init.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : undefined);
  try {
    return await fetch(apiUrl(path), {
      method: init.method ?? "GET",
      credentials: "include",
      headers,
      ...(body === undefined ? {} : { body }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    throw ApiError.from(error, signal);
  }
}

/** The body of a refused answer, or null when it is not JSON. */
export async function errorBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" ? (body as ApiErrorBody) : null;
  } catch {
    return null;
  }
}

/** The `ApiError` a refused answer stands for. */
export async function errorOf(response: Response): Promise<ApiError> {
  const body = await errorBody(response);
  return new ApiError(
    typeof body?.error === "string" ? body.error : `http_${response.status}`,
    response.status,
    body,
    typeof body?.message === "string" ? body.message : undefined,
  );
}

/**
 * The hub's JSON answer. Any non-2xx is an `ApiError` carrying the hub's code
 * and message; a 2xx whose body is not JSON is `invalid_response`.
 */
export async function apiFetch<T = unknown>(path: string, init: ApiRequest = {}): Promise<T> {
  const response = await apiRequest(path, init);
  if (!response.ok) throw await errorOf(response);
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("invalid_response", response.status);
  }
}
