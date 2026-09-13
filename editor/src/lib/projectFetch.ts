import { useDemoStore } from "@/state/demoStore";

/** The shared project transport adds only the credentials of the matching guest scope. */
export async function projectFetch(
  projectId: string | undefined,
  url: RequestInfo | URL,
  init: RequestInit = {},
) {
  const session = useDemoStore.getState().session;
  const guest = session?.projectId === projectId ? session : null;
  const headers = new Headers(init.headers);
  if (guest && !["GET", "HEAD"].includes(init.method ?? "GET"))
    headers.set("X-Artisan-Demo-CSRF", guest.csrfToken);
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: guest ? headers : init.headers,
  });
  if (guest && useDemoStore.getState().session?.principal.id === guest.principal.id) {
    if (response.status === 410) useDemoStore.getState().expire();
    const expiresAt = response.headers.get("X-Artisan-Demo-Expires-At");
    const current = useDemoStore.getState().session;
    if (
      response.ok &&
      expiresAt &&
      current &&
      Date.parse(expiresAt) > Date.parse(current.expiresAt)
    )
      useDemoStore.getState().setSession({ ...current, expiresAt });
  }
  return response;
}
