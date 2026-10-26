# Boutique cross-stack validation — manual smoke test (Docker)

Preparation: `./gradlew publishToMavenLocal` (Artisan), `mvn package` (Boutique),
copy Boutique-2.0.0.jar into the plugins mount of the minecraft container, `docker compose up`.

1. Boot: Boutique log "Contenu Boutique bootstrappé…" on first start; `/artisan reload`; `/artisan pushLocal boutique_shop`.
2. Editor: the Boutique module appears in the sidebar (presence); the boutique_shop project lists shop_main/shop_category; the Boutique module shows the catalog (migrated or example).
3. In-game: `/boutique` opens shop_main; the categories come from boutique:categories; click a category → filtered shop_category; click an item → dialog; Confirm → tokens debited, buy_commands executed, history in DB.
4. Editing: change a price in the editor module → Deploy → price up to date in-game without restart (onReload).
5. Round-trip: redeploying from the editor does NOT erase boutique/shop.yaml on the server (exportFiles regenerates it).
6. Insufficient balance: error message, no debit. Item without buy_commands: purchase refused.
