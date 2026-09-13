import type { DemoSession } from "@/state/demoStore";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export class DemoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function call<T>(suffix: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1/demo${suffix}`, {
    ...init,
    credentials: "include",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok) throw new DemoApiError(body.error ?? "demo_unavailable", response.status);
  return body as T;
}
export async function readDemo(): Promise<DemoSession | null> {
  try {
    return await call<DemoSession>("");
  } catch (error) {
    if (error instanceof DemoApiError && [401, 404].includes(error.status)) return null;
    throw error;
  }
}
export const createDemo = () => call<DemoSession>("", { method: "POST" });
export function claimDemo(
  csrfToken: string,
  input: { operationId: string; networkId: string; projectId: string },
) {
  return call<{ projectId: string; networkId: string }>("/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Artisan-Demo-CSRF": csrfToken },
    body: JSON.stringify(input),
  });
}
