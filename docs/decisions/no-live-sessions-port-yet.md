# Pas de port `LiveSessions` tant que le multi-instance n'est pas engagé

**Statut : remplacé (phase F, 2026-10)** — `ws/hub.ts` et le backend sont supprimés ; l'état temps réel vit dans le hub du plugin (`Servers`, `Sessions`, `EditorChannel`). Voir [editor-web-server](editor-web-server.md).

**Status :** accepted (2026-06-17)

## Décision

Le `ws/hub.ts` reste l'**unique adapter in-memory** de l'état temps-réel (connexions plugin/éditeur, broadcast, présence). On **n'introduit pas** d'interface `LiveSessions` (port) avec un adapter swappable tant que le backend est single-instance.

Les routes continuent de consommer le hub via ses **fonctions exportées** (`pushBundleAvailable`, `broadcastDraftUpdate`, `pushPackDeleted`, `pushResourcePackUpdated`, `pushLinkConfirmed`, `getInstanceCount`, `getMcVersion`, `disconnectServerKey`, `trackEditorIp`). Les maps in-memory (`connSenders`, `connToServerId`, `editorSenders`, `editorTokenToServer`) restent privées au module, exportées **uniquement** pour l'injection de `send` dans les tests.

## Pourquoi

Une revue d'archi (2026-06-17) a proposé d'extraire un port `LiveSessions` pour « empêcher les routes de taper dans les maps in-memory ». Vérification faite, la prémisse est fausse :

1. **Aucune fuite en production.** Toutes les routes importent des **fonctions** du hub, jamais les maps. Les maps ne sont importées que par `hub.test.ts`, `editorSession.test.ts` et le câblage WS (`app.ts`). Le hub présente donc déjà une interface fonctionnelle.
2. **Testabilité déjà acquise.** Sans connexions live, les broadcasters itèrent des maps vides (no-op), `getInstanceCount`→0, `getMcVersion`→fallback DB. Les routes sont testables sans WS. Les tests qui doivent asseoir un broadcast injectent un `send` factice dans les maps — un **seam de test interne** légitime, pas une fuite.
3. **Un seul adapter = seam hypothétique.** Le seul moteur réel d'un port serait le **multi-instance** (état partagé Redis / table PostgreSQL), explicitement noté comme un « si » futur dans `decisions/stack.md` (§ Sessions WS). Il n'est pas engagé. Introduire le port maintenant créerait une interface pour un second adapter qui n'existe pas — exactement le « one adapter = hypothetical seam » à éviter.

`hub.ts` est **large** (≈581 LOC, ~16 fonctions) mais **pas shallow** : chaque fonction porte du vrai comportement (broadcast ciblé par `server_key`, handshake protocolaire, présence). « Large » n'implique pas « à déprofondir ».

## Conséquences

- Le hub reste un module-singleton à état module-level. Acceptable en single-instance.
- **Condition de réouverture** : le jour où le multi-instance est réellement engagé (plusieurs process backend derrière un LB, sticky-session insuffisant). À ce moment, deux adapters existent pour de vrai (in-memory + partagé) → le seam devient réel : extraire une interface `LiveSessions`, faire du hub l'adapter in-memory, ajouter l'adapter partagé. Concevoir l'interface **contre les deux adapters**, pas dans le vide.

## Alternatives écartées

- **Extraire le port maintenant.** Rejeté : seam hypothétique à un seul adapter, sans gain de testabilité (déjà acquise) ni de localité réelle.
- **Scinder `handlePluginMessage` (handler protocolaire) de la registry/broadcast.** Le handler est profondément intriqué avec les maps (il les lit et mute dans presque toutes les branches) ; les séparer revient à injecter la registry — c'est-à-dire le même port spéculatif. Reporté avec cette décision.
