# Validation cross-stack Boutique — smoke manuel (Docker)

Préparation : `./gradlew publishToMavenLocal` (Artisan), `mvn package` (Boutique),
copier Boutique-2.0.0.jar dans le mount plugins du container minecraft, `docker compose up`.

1. Boot : log Boutique "Contenu Boutique bootstrappé…" au premier démarrage ; `/artisan reload` ; `/artisan pushLocal boutique_shop`.
2. Éditeur : le module Boutique apparaît dans la sidebar (presence) ; le project boutique_shop liste shop_main/shop_category ; le module Boutique montre le catalogue (migré ou exemple).
3. In-game : `/boutique` ouvre shop_main ; les catégories viennent de boutique:categories ; clic catégorie → shop_category filtré ; clic item → dialog ; Confirmer → tokens débités, buy_commands exécutées, historique en DB.
4. Édition : changer un prix dans le module éditeur → Deploy → prix à jour in-game sans restart (onReload).
5. Round-trip : redéployer depuis l'éditeur n'efface PAS boutique/shop.yaml sur le serveur (exportFiles le régénère).
6. Solde insuffisant : message d'erreur, pas de débit. Item sans buy_commands : achat refusé.
