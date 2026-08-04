import { app, websocket } from "./app";
import { seedBundledAssets } from "./lib/assetSeed";
import { backfillSlugs } from "./lib/backfillSlugs";
import { backfillContentWidths } from "./lib/contentWidthBackfill";
import { seedAiCatalogFromLegacy } from "./modules/ai/seed";

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

// One-time migration: compute contentWidth for assets uploaded before the column existed.
backfillContentWidths().catch((err) =>
	console.error("[backfill] contentWidth failed:", err),
);
backfillSlugs().catch((err) => console.error("[backfill] slugs failed:", err));
seedAiCatalogFromLegacy().catch((err) => console.error("[ai] legacy seed failed:", err));
