/** The shared project transport: same-origin session cookie on every call. */
export async function projectFetch(
  _projectId: string | undefined,
  url: RequestInfo | URL,
  init: RequestInit = {},
) {
  return fetch(url, { ...init, credentials: "include" });
}
