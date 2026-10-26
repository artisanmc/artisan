import { ConsentPage } from "@/features/mcp/ConsentPage";
import { createFileRoute } from "@tanstack/react-router";

/** Where `/oauth/authorize` sends the player to approve an AI client (ADR `mcp-server`). */
export const Route = createFileRoute("/oauth/consent")({ component: OAuthConsentRoute });

export function OAuthConsentRoute() {
  return <ConsentPage query={window.location.search} />;
}
