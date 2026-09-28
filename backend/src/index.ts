import { app, websocket } from "./app";
import { seedBundledAssets } from "./lib/assetSeed";
import { backfillSlugs } from "./lib/backfillSlugs";
import { seedAiCatalogFromLegacy } from "./modules/ai/seed";
import { expireDraftReceipts } from "./lib/storage/ReceiptDraftStore";
import { resumeServerDrafts } from "./lib/projectDraftMigration";
import { connToServerId } from "./ws/hub";
import { maintainDemoSessions } from "./lib/demoSessions";
import { grantDueAnnualProCredits } from "./modules/billing/annualProCredits";

// Avant d'ouvrir le port : le volume peut être neuf (icônes 3D + items.json
// absents = « Bibliothèque indisponible » côté éditeur). Synchrone et rapide,
// aucune requête ne doit voir l'état intermédiaire.
seedBundledAssets();

const port = Number(process.env.PORT ?? 3001);

export default {
	port,
	// Bun's default idleTimeout is 10s, which kills the assistant's SSE stream
	// mid-flight whenever the LLM takes >10s between tokens (common) → the client
	// sees ERR_INCOMPLETE_CHUNKED_ENCODING. 255s is Bun's max; each SSE write
	// resets the idle clock, so this only needs to cover the largest token gap.
	idleTimeout: 255,
	fetch: app.fetch,
	websocket,
};

console.log(`Artisan backend on http://localhost:${port}`);

backfillSlugs().catch((err) => console.error("[backfill] slugs failed:", err));
seedAiCatalogFromLegacy().catch((err) => console.error("[ai] legacy seed failed:", err));
const maintainDrafts = async () => {
  await expireDraftReceipts();
  await maintainDemoSessions();
  for (const serverId of new Set(connToServerId.values())) await resumeServerDrafts(serverId);
};
let maintainingDrafts = false;
const scheduleDraftMaintenance = () => {
  if (maintainingDrafts) return;
  maintainingDrafts = true;
  void maintainDrafts().catch((error) => console.error("[drafts] maintenance pending", error)).finally(() => { maintainingDrafts = false; });
};
scheduleDraftMaintenance();
setInterval(scheduleDraftMaintenance, 60_000).unref();

let grantingAnnualCredits = false;
const scheduleAnnualCredits = () => {
  if (grantingAnnualCredits) return;
  grantingAnnualCredits = true;
  void grantDueAnnualProCredits().catch((error) => console.error("[billing] annual Pro credit grant failed:", error)).finally(() => { grantingAnnualCredits = false; });
};
scheduleAnnualCredits();
setInterval(scheduleAnnualCredits, 60_000).unref();
