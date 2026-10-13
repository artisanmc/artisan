# Versioning & négociation du contenu (wire éditeur → plugin)

**Statut : remplacé (phase F, 2026-10)** — plus d'éditeur central face à des plugins d'âges différents : éditeur et hub voyagent dans le même jar, et le `hello` des feuilles porte `protocol_version` (majeure différente = serveur non servi). Voir [editor-web-server](editor-web-server.md).

**Status:** proposed (2026-10-01)

## Contexte

L'éditeur est **central** (une app web), les plugins sont **par serveur** et se
mettent à jour indépendamment. Le **format des fichiers de projet** est un
contrat **producteur (éditeur) → consommateur (plugin)**.

L'ADR `structured-action-wire` a changé ce format de façon **cassante** en place
(`menu/v1` : string DSL → étapes keyed), en s'appuyant sur l'hypothèse « pas
encore en prod ». Cette hypothèse est morte : dès qu'il y a plusieurs serveurs,
un plugin en retard **ne peut plus lire** ce que le nouvel éditeur écrit →
« le serveur n'exécute pas ce document ». « Déployer le plugin d'abord » ne tient
pas à l'échelle.

Or la plateforme applique **déjà** une discipline de versioning au REST
(`/api/v1/`), au schéma DB (migrations) et aux schémas de documents
(`menu/v1`) — mais elle n'a **aucune négociation** entre l'éditeur et le plugin :
ni le `protocol_version`/`core_version` (envoyés dans `hello`, jamais persistés),
ni les capacités (in-memory, gatées à l'écriture) ne décrivent la **version du
format de contenu**.

## Décision

1. **Le wire de contenu est une version explicite `content_version` (entier),
   annoncée par le plugin dans `hello`.** Absente = `1` (ancien wire DSL).
   Version courante : **2** = étapes structurées keyed (ADR
   `structured-action-wire`). Toute évolution **cassante** du format incrémente
   cette version.

2. **La plateforme déclare un minimum** (`MIN_CONTENT_VERSION`). Le backend
   **refuse les écritures** vers un serveur dont `content_version` est inférieur
   (erreur `plugin_update_required`, déjà câblée HTTP 503 + messages localisés).
   → On ne produit **jamais** de fichiers que la cible ne saura pas lire.

3. **Le backend suit la version par serveur** (registre in-memory, comme les
   capacités) et l'**expose** via `GET /networks/:id/servers-status`. L'éditeur
   affiche un **bandeau « plugin obsolète »** et **bloque l'enregistrement** pour
   ce serveur, avec le lien de mise à jour.

4. **Défense en profondeur** : le blocage backend (2) reste même si l'UI ne
   l'affiche pas — l'écriture est la dernière barrière.

5. **Jamais de changement de format en place.** Désormais : nouvelle version de
   `content_version` **et** nouveau dossier de schéma (`menu/v2`, `command/v2`),
   le plugin lisant **toutes** les versions qu'il supporte ; on déprécie par
   paliers de `MIN_CONTENT_VERSION`.

*Rejeté pour l'instant :* **dégrader automatiquement** (l'éditeur ré-émettant
l'ancien format pour un plugin en retard) — ça exige de garder N sérialiseurs et
le codec DSL comme writer pour toujours ; on préfère bloquer/signaler tant que la
flotte est petite. À réévaluer quand la flotte grandit.

*Hors périmètre (suites)* : **négociation de capacités** fine (l'éditeur n'émet
un construct que si le plugin l'annonce) + **traduction backend** (l'éditeur
envoie une forme canonique, le backend traduit vers la version cible) ; et
**auto-update opt-in** (jar signé + vérif de signature, rollout par paliers,
rollback, canaux) — jamais par défaut.

## Conséquences

- Déployer l'éditeur ne casse plus un serveur en retard : l'écriture est
  **refusée clairement** (`plugin_update_required`), pas corrompue.
- L'admin d'un serveur en retard ne peut **pas éditer** tant qu'il n'a pas mis à
  jour son plugin — comportement voulu, avec message explicite.
- Le backend distingue désormais **contenu** (`content_version`) et
  **capacités/features** (`mixed_project_write_v1`, …) ; les deux coexistent.
- Le drain de la dette « lecteur DSL legacy » (P6 de
  `structured-action-wire`) devient sûr : une fois `MIN_CONTENT_VERSION = 2` et
  tous les serveurs ≥ 2, le lecteur legacy peut tomber.
- Champs à ajouter au protocole : `content_version` dans `hello`
  (`WsClient.kt`), `HelloMessage` (`protocol.ts`), suivi + gate (`hub.ts`),
  `servers-status` (REST), `ServerStatusEntry` + bandeau (éditeur).
- Docs : `docs/architecture/ws-protocol.md` (hello/hello_ack),
  `docs/architecture/rest-endpoints.md` (`servers-status`).
