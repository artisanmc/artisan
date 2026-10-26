# L'assistant de l'éditeur, sur la clé de l'admin

**Statut :** accepté (2026-10-26), jalon 1, derrière la section `ai` d'`environment.yml` (absente :
pas d'assistant). Suite de `mcp-server`.

## Contexte

Le jalon 0 (`mcp-server`) ouvre Artisan aux clients d'IA que les joueurs ont déjà. Il reste
l'usage le plus direct : demander, depuis l'éditeur ouvert sur un Project, « fais-moi un menu VIP »,
sans installer de client ni se connecter ailleurs. La proposition prévoit deux façons de payer le
modèle : un service cloud d'Artisan (portefeuille par serveur), ou le fournisseur et la clé de
l'admin. Le cloud demande une infrastructure et une facturation ; la clé de l'admin, rien de plus
que le hub. Un seul utilisateur d'Artisan à cette date : la clé de l'admin d'abord.

## Décisions

1. **Le hub fait tourner la boucle.** `POST /api/v1/ai/conversations/:id/messages` : le hub appelle
   le modèle, exécute ses appels d'outils, renvoie les résultats, jusqu'à la fin du tour. La clé
   reste dans le hub, jamais dans le navigateur ni dans l'éditeur. L'éditeur lit les événements
   (`user`, `text`, `tool`, `notice`, `error`, `done`, numérotés) par sondage, en ne demandant que
   les nouveaux (`?after=`) ; pas de flux à tenir ouvert à travers le tunnel.
2. **Les mêmes outils que `/mcp`, le même périmètre.** L'assistant reçoit les sept outils de
   `McpTools` (`invoke`, partagé avec `McpRoutes`) et agit comme le joueur de la session, moins
   `publish` et `config`. Il écrit des brouillons vérifiés par le serveur, il ne déploie pas. Un
   brouillon qu'il crée se propose dans le panneau : « Ouvrir dans Brouillons ».
3. **Un fournisseur derrière une interface.** `AiProvider` / `AiConversation` : chaque fournisseur
   garde l'historique dans ses propres types. Premier fournisseur : Anthropic, par le SDK Java
   officiel (`com.anthropic:anthropic-java`, embarqué sans relocalisation : il charge des classes par leur nom ; okhttp et Jackson partagés, eux relocalisés).
   Historique en ajout seul (les réponses repartent telles quelles, blocs de réflexion compris),
   outils et prompt système fixes par conversation, cache de prompt automatique, `effort`
   configurable (défaut `medium`), repli côté serveur sur refus d'un classifieur pour les modèles
   qui l'acceptent, et seulement vers l'API d'Anthropic (pas derrière `base-url`).
4. **Configuration** (`environment.yml`, hub seul, jamais envoyée à l'éditeur) : `ai.provider`
   (`anthropic`), `ai.api-key` (`${ANTHROPIC_API_KEY}` conseillé), `ai.model` (défaut
   `claude-opus-5-5`), `ai.effort`, `ai.max-steps` (appels au modèle par message, 25), `ai.base-url`.
5. **Garde-fous de coût.** Un tour par conversation à la fois (`ai_busy`), `max-steps` appels par
   message, 16 000 jetons de sortie par appel, 10 conversations par joueur, oubliées après 6 h
   sans activité. Les jetons consommés sont comptés par conversation et montrés à la fin du tour.
6. **Conversations en mémoire.** Un redémarrage les termine (les brouillons écrits restent) ; le
   message suivant en commence une autre. Chaque conversation appartient à son joueur : un autre
   reçoit 404.
7. **Qui y a droit : `artisan.editor.edit`**, comme `/mcp`. `GET /api/v1/ai` dit à l'éditeur s'il y
   a un assistant et si le joueur peut s'en servir ; sinon le bouton n'apparaît pas.

## Conséquences

- L'admin paie chaque message de tout joueur qui a `edit`. Pas de quota par joueur ni de
  permission dédiée au jalon 1.
- Le jar grossit du SDK d'Anthropic (paquet `com.anthropic` tel quel) et de son générateur de schémas ; Jackson passe de
  2.17.2 à 2.18.3.
- Ce que l'assistant écrit passe la même vérification que `write_document`, puis la même revue et
  le même `DocumentCheck` au déploiement.

## Reporté

- Le service cloud d'Artisan et le portefeuille par serveur, derrière le même relais.
- D'autres fournisseurs (API compatibles OpenAI : Mistral, OpenRouter, Ollama) : une implémentation
  d'`AiProvider` de plus.
- Une permission `artisan.editor.ai` et un quota par joueur, si d'autres que l'admin s'en servent.
- Les conversations en base (survivre à un redémarrage, reprendre sur un autre appareil).
- Le texte en flux continu et les notes de progression du modèle entre deux outils
  (`display: "updates"`).
