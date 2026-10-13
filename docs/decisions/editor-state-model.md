# Editor state model — backend-authoritative with broadcast collaboration

**Statut : remplacé (phase F, 2026-10)** — plus de backend autoritaire : le disque du serveur fait foi, l'éditeur publie par compare-and-swap. Voir [editor-web-server](editor-web-server.md).

**Status :** accepted (2026-04-29)

## Décision

Le **backend est autoritaire** sur l'état d'un menu en édition. Chaque mutation effectuée dans un client (browser) est envoyée via WebSocket au backend, validée contre l'état canonique, appliquée, puis rebroadcastée à **tous les clients connectés** sur ce menu — autres browsers admin **et** plugin Minecraft.

Architecture :

- **Browser** : Zustand store en optimistic update à l'émission, réconcilié avec l'état canonique reçu en broadcast. zundo pour undo/redo local.
- **localStorage** : write synchrone à chaque mutation locale. Filet de récupération si tab crash entre la mutation et son ack backend (rare ; le RTT WS est ~30 ms).
- **Backend** : tient l'état canonique en mémoire par menu actif. Applique les mutations dans l'ordre d'arrivée (last-writer-wins). Rejette les mutations syntaxiquement invalides ou cibles disparues (ex. `element.delete` sur un id déjà supprimé) avec un message d'erreur au client originant uniquement.
- **Persistance DB** : le backend snapshot l'état canonique sur Postgres toutes les 10s en debounce d'idle. Pas de write-per-mutation.
- **Plugin** : abonné comme un client de plus. Reçoit les mêmes mutations que les browsers, les applique aux inventaires ouverts.

**Pas de soft-lock, pas de "Take Over"** — la spec en avait, on s'en débarrasse. Un **indicateur de présence** affiche qui d'autre est connecté sur le menu (avatar Discord + statut). En cas d'édition simultanée à deux admins (rare au MVP : compte solo majoritaire), LWW + présence visible suffit. Si ça devient un vrai problème en V2, on ajoute un mode "édition exclusive" à toggler.

## Pourquoi ce revirement

L'alternative initialement choisie (browser-canonical + lock TTL/heartbeat/take-over) coûtait à peu près autant à construire que la version broadcast — endpoint de lock, heartbeat client, expiration server-side, notification WS à la prise/relâche, UX de Take Over. Mais seule la version broadcast est **vendable comme feature** : voir son co-admin déplacer un slot en temps réel est l'effet "wow" qui se démontre en 5s en démo. La verison lock se contente d'éviter les conflits — bénéfice invisible.

## Trade-offs acceptés

- **Backend stateful.** Une instance Fly doit héberger l'état canonique d'un menu actif. Implique sticky session par `menu_id` (header ou cookie de routing), eviction après N min d'idle, reconstruction depuis DB au cold start. Coût d'infra modéré, géré par Fly's session affinity.
- **LWW peut écraser du travail.** Si deux admins éditent le même slot en même temps, le dernier gagne sans warning. Mitigation : présence visible. À surveiller en feedback utilisateur post-launch ; si vrai problème, ajout d'un mode exclusif.
- **Reconnexion mid-édit.** Le client qui se reconnecte reçoit un full snapshot du menu canonique, jette son state local en cas de divergence (avec prompt si localStorage timestamp > snapshot timestamp).
- **Crash backend.** Les mutations buffered côté browser depuis la dernière persistance (≤10s) sont rejouées à la reconnexion. État canonique reconstruit depuis DB + replay (limité aux 10 dernières secondes côté clients).

## Conséquences sur le reste de l'archi

- Le canal WS browser→backend→plugin n'est plus juste un push unidirectionnel ; c'est un bus de mutations bidirectionnel. Le plugin est un subscriber comme un autre.
- Le format des mutations doit être un **événement de domaine** (cf. ADR à venir sur la taxonomie des mutations) pour rester lisible en log et trivial à appliquer côté plugin Java.
- L'API HTTP `PUT /menus/:id/draft` côté client disparaît (la persistance est interne au backend). Reste les endpoints REST pour les opérations non-temps-réel : list, create, fork, publish, history fetch.
