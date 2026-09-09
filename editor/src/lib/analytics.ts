import posthog from "posthog-js";

const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim();
export const analyticsEnabled = Boolean(token);

if (token) {
  posthog.init(token, {
    api_host: import.meta.env.VITE_POSTHOG_HOST,
    defaults: "2026-01-30",
    capture_pageview: false,
  });
}

export function capturePageView(url: string): void {
  if (analyticsEnabled) posthog.capture("$pageview", { $current_url: url });
}
