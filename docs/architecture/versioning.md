# Artisan — Versioning et stabilité d'API

Manuel de référence pour faire évoluer Artisan sans casser les serveurs et modules existants. Couvre les 6 surfaces de versioning, les patterns de migration, la politique de dépréciation, la discipline CHANGELOG.

**Statut** : architecture cible — V1 implémente le minimum nécessaire, le reste s'ajoute organiquement.

---

## 1. Les 6 surfaces de versioning

Artisan a 6 contrats distincts à gérer. Chacun a sa propre discipline.

| Surface | Concerne | Stratégie |
|---|---|---|
| **1. Schemas de données** | `menu/v1`, `command/v1`, `shop/v1`, ... | Versioning explicite + migration framework |
| **2. API Java publique** | `ArtisanAPI` + classes exposées aux modules | SemVer strict + `@Stable`/`@Beta`/`@Internal` |
| **3. Protocol WebSocket** | Messages hub ↔ serveur (`/ws/plugin`) | `protocol_version` majeur.mineur au `hello` ; majeure différente = serveur non servi |
| **4. REST API** | Routes du hub ↔ éditeur | URL versioning `/api/v1/*` ; éditeur et hub livrés dans le même jar |
| **5. Database schema** | Tables des plugins de la suite (H2, MySQL, MariaDB) | Chaque plugin migre ses propres tables ; Artisan n'en a aucune |
| **6. Resource pack format** | CMD strings, fonts, asset structure | `pack_format` + asset registry versionné |

Toutes ces surfaces doivent rester **backward compatible** dans une même major version.

---

## 2. Schemas de données

### 2.1 Pattern de nommage

Chaque schema vit dans `/docs/schema/{name}/v{N}/` avec :

- `schema.json` (JSON Schema Draft 2020-12)
- `types.ts` (TypeScript miroir)
- `README.md` (doc design + use cases)
- `examples/*.json` (cas de test)

Le `"schema"` field discrimine la version :

```json
{
  "schema": "menu/v1",
  "id": "shop_main",
  ...
}
```

### 2.2 Règles d'évolution

**Au sein d'une même version (menu/v1 → menu/v1)** :

- ✅ Ajouter des champs **optionnels** (backward compat)
- ✅ Élargir des constraints (`maxLength` plus permissif, `enum` avec plus de valeurs)
- ✅ Ajouter des `$defs` ou patterns
- ✅ Améliorer descriptions, examples, error messages
- ❌ Ajouter un champ **required** (force tous les producers à le fournir)
- ❌ Resserrer des constraints (`maxLength` plus restrictif, `enum` avec moins de valeurs)
- ❌ Renommer un champ existant
- ❌ Supprimer un champ existant
- ❌ Changer le type d'un champ existant

**Pour les changements interdits** : tu fais une nouvelle version (`shop/v2`).

**Exception files-first — le renommage intra-version.** Les trois interdits de
renommage/suppression/retypage sont calqués sur des surfaces où le **producteur
est un tiers**. Pour les schémas de Document, le producteur est notre writer
canonique et le consommateur lit du disque. La règle réellement appliquée est
donc : *un renommage ou une suppression de champ est permis dans la version tant
qu'aucun fichier existant ne cesse d'être lisible* — soit parce que le reader
reste tolérant à l'ancienne forme, soit parce qu'on sait que ces fichiers
n'existent pas ailleurs que chez nous. **La version change quand un fichier
déployé cesserait d'être lisible**, pas quand le schéma change de forme.

Appliqué quatre fois sur `menu/v1` : `steps` → `actions`, l'aplatissement
`layers` → `elements`, le retrait de `appearances` au profit de
display + `states` (ADR `element-display-and-states`), et le repli de
`menu/v2`/`menu/v3` (2026-09-17, cf. `schemas-codegen.md`) — deux versions
n'ayant transformé aucune donnée, dont les étiquettes restent acceptées en
lecture pour les fichiers déjà écrits.

### 2.3 Migration framework

Quand tu introduis une v2, tu écris une **migration** v1 → v2. Elle n'a de
raison d'être que si elle **transforme** des données : une migration qui se
contente de réécrire le champ `schema` signale une version qui n'aurait pas dû
naître (c'est ce qui est arrivé à `menu/v2` et `menu/v3`, repliés depuis).

```kotlin
// /plugin/src/main/kotlin/net/artisanmc/core/schemas/migrations/ShopV1ToV2.kt
class ShopV1ToV2 : SchemaMigration<JsonObject> {
    override val from = "shop/v1"
    override val to = "shop/v2"
    
    override fun migrate(data: JsonObject): JsonObject {
        // Migration logic : rename "size" → "dimensions", split layers...
        val result = data.deepCopy()
        result["schema"] = JsonPrimitive("shop/v2")
        result["dimensions"] = jsonObject {
            "rows" to (data["size"].asInt / 9)
            "type" to "chest"
        }
        result.remove("size")
        return result
    }
}
```

### 2.4 Registry et runtime

Le plugin core enregistre toutes les migrations connues. Au load d'un menu :

```kotlin
class SchemaRegistry {
    private val migrations = mutableMapOf<String, SchemaMigration<JsonObject>>()
    
    fun register(migration: SchemaMigration<JsonObject>) {
        migrations[migration.from] = migration
    }
    
    fun loadToCurrent(json: JsonObject, currentVersion: String): JsonObject {
        var current = json
        var version = current["schema"].asString
        val visited = mutableSetOf<String>()
        
        while (version != currentVersion) {
            if (version in visited) throw CircularMigrationException(version)
            visited.add(version)
            
            val migration = migrations[version]
                ?: throw UnsupportedSchemaVersionException(version)
            current = migration.migrate(current)
            version = current["schema"].asString
        }
        return current
    }
}
```

Les migrations sont **chaînées automatiquement** : un menu `menu/v1` peut traverser v1 → v2 → v3 au load sans intervention.

### 2.5 Règles d'or

- Une migration est **write-once** : tu ne la modifies jamais après ship. Si bug, tu écris une migration v2 → v2.1.
- Une migration est **idempotente** : la lancer 2x sur la même donnée = même résultat.
- Une migration est **pure** : pas de side effects, pas de network calls, pas de DB writes. Juste data → data.
- **Tests obligatoires** : chaque migration a un test unitaire avec input v1 + expected output v2.

### 2.6 Sunset des anciennes versions

Une version `menu/v1` reste **supportée indéfiniment via migration** tant que le plugin tourne. La migration est gratuite à maintenir une fois écrite.

**Tu ne supprimes JAMAIS** une migration. Elle est nécessaire pour les serveurs qui chargent du legacy data.

---

## 3. API Java publique

### 3.1 Séparation des packages

```
net.artisanmc.core
├── api/                          ← Public stable API (covered by SemVer)
│   ├── ArtisanAPI.kt
│   ├── ArtisanModule.kt
│   ├── DataSourceRegistry.kt
│   ├── CommandRegistry.kt
│   ├── SchemaRegistry.kt
│   ├── ModuleRegistry.kt
│   ├── declarations/
│   │   ├── DataSourceDeclaration.kt
│   │   └── CommandDeclaration.kt
│   ├── events/
│   │   ├── MenuOpenedEvent.kt
│   │   ├── CommandExecutedEvent.kt
│   │   └── ModuleEnabledEvent.kt
│   └── annotations/
│       ├── Stable.kt
│       ├── Beta.kt
│       ├── Internal.kt
│       └── Deprecated.kt
└── internal/                     ← Internals, peuvent changer sans préavis
    ├── engine/
    ├── sync/
    ├── storage/
    └── impl/
```

**Règle absolue** : les modules **N'IMPORTENT** que depuis `net.artisanmc.api.*`. Jamais depuis `net.artisanmc.internal.*`.

### 3.2 Annotations de stabilité

`plugin/api` est écrite **en Java** depuis l'API 2.0.0 (ADR `extensible-document-kinds`, « Langue de
l'API publique ») : interfaces, classes immuables, enums, callbacks `@FunctionalInterface`, aucun type
`kotlin.*` et pas de `kotlin-stdlib` dans le POM. Les annotations vivent dans
`net.artisanmc.modules.api.annotations` :

```java
@Retention(RetentionPolicy.SOURCE) public @interface Stable {}    // couverte par SemVer
@Retention(RetentionPolicy.SOURCE) public @interface Beta {}      // peut changer en mineure
@Retention(RetentionPolicy.SOURCE) public @interface Internal {}  // interdit aux modules

@Retention(RetentionPolicy.RUNTIME)
public @interface Sunset {                 // dépréciation datée, remplace @Deprecated
    String reason();
    String removeInVersion();
    String replacement() default "";
}
```

`ApiSurfaceIsJavaFriendlyTest` échoue si une classe Kotlin apparaît dans `plugin/api/src/main` ou si
un type `kotlin.*` traverse une signature publique.

### 3.3 SemVer strict

L'API publique du core suit **SemVer strict** :

- **Patch (1.0.0 → 1.0.1)** : zero changement de signature. Bug fixes internes uniquement.
- **Minor (1.0.0 → 1.1.0)** : ajouts de méthodes, classes, fields OK. Pas de retrait, pas de changement de signature existante.
- **Major (1.0.0 → 2.0.0)** : retrait, breaking changes OK. Éviter au max.

La version publiée est la plus haute valeur `Since` d'`api-surface.md` : la monter dans la PR suffit à publier la release au merge (`publish-api.yml`, détail dans `api-surface.md` § Published artifact).

### 3.4 Deprecation flow

Quand tu veux retirer une API en major :

1. **N mois avant la major (où N ≥ 3)** : marque `@Sunset(reason=..., removeInVersion="3.0.0", replacement="newMethod()")`.
2. Le compileur warn les modules qui l'utilisent.
3. `@Sunset` apparaît dans le CHANGELOG.
4. **Au release de la major** : la méthode est supprimée.
5. Les modules incompatibles fail gracefully (cf. modules.md section 13).

### 3.5 Bytecode compatibility

Au-delà de la source compatibility, **veille à la binary compatibility** :

- Ne change pas la signature d'une méthode publique (paramètres, types de retour, exceptions)
- N'ajoute pas un paramètre required à une méthode existante (ajoute une surcharge Java)
- N'enlève pas un constructor public
- Ne réordonne pas les éléments d'une enum

Outil : `japicmp` en CI pour catch les regressions binary compat avant release.

---

## 4. Protocol WebSocket

Depuis la phase F (2026-10), le protocole relie le hub (serveur web de l'éditeur) aux serveurs
du réseau ; il n'y a plus de backend ni de plugins d'âges différents face à un service central.
Le risque reste : hub et feuilles sont des jars distincts, mis à jour à des moments différents.

### 4.1 Version dans le handshake

```json
{
  "type": "hello",
  "protocol_version": "1.5",
  "server_key": "<secret du réseau>",
  "proxy_name": "survie2",
  "plugin_version": "1.0.42",
  "minecraft_version": "1.21.7",
  "installed_modules": [{ "id": "menus", "version": "1.0.42" }]
}
```

`ProtocolVersion.CURRENT` (`plugin/core/…/protocol/ProtocolVersion.kt`) :

- **Majeure** : change quand un message existant change de sens. Majeure différente de celle du
  hub → serveur listé « mise à jour requise » (`updateRequired`), le hub ne lui envoie plus rien,
  toute route qui le vise répond 503 `plugin_update_required`.
- **Mineure** : ajoute des champs ou des messages, que l'autre côté ignore. Une route qui envoie un
  message ajouté vérifie la mineure du serveur visé et répond 501 `plugin_update_required` au lieu
  d'attendre un timeout (`1.1` : `project_create`, `project_delete`, `project_rename`). `1.2`
  (`EDITOR_BUNDLES`) ajoute `editor_bundle` aux `installed_modules` et `editor_bundle_fetch` ; une
  feuille plus ancienne n'annonce aucun bundle, la route `ui.js` rend 404 sans rien lui envoyer.
  `1.3` (`TEMPLATES`) ajoute `templates` aux `installed_modules`, `template_fetch`, `template_copy` et
  `project_origins_fetch` ; une feuille plus ancienne reçoit 501 sur ces trois routes. `1.4`
  (`DOCUMENT_CHECKS`) ajoute `documents_check` (ADR `mcp-server`) ; l'outil MCP `write_document`
  refuse d'écrire dans un brouillon d'un Project dont le serveur est plus ancien. `1.5`
  (`SUITE_PLUGINS`) ajoute `suite_plugins` à l'annonce et `plugin` aux `installed_modules` ; une
  feuille plus ancienne annonce une liste vide.
- **Une release = un numéro** pour tous les jars ; mettre à jour hub et feuilles ensemble.

Le serveur qui héberge le hub lui parle en process (`LocalServerLink`) : jamais d'écart de version.

### 4.2 Messages non reconnus

Un message au `type` inconnu ou sans champ obligatoire **n'est jamais une erreur fatale** :
`EditorRequest.parse` rend `null` côté serveur, `RemoteServer.receive` ignore côté hub.

### 4.3 Évolution d'un message

Ajouter un champ optionnel : mineure. Renommer, retirer ou changer le sens d'un champ : majeure.
`server_key` (secret du réseau) et `proxy_name` (nom du serveur) gardent leurs noms hérités du
backend pour cette raison.

---

## 5. REST API

Depuis la phase F, l'API est servie par le hub et consommée par l'éditeur embarqué dans le même jar : un changement d'API et l'éditeur qui en dépend partent ensemble. Le préfixe `/api/v1/` reste, les règles ci-dessous ne valent que si un client externe apparaît.

### 5.1 URL versioning

```
/api/v1/menus
/api/v1/commands
/api/v1/workspaces
/api/v1/modules/shop/items     ← module-scoped
```

Pas de version dans les headers — toujours dans l'URL. Plus simple, plus visible, plus debuggable.

### 5.2 Évolution dans v1

**Au sein de v1**, tu peux :

- ✅ Ajouter de nouveaux endpoints
- ✅ Ajouter des fields optionnels à la réponse
- ✅ Accepter des nouveaux params optionnels
- ❌ Changer le type d'un field existant dans la réponse
- ❌ Retirer un field de la réponse
- ❌ Rendre required un param qui était optionnel

### 5.3 Bump vers v2

Quand un changement nécessite v2 :

1. **Tu copies les routes v1 → v2**.
2. **Tu modifies v2** avec les breaking changes.
3. **Tu marques v1 endpoints comme deprecated** :

```typescript
fastify.get("/api/v1/menus/:id", async (req, reply) => {
    reply.header("Sunset", "Wed, 01 Jan 2027 00:00:00 GMT");
    reply.header("Deprecation", "true");
    reply.header("Link", '</api/v2/menus/${req.params.id}>; rel="successor-version"');
    // ... handler
});
```

4. **Tu maintiens les 2 versions en parallèle pendant 6-12 mois**.
5. **Tu sunset v1** à la date annoncée.

### 5.4 Compatibility check editor

Sans objet tant que l'éditeur voyage dans le même jar que le hub qui sert l'API.

---

## 6. Database schema

Plus de PostgreSQL ni de migrations Drizzle depuis la phase F (2026-10) : l'historique des 66
migrations est au commit `ccade092` (branche `v2`).

Artisan prête une base à la suite (`environment.yml` → `database.type: h2 | mysql | mariadb`,
`DatabaseApi`, ADR `suite-foundation-database`) mais **n'y crée aucune table**. Chaque plugin de
la suite préfixe ses tables et apporte ses migrations ; la règle forward-only (ajouter, relâcher,
jamais détruire de données sans période de dépréciation) s'applique à chacun.

Ce qu'Artisan persiste vit sur disque (Projects, brouillons, `config.yml`, `environment.yml`,
cf. `entities.md`) : ses formats évoluent par les schémas versionnés (§2), pas par migration SQL.

---

## 7. Resource pack format

### 7.1 `pack.mcmeta` Minecraft

Le pack généré par Artisan inclut un `pack.mcmeta` standard :

```json
{
  "pack": {
    "pack_format": 22,
    "description": "Artisan custom assets pack"
  }
}
```

`pack_format` 22 = Minecraft 1.21+. Si tu supportes plusieurs versions MC, tu peux ship des packs spécifiques par version (multi-pack approach).

### 7.2 Asset registry interne

À la racine du pack, un fichier `artisan-assets/manifest.json` :

```json
{
  "schema": "artisan-assets/v1",
  "artisan_version": "1.0.0",
  "generated_at": "2026-01-15T10:30:00Z",
  "workspace_id": "ws_abc123",
  "server_key": "sk_def456",
  "assets": [
    {
      "id": "asset_shop_btn_buy",
      "cmd_string": "artisan:shop_btn_buy",
      "hash": "sha256:abc...",
      "size_bytes": 1234
    },
    ...
  ]
}
```

Le `cmd_string` est stable pour un asset donné. Une fois assigné, **tu ne le changes JAMAIS** — sinon tous les bundles déployés deviennent incohérents.

### 7.3 Stabilité des CMD strings

Règle d'or :

- Asset upload → CMD string assigné déterministiquement (basé sur asset id + hash)
- Asset id stable pour la vie de l'asset
- Si l'admin renomme l'asset, le id reste, le CMD reste, juste le label change
- Si l'admin supprime puis recrée, c'est un nouvel asset id, nouveau CMD

---

## 8. CHANGELOG.md discipline

### 8.1 Format Keep a Changelog

`/CHANGELOG.md` au root du repo. Format standard :

```markdown
# Changelog

All notable changes to Artisan Core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- New `dialog/v1` schema for dialog system.
- `ArtisanAPI.dialogs` registry.

### Deprecated
- `Menu.size` integer field, use `Menu.dimensions` instead.
  Will be removed in 2.0.0 (estimated 2027-Q2).

### Removed
- Nothing yet.

### Fixed
- Hot-reload no longer crashes when MCModels pack is empty.

## [1.5.0] - 2026-03-15

### Added
- Module `shop/v1` with item management, prices, categories.
- AI migration from DeluxeMenus format (in addition to zMenu).

### Changed
- `ArtisanAPI.dataSources.fetch()` is now async. Old sync version still available as `fetchSync()` until 2.0.

## [1.0.0] - 2026-01-15

### Added
- Initial public release.
- `menu/v1`, `command/v1`, `translations/v1` schemas.
- WebSocket sync, live edit, multi-server.
- AI migration from zMenu.
```

### 8.2 Règles

- **Chaque PR qui change l'API publique ajoute une entrée** dans `[Unreleased]`.
- À release time, `[Unreleased]` devient `[X.Y.Z] - YYYY-MM-DD`.
- Catégories : `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
- **Breaking changes** signalés en gras dans la catégorie pertinente.
- Lien GitHub du commit/PR pour chaque entry (optionnel mais utile).

### 8.3 Un CHANGELOG par release artifact

- `/CHANGELOG.md` pour le core
- `/modules/shop/CHANGELOG.md` pour le shop plugin (V1.5+)
- `/modules/quests/CHANGELOG.md` pour le quests plugin (V2+)
- etc.

Chaque .jar shippé sur SpigotMC/BBV a son propre CHANGELOG.

---

## 9. API surface documentation

`/docs/architecture/api-surface.md` — manuel de référence pour les plugin authors.

### 9.1 Structure proposée

```markdown
# Artisan Public API Surface (v1.x)

This document lists the **stable** API surface of Artisan Core that modules can safely depend on.
Anything not listed here is internal and may change without notice.

## Annotations

- `@Stable` — covered by SemVer
- `@Beta` — may change in minor versions
- `@Internal` — DO NOT USE
- `@Deprecated(reason, removeInVersion)` — will be removed

## Stable APIs (v1.x)

### `net.artisanmc.api.ArtisanAPI`
The main entry point exposed to modules.

| Member | Type | Since |
|---|---|---|
| `dataSources` | `DataSourceRegistry` | 1.0.0 |
| `commands` | `CommandRegistry` | 1.0.0 |
| `modules` | `ModuleRegistry` | 1.0.0 |
| `workspace` | `WorkspaceAccess` | 1.0.0 |
| `bootstrap` | `BootstrapManager` | 1.0.0 |
| `isCompatibleWith(version: String)` | `Boolean` | 1.0.0 |

### `net.artisanmc.api.ArtisanModule`
...

## Beta APIs (may change)

### `net.artisanmc.api.AIBridge` 
- **Beta since 1.0.0**, target stable 1.5.0
- Experimental, modules use at own risk.

## Deprecated APIs

### `ArtisanAPI.legacyMenu()` 
- **Deprecated since 1.2.0**, removed in 2.0.0
- Use `ArtisanAPI.menus.get()` instead.
```

### 9.2 Auto-génération

À terme, tu peux auto-générer cette doc depuis les sources Kotlin avec un plugin Gradle qui inspect les annotations `@Stable`, `@Beta`, `@Deprecated`. Pas critique V1.

---

## 10. Deprecation policy

### 10.1 Lifecycle d'une API

```
@Stable → @Deprecated → removed (in next major)
   ↑           ↓
   |     (3-6 mois minimum)
   |           ↓
   |     Communication users
```

### 10.2 Steps pour deprecation

1. Mark `@Deprecated(reason, removeInVersion, replacement)`.
2. Ajouter `### Deprecated` entry au CHANGELOG.
3. Annonce Discord + SpigotMC + roadmap publique.
4. Logger `WARN` quand un module appelle l'API deprecated.
5. **Attendre 3-6 mois minimum**.
6. **Major version bump** + retrait effectif.
7. Modules incompatibles fail gracefully (cf. modules.md section 13).

### 10.3 Cas spéciaux

- **Security issue dans une API stable** : tu peux la modifier en patch si la fix ne change pas la signature. Si elle doit changer, tu fais un security advisory + major rapide.
- **API jamais utilisée par personne** : si tu sais qu'aucun module n'a appelé cette API (zero usage analytics), tu peux retirer en minor avec mention au CHANGELOG. Risque acceptable.

---

## 11. Release checklist

Pour chaque release du core ou d'un module :

### 11.1 Pre-release

- [ ] Tous les tests passent (unit + integration)
- [ ] `japicmp` check sans regression binary compat
- [ ] CHANGELOG.md mis à jour, `[Unreleased]` devient `[X.Y.Z] - YYYY-MM-DD`
- [ ] Version bumpée dans `build.gradle.kts` + `plugin.yml`
- [ ] Si nouvelle API : `docs/architecture/api-surface.md` mis à jour
- [ ] Si nouveau schema : `/docs/schema/{name}/v{N}/` créé avec types.ts + examples
- [ ] Si migration nécessaire : code de migration + test unitaire
- [ ] Si breaking change : annonce Discord faite 3+ mois avant
- [ ] Si Minecraft ou PacketEvents a changé : checklist « Menus en paquets » passée en jeu (`testing.md`)

### 11.2 Release

- [ ] Git tag `v{X.Y.Z}` sur le commit de release
- [ ] GitHub Release créée avec les CHANGELOG entries
- [ ] `.jar` uploadé sur :
  - GitHub Releases
  - SpigotMC resource (free core) ou Premium Resources (modules)
  - Modrinth (core)
  - BBV / Polymart (modules premium)
- [ ] Le jar embarque l'éditeur (`./gradlew shadowJar -PwithEditor`)
- [ ] `artisan-api` publié (`maven-publish`)

### 11.3 Post-release

- [ ] Annonce Discord channel `#announcements`
- [ ] Tweet / Reddit r/admincraft si major release
- [ ] Email aux Pro users si update concerne leur tier
- [ ] Monitor errors / Sentry pendant 24-48h

---

## 12. Implementation V1 : ce que tu fais maintenant

### 12.1 Investments concrets V1 (5-6 jours total)

| Item | Effort |
|---|---|
| Package `api/` vs `internal/` séparation côté plugin | 1 jour (refactor) |
| Annotations `@Stable`, `@Beta`, `@Internal`, `@Deprecated` | 0,5 jour |
| `SchemaRegistry` avec migration framework | 1-2 jours |
| Protocol version + dispatch dans le hub WS | 1 jour |
| URL versioning `/api/v1/*` | 0,5 jour |
| `CHANGELOG.md` initial + règle de commit dans contribution.md | 0,1 jour |
| `docs/architecture/api-surface.md` v1 | 0,5 jour |

### 12.2 Ne PAS sur-investir au V1

Au V1 launch tu n'as **PAS** :

- Multiple versions en parallèle (juste v1 partout)
- `japicmp` en CI (à mettre quand tu as un premier module externe)
- Deprecations à gérer (tout est neuf)
- Doc auto-générée

Tu mets juste **les fondations**. Le reste vient organiquement quand tu en as besoin.

### 12.3 La discipline qui paye plus tard

- **Chaque commit qui touche `net.artisanmc.api.*` doit mettre à jour CHANGELOG**.
- **Chaque nouveau schema version est créé dans un dossier séparé**, jamais en modifiant un existant.
- **Chaque changement de sens d'un message WS bumpe la majeure de `ProtocolVersion`** (hub et feuilles se mettent à jour ensemble).
- **Chaque endpoint REST a un URL versionné**.

Ces 4 disciplines suffisent à t'éviter 90 % des emmerdes de versioning futures.

---

## 13. Quand tu casses ces règles

Spoiler : tu vas les casser, en particulier au début.

**Comment t'en sortir** :

- Pour un schema field renommé inadvertently : tu écris une migration v1.0 → v1.0 (idempotent) qui renomme. Pas idéal mais ça marche.
- Pour une signature de méthode publique changée : tu rends l'ancienne `@Deprecated` et tu en ajoutes une nouvelle. Tu maintiens les deux.
- Pour une colonne DB supprimée trop tôt : tu la recrées avec un DEFAULT NULL et tu marques le `@Deprecated`.

**La pire chose à faire** : ignorer le problème et hoper que personne ne s'en aperçoive. Documente-le toujours dans le CHANGELOG `### Fixed` avec "fixed inadvertent API break introduced in 1.2.0".

---

## Annexe : ressources externes

- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)
- [japicmp - Java API Comparison](https://github.com/siom79/japicmp)
- [JSON Schema migration patterns](https://json-schema.org/blog/posts/migration-strategies)

