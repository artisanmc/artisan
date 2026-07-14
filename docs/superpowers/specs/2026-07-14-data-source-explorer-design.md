# Data source explorer, preview live & filtres menu — Design

**Date** : 2026-07-14 · **Statut** : validé (brainstorm avec Iban)

## Objectif

Rendre les sources de données visibles et exploitables dans l'éditeur :
1. L'onglet Sources de données montre les sources déclarées par les modules du serveur (schéma + module d'origine + preview des données réelles).
2. Un menu peut filtrer une source (champ = valeur / `{arg}`, tri, limite) via une UI, au lieu de champs YAML opaques.
3. Un menu sélectionné expose une section « Données du menu » : ses sources, leurs filtres, et une preview des rows avec filtres appliqués.

## Décisions (brainstorm 2026-07-14)

| Question | Décision |
|---|---|
| Données affichées | **Vraies données du serveur** via un nouveau chemin request/response WS (pas de samples statiques). |
| Contexte joueur du fetch | **`player: Player?`** — `null` = preview ; un module player-dépendant renvoie des données génériques ou lève `PlayerRequiredException`. |
| Schéma | **Déclaré par le module** (champs typés dans `DataSourceDeclaration`) ; `schemaHint` déprécié `@Sunset`. |
| Scoping workspace | **Regrouper sans restreindre** : groupement + badge par module d'origine, aucune restriction dure (cohérent avec la philosophie non-hermétique de l'éditeur). Nota : aucun lien projet↔module n'existe dans le modèle (seulement serveur↔module) — la « mise en avant des sources du module lié au projet » est donc reportée hors V1. |
| Filtres menu | **UI sur le runtime existant** (`filter` égalité + interpolation `{arg}`, `sort`, `limit`) — l'Expression DSL reste une épopée séparée (spec 2026-05-03). |
| Vue par menu | **Section du panneau propriétés** (pas de données réelles dans le canvas en V1). |
| Transport preview | **Requête/réponse par-dessus le WS plugin** : REST → message WS corrélé → réponse plugin → REST. Rejeté : push périodique de samples (données périmées, payloads lourds), fetch fire-and-forget via `module_event` (UX asynchrone fragile, événements non consommés client-side). |

## 1. API plugin — schéma déclaré + ownership module

`net.artisanmc.modules.api.DataSourceDeclaration` (`@Stable` — l'ajout de `schema` est rétro-compatible ; le passage de `fetcher` à `Player?` est un changement source-visible assumé, documenté ci-dessous) :

```kotlin
data class DataSourceField(
    val name: String,
    val type: FieldKind,          // STRING | NUMBER | INTEGER | BOOLEAN | LIST | OBJECT
    val description: String? = null,
)

data class DataSourceDeclaration(
    val ref: String,
    val fetcher: (player: Player?, params: Map<String, Any?>) -> List<Map<String, Any?>>,
    val schema: List<DataSourceField> = emptyList(),
    @Sunset val schemaHint: String? = null,
)

class PlayerRequiredException(message: String? = null) : RuntimeException(message)
```

- `fetcher` reçoit `player = null` en mode preview. Breaking signature Kotlin (`Player` → `Player?`) : les lambdas existantes compilent telles quelles (paramètre non utilisé ou usage à adapter) ; CHANGELOG `[Unreleased]` + note `api-surface.md`.
- `DataSourceRegistry` capture le **module propriétaire** au `register(...)` : le handle `ArtisanAPI` remis à chaque module connaît son id de module ; le registry stocke `ref → (declaration, moduleId)`. Aucun nouveau paramètre public.

**Propagation** : payload `hello`/heartbeat `data_sources` passe à `[{ref, module_id, schema: [{name, type, description}]}]` (l'ancien champ `schema_hint` reste envoyé tant que `@Sunset`). Table `server_data_sources` : + colonnes `module_id` (text nullable) et `schema_json` (jsonb/text nullable), migration `db:generate` committée. `GET /api/v1/networks/:nid/servers/:sid/data-sources` renvoie `{ref, module_id, schema, schema_hint}`.

## 2. Chemin de preview (fetch live)

`POST /api/v1/networks/:networkId/servers/:serverId/data-sources/preview` (cookie-auth + membership) :

```jsonc
// body
{ "ref": "boutique:items", "params": {}, "filter": {"category": "armes"}, "sort": {"by": "price", "direction": "asc"}, "limit": 27 }
// 200
{ "rows": [ {…}, … ], "truncated": false }
```

Flux :
1. Backend vérifie que le serveur est connecté au hub — sinon `503 server_offline`.
2. Backend envoie WS `data_source_fetch` `{request_id, ref, params, filter, sort, limit}` au plugin et enregistre `request_id` dans une map de requêtes en attente. Timeout **5 s** → `504 fetch_timeout` (couvre aussi les plugins anciens qui ignorent le message — forward-compat existante).
3. Plugin : réception sur le thread WS OkHttp → **bascule main thread Bukkit** (les fetchers touchent l'API Bukkit) → `fetcher(null, params)` → shaping via le code existant de `ContextBinder` (filter/sort/limit — la preview reflète exactement le runtime) → réponse hors main thread : `data_source_fetch_result` `{request_id, ok, rows?, error?}`.
4. Garde-fous plugin : rows tronquées à **50**, payload ≤ ~256 KB. Erreurs typées : `unknown_source`, `player_required`, `fetch_error` (avec message).
5. Backend résout la requête en attente et répond au REST.

Docs same-commit : `protocol.ts`, `ws-protocol.md`, `rest-endpoints.md`, CHANGELOG.

## 3. Onglet Sources de données — explorateur

L'onglet conserve « Pack data » et « Connecteurs importés », et gagne une section **« Sources du serveur »** :

- Rendu du store presence existant (`serverDataSourcesStore`, aujourd'hui fetché mais jamais affiché), **groupé par `module_id`** avec badge du module (groupes triés alphabétiquement, sources core en premier ; `module_id` absent → groupe « Serveur »). Toutes les sources restent utilisables partout.
- Détail d'une source : table de schéma (nom / type / description), ref copiable, bouton **Prévisualiser** → route §2 sans filtres → table de rows (max 50, mention « tronqué »).
- États : serveur offline (schémas et badges restent visibles — métadonnées en DB ; preview désactivée avec explication), `player_required`, erreur module, timeout (« plugin à mettre à jour ou serveur injoignable »).
- Design system : `Card`, `Badge`, `Tabs`, `EmptyState` existants ; nouveau composant **`ui/DataTable`** (table de rows) avec spécimen dans `/admin/design`, réutilisé par §4. i18n en+fr.

## 4. Côté menu — éditeur de filtres + section « Données du menu »

Dans `MenuProperties`, pour chaque `contextInput` de kind `sourceRef` :

**Éditeur de filtres** (aucun changement runtime — UI sur `filter`/`sort`/`limit` existants) :
- Lignes « champ = valeur » : champ autocomplété depuis le schéma déclaré (saisie libre si schéma absent) ; valeur littérale ou `{arg}` (autocomplétion des args du menu). Cas nominal « quête courante » : `group = {group}`.
- Tri (champ + asc/desc), limite (numérique).
- Les `filter`/`sort`/`limit` importés du YAML (portés opaquement aujourd'hui) deviennent éditables ; round-trip export inchangé.

**Section « Données du menu »** : une carte par source consommée — ref + badge module, résumé des filtres actifs, bouton **Prévisualiser** appelant la route §2 **avec les filtres du menu**. Les `{arg}` non résolus : petit formulaire de valeurs d'essai (hint « filtre sur {group} : renseigne une valeur d'essai ») ; non renseigné = interpolé à vide côté plugin (comportement runtime existant). Résultat dans `ui/DataTable`.

## Tests

- **Backend** : route preview (happy path, membership, 503 offline, 504 timeout, corrélation de deux requêtes concurrentes, propagation d'erreurs typées) ; persistence `module_id`/`schema_json` depuis hello.
- **Plugin** : handler `data_source_fetch` (exécution main thread, shaping filter/sort/limit, troncature 50/256 KB, `player_required`, `unknown_source`) ; registry capture le module owner ; payload hello enrichi.
- **Éditeur** : section Sources du serveur (groupement, offline, preview + erreurs), éditeur de filtres (autocomplétion schéma/args, round-trip import), section Données du menu (filtres appliqués, valeurs d'essai).

## Hors scope V1

- Expression DSL pour les filtres (spec séparée `2026-05-03-expression-dsl-design.md`).
- Données réelles dans le canvas (slots peuplés par le fetch).
- Sélecteur de joueur en ligne pour la preview (`player = null` seulement).
- Restriction dure des sources par workspace (opt-in module éventuel plus tard).
- Push WS temps réel des changements de sources (le refresh presence existant suffit).
