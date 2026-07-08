# Boutique Add-on (MenuAPI → Artisan) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réécrire le plugin Boutique comme Add-on Artisan : menus/commande/dialog en contenu authored (`menu/v1`, `command/v1`, `dialog/v1`) éditables dans l'éditeur web via un module "Boutique", catalogue produits stocké dans le project, logique d'achat (tokens MySQL) conservée.

**Architecture:** Trois phases. **Phase 0 (repo Artisan)** : trois enablers core découverts au grounding — (a) pont `run_command` → `CommandRegistry` (le registry n'a AUCUN consommateur runtime aujourd'hui), (b) `Project.moduleData` (le round-trip fiable est `editorJson`, jamais les fichiers YAML — prérequis bloquant acté dans le plan précédent), (c) câblage de `importProjectFromFiles`/`isEmptyStub` (code mort actuellement) sur `local_push` pour que le contenu bootstrappé plugin-side devienne éditable. **Phase 1 (repo Boutique)** : modernisation (Java 21 / Paper 1.21.4, suppression MenuAPI), `BoutiqueModule : ArtisanModule` (data sources + `boutique:buy`), `ShopRepo` lisant `boutique/shop.yaml` via `api.project`, migrateur one-shot du `config.yml` MenuAPI, bootstrap du contenu par défaut. **Phase 2 (repo Artisan)** : package `@artisan/boutique-editor` (miroir de `@artisan/quests-editor`), état dans `moduleData.boutique`, `exportFiles` → `boutique/shop.yaml`.

**Tech Stack:** Kotlin 2.0 / Paper 1.21.4 / MockBukkit (plugin Artisan) · Java 21 / Maven / Paper 1.21.4 (plugin Boutique) · Bun + Hono + Drizzle (backend) · React 19 + Zustand + Vitest + `yaml` (éditeur).

**Fait sur lequel tout repose (grounding 2026-07-08)** : l'éditeur recharge un project depuis `editorJson` (l'objet `Project` sérialisé), **jamais** depuis la map `files`. Tout état module DOIT vivre dans `Project.moduleData` ; les fichiers `boutique/*.yaml` exportés sont une dérivation pure (`exportFiles`) de cet état. Sans ça, le sweep de `BundleDownloader` efface le contenu au déploiement suivant.

## Global Constraints

- Plugin Artisan : tests `cd plugin && ./gradlew test`. Backend : **TOUJOURS `bun run test`, JAMAIS `bun test`** (le direct wipe la DB dev). Éditeur : `cd editor && npm test`.
- Plugin Boutique (repo `C:\Users\ibane\Documents\Minecraft\Plugins\Boutique`) : build `mvn -q package`, tests `mvn -q test`. Travailler sur une branche `feat/artisan-addon`.
- Prérequis build Boutique : `cd C:\Users\ibane\Documents\Minecraft\Plugins\Artisan\plugin && ./gradlew publishToMavenLocal` (publie `net.artisanmc:artisan-core-api:1.0.0-SNAPSHOT`).
- Tout commit touchant `net.artisanmc.modules.api.*` ou le comportement des actions → `CHANGELOG.md` `[Unreleased]` + `docs/architecture/api-surface.md` si surface stable. WS/local_push → `ws-protocol.md`. Éditeur domaine/UI → `editor-internals.md`.
- Éditeur : strings UI via react-i18next N'EST PAS requis dans les packages modules (précédent : `quests-editor` hardcode l'anglais, pas d'i18n SDK) — hardcoder l'ANGLAIS dans `@artisan/boutique-editor`, pas de mix.
- Éditeur : design system d'abord — le module importe `Button`/`cn` depuis `@artisan/editor-sdk` ; les imports host (`@/state/accountStore`, `@/components/ui/*`) sont tolérés pour un module first-party in-repo (dette P1c documentée).
- Git : conventional commits, `git add` chemins explicites (les deux repos).
- Hash verrouillé (conformance vector) — aucun changement d'algo nulle part.
- Data source fetchers = main thread, pas d'I/O bloquant : `ShopRepo` sert depuis un état en mémoire rechargé par `onReload()`.
- YAML plugin Boutique : parser avec le snakeyaml bundlé par Paper (`org.yaml.snakeyaml.Yaml`) en **maps brutes** — jamais `YamlConfiguration` sur le vieux `config.yml` (les blocs `==: menuitem` de MenuAPI feraient échouer la désérialisation Bukkit).

---

## Phase 0 — Enablers core (repo Artisan)

### Task 1: Pont `run_command` → `CommandRegistry.dispatch`

Aujourd'hui `Action.RunCommand` exécute via Bukkit (`player.performCommand` / console) — `CommandRegistry.dispatch` n'a aucun appelant production. Le pont : si la commande résolue matche `namespace:name` ET que le registry connaît cette ref, dispatcher au module au lieu de Bukkit.

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ActionExecutor.kt` (branche `is Action.RunCommand`, ~lignes 90-94 ; constructeur/deps)
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt` (passer `api.commands` à la construction de l'ActionExecutor — repérer le site : `rtk grep -n "ActionExecutor(" plugin/src/main/kotlin`)
- Modify: `docs/architecture/api-surface.md`, `CHANGELOG.md`
- Test: `plugin/src/test/kotlin/net/artisanmc/plugin/engine/RunCommandBridgeTest.kt` (create)

**Interfaces:**
- Consumes: `CommandRegistry.has(name)` / `dispatch(name, player, args)` (existants, `@Stable`).
- Produces: contrat d'args du handler : `mapOf("argv" to List<String>, "raw" to String)` — `argv` = tokens après la ref, `raw` = la chaîne d'args brute. Le handler Boutique (Task 5) lira `argv[0]` = item id. `ActionExecutor` gagne un paramètre optionnel `commandRegistry: CommandRegistry? = null` (défaut null → comportement Bukkit inchangé partout ailleurs).

- [ ] **Step 1: Écrire le test qui échoue**

Ouvrir d'abord un test existant d'ActionExecutor (`rtk grep -l "Action.RunCommand\|ActionExecutor(" plugin/src/test`) pour copier son harness de construction (MockBukkit, deps). Le test (adapter le boilerplate de construction au harness trouvé, garder ces assertions) :

```kotlin
package net.artisanmc.plugin.engine

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.CommandDeclaration
import net.artisanmc.modules.api.CommandRegistry
import org.bukkit.entity.Player
import kotlin.test.*

class RunCommandBridgeTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private fun registryWith(name: String, onCall: (Player, Map<String, Any?>) -> Unit) =
        CommandRegistry().apply { register(CommandDeclaration(name, onCall)) }

    @Test fun `namespaced command known to the registry dispatches with argv and raw`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        var seen: Map<String, Any?>? = null
        val registry = registryWith("boutique:buy") { _, args -> seen = args }
        val executor = /* construire ActionExecutor comme dans le harness existant */ makeExecutor(commandRegistry = registry)
        executor.execute(Action.RunCommand(command = "boutique:buy sword extra", asConsole = false), ExecutionContext(p))
        assertEquals(listOf("sword", "extra"), seen?.get("argv"))
        assertEquals("sword extra", seen?.get("raw"))
    }

    @Test fun `namespaced command unknown to the registry falls back to Bukkit`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        val executor = makeExecutor(commandRegistry = CommandRegistry())
        // Ne doit pas throw UnknownCommandException — performCommand est le fallback.
        executor.execute(Action.RunCommand(command = "essentials:home base", asConsole = false), ExecutionContext(p))
    }

    @Test fun `null registry keeps legacy behavior`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        val executor = makeExecutor(commandRegistry = null)
        executor.execute(Action.RunCommand(command = "boutique:buy sword", asConsole = false), ExecutionContext(p))
    }

    @Test fun `console run_command never routes to the registry`() {
        val p = MockBukkit.getMock()!!.addPlayer()
        var called = false
        val registry = registryWith("boutique:buy") { _, _ -> called = true }
        val executor = makeExecutor(commandRegistry = registry)
        executor.execute(Action.RunCommand(command = "boutique:buy sword", asConsole = true), ExecutionContext(p))
        assertFalse(called)
    }
}
```

Si `ActionExecutor.execute(action, ctx)` n'est pas la méthode publique unitaire (l'entrée peut être `handle(handler, ctx)`), router le test par l'entrée publique réelle avec un ClickHandler minimal contenant l'action — garder les mêmes assertions.

- [ ] **Step 2: Vérifier l'échec**

Run: `cd plugin && ./gradlew test --tests "*RunCommandBridgeTest"`
Expected: FAIL — pas de paramètre `commandRegistry`.

- [ ] **Step 3: Implémenter**

Dans `ActionExecutor`, ajouter le paramètre `commandRegistry: CommandRegistry? = null` (même mécanisme d'injection que les deps existantes), et remplacer la branche RunCommand :

```kotlin
is Action.RunCommand -> {
    val cmd = resolveText(action.command, ctx).trimStart('/')
    val bridged = if (!action.asConsole) tryRegistryDispatch(cmd, ctx.player) else false
    if (!bridged) {
        if (action.asConsole) Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd)
        else player.performCommand(cmd)
    }
}
```

avec le helper privé :

```kotlin
/**
 * Pont modules.md §4.2 : "namespace:name args…" connu du CommandRegistry est
 * dispatché au module (args = {"argv": tokens, "raw": chaîne brute}) au lieu
 * de Bukkit. Ref inconnue → fallback Bukkit (une commande Bukkit peut
 * légitimement s'appeler "plugin:label").
 */
private fun tryRegistryDispatch(cmd: String, player: Player): Boolean {
    val registry = commandRegistry ?: return false
    val space = cmd.indexOf(' ')
    val ref = if (space == -1) cmd else cmd.substring(0, space)
    if (!Regex("^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$").matches(ref)) return false
    if (!registry.has(ref)) return false
    val raw = if (space == -1) "" else cmd.substring(space + 1)
    val argv = if (raw.isEmpty()) emptyList() else raw.split(' ').filter { it.isNotEmpty() }
    runCatching { registry.dispatch(ref, player, mapOf("argv" to argv, "raw" to raw)) }
        .onFailure { Bukkit.getLogger().warning("[Artisan] command '$ref' failed: ${it.message}") }
    return true
}
```

Wire dans `ArtisanPlugin` : au(x) site(s) de construction de l'`ActionExecutor`, passer `commandRegistry = api.commands`.

- [ ] **Step 4: Vérifier le vert**

Run: `cd plugin && ./gradlew test`
Expected: PASS, suite complète (défaut null → aucun test existant ne change).

- [ ] **Step 5: Docs + commit**

`api-surface.md` : sous la table `CommandRegistry`, ajouter la note : *"Runtime consumer (since 1.2.0): `run_command` actions whose command matches `namespace:name` and is registered here are dispatched to the module handler with `args = {argv: List<String>, raw: String}`. Unknown refs fall back to Bukkit."*
`CHANGELOG.md` `[Unreleased]` / `### Added` : `- run_command actions route namespaced commands ("boutique:buy {id}") to CommandRegistry handlers (modules.md §4.2 bridge); unknown refs fall back to Bukkit.`

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/ActionExecutor.kt plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt plugin/src/test/kotlin/net/artisanmc/plugin/engine/RunCommandBridgeTest.kt docs/architecture/api-surface.md CHANGELOG.md
rtk git commit -m "feat(plugin): bridge namespaced run_command actions to CommandRegistry"
```

---

### Task 2: `Project.moduleData` + action `setModuleData` (éditeur)

**Files:**
- Modify: `editor/src/domain/types.ts` (interface `Project`, lignes ~88-113)
- Modify: `editor/src/state/accountStore.ts` (nouvelle action ; vérifier aussi que `importProject` ~ligne 936 préserve le champ — il spread `...incoming`, donc oui, mais le test le fige)
- Test: `editor/src/state/accountStore.test.ts` (étendre)

**Interfaces:**
- Produces: `Project.moduleData?: Record<string, unknown>` (clé = module id, valeur opaque au host). Action store : `setModuleData(projectId: ProjectId, moduleId: string, data: unknown): void`. Convention inter-couches : quand le backend importe des fichiers d'un module (Task 3), il seed `moduleData[<dir>] = { __files: Record<relPath, content> }` ; le module éditeur (Task 7) normalise `__files` vers sa forme structurée à la première lecture.

- [ ] **Step 1: Écrire le test qui échoue** (dans `accountStore.test.ts`, en réutilisant les helpers de construction de project du fichier)

```typescript
describe("moduleData", () => {
  it("setModuleData writes the module's namespace and preserves others", () => {
    // seed un project via le helper existant du fichier, puis :
    useAccountStore.getState().setModuleData(projectId, "boutique", { categories: [] });
    useAccountStore.getState().setModuleData(projectId, "quests", { chains: 1 });
    const p = useAccountStore.getState().account.projects.find((x) => x.id === projectId)!;
    expect(p.moduleData?.boutique).toEqual({ categories: [] });
    expect(p.moduleData?.quests).toEqual({ chains: 1 });
  });

  it("importProject preserves moduleData", () => {
    // construire un Project avec moduleData: { boutique: { categories: [] } }
    // l'importer via l'action importProject existante, puis vérifier que
    // le project importé porte toujours moduleData.boutique.
  });
});
```

Écrire le second test en entier en copiant le pattern du test d'`importProject` existant dans le fichier (il y en a — `rtk grep -n "importProject" editor/src/state/accountStore.test.ts`).

- [ ] **Step 2: Vérifier l'échec**

Run: `cd editor && npm test -- src/state/accountStore.test.ts`
Expected: FAIL — `setModuleData` n'existe pas / `moduleData` absent du type.

- [ ] **Step 3: Implémenter**

`types.ts`, dans `Project` (après `canvasEdges`) :

```typescript
  /**
   * Per-module opaque state, keyed by module id (e.g. "boutique"). Owned by
   * the module's editor package; the host never interprets it. Round-trips
   * through editorJson. Modules derive their exportFiles() output from here.
   * Backend file-import seeds `{ __files: Record<relPath, content> }` for
   * unrecognized project dirs; modules normalize that on first read.
   */
  moduleData?: Record<string, unknown>;
```

`accountStore.ts` — action suivant le pattern Immer `produce` des actions existantes :

```typescript
setModuleData: (projectId: ProjectId, moduleId: string, data: unknown) =>
  set(produce((s: AccountState) => {
    const p = s.account.projects.find((x) => x.id === projectId);
    if (!p) return;
    p.moduleData = { ...(p.moduleData ?? {}), [moduleId]: data };
    p.updatedAt = new Date().toISOString();
  })),
```

(adapter le squelette exact — nom du state, façon de toucher `updatedAt` — au style des actions voisines du fichier ; la sémantique ci-dessus est normative).

- [ ] **Step 4: Vérifier le vert + suite complète**

Run: `cd editor && npm test`
Expected: PASS.

- [ ] **Step 5: Doc + commit**

`docs/architecture/editor-internals.md` : ajouter 3 lignes dans la section domaine/Project : `moduleData` (état opaque par module, convention `__files`, round-trip editorJson, dérivation `exportFiles`).

```bash
rtk git add editor/src/domain/types.ts editor/src/state/accountStore.ts editor/src/state/accountStore.test.ts docs/architecture/editor-internals.md
rtk git commit -m "feat(editor): Project.moduleData — namespaced opaque module state"
```

---

### Task 3: Backend — construire `editorJson` sur `local_push` quand le project est un stub

`importProjectFromFiles` et `isEmptyStub` (backend/src/lib/projectImport.ts:237, :310) existent, sont testés, et n'ont AUCUN appelant production. Les câbler dans le handler `local_push` (backend/src/ws/hub.ts:456-476) + collecter les dossiers inconnus dans `moduleData`.

**Files:**
- Modify: `backend/src/lib/projectImport.ts` (`importProjectFromFiles` : dossiers inconnus → `moduleData`)
- Modify: `backend/src/ws/hub.ts:456-476` (handler `local_push`)
- Modify: `docs/architecture/ws-protocol.md` (sémantique local_push), `CHANGELOG.md`
- Test: `backend/src/lib/projectImport.test.ts` (étendre) + le fichier de test du hub couvrant `local_push` (localiser : `rtk grep -ln "local_push" backend/src`)

**Interfaces:**
- Consumes: `importProjectFromFiles(projectId, files): Record<string, unknown>`, `isEmptyStub(editorJson)`, `upsertProjectContent`, `getProject` (tous existants dans hub.ts / lib).
- Produces: sur `local_push`, si `isEmptyStub(project.editorJson)` → `upsertProjectContent` inclut `editorJson: JSON.stringify(importProjectFromFiles(projectId, files))`. Fichiers sous un dossier top-level inconnu (≠ `menus/ commands/ dialogs/ lang/ manifest.yaml meta.yaml`, pas `.artisan*`) → `moduleData[<dir>] = { __files: { "<sous-chemin>": contenu } }`.

- [ ] **Step 1: Test projectImport qui échoue** (dans `projectImport.test.ts` — regarder d'abord la shape des clés `files` dans les fixtures existantes du fichier : relatives type `menus/x.yaml` ou préfixées `plugins/Artisan/projects/<id>/...` ; utiliser la MÊME shape)

```typescript
describe("importProjectFromFiles — module dirs", () => {
  it("collects unknown top-level dirs into moduleData.__files", () => {
    const files = {
      ...manifestWith(null), // helper existant du fichier
      "boutique/shop.yaml": "schema: boutique/v1\ncategories: []\n",
      "boutique/notes/readme.txt": "hi",
    };
    const project = importProjectFromFiles(PACK_ID, files) as {
      moduleData?: Record<string, { __files: Record<string, string> }>;
    };
    expect(project.moduleData?.boutique.__files["shop.yaml"]).toContain("boutique/v1");
    expect(project.moduleData?.boutique.__files["notes/readme.txt"]).toBe("hi");
  });

  it("does not create moduleData for core dirs or .artisan files", () => {
    const files = { ...manifestWith(null), ".artisan-sync.yaml": "x: 1" };
    const project = importProjectFromFiles(PACK_ID, files) as { moduleData?: unknown };
    expect(project.moduleData).toBeUndefined();
  });
});
```

(Si les clés des fixtures sont préfixées par le base path, préfixer pareil et faire porter la détection "top-level" sur le chemin relatif au project.)

- [ ] **Step 2: RED**

Run: `cd backend && bun run test`
Expected: FAIL sur les nouveaux tests. (**Jamais `bun test` direct.**)

- [ ] **Step 3: Implémenter dans `importProjectFromFiles`**

À la fin de la construction du project (avant le `return`), ajouter :

```typescript
  const CORE_PREFIXES = ["menus/", "commands/", "dialogs/", "lang/"];
  const CORE_FILES = new Set(["manifest.yaml", "meta.yaml"]);
  const moduleData: Record<string, { __files: Record<string, string> }> = {};
  for (const [path, content] of Object.entries(files)) {
    const rel = relativeToProject(path); // même normalisation que le reste de la fonction
    if (CORE_FILES.has(rel) || CORE_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const slash = rel.indexOf("/");
    if (slash <= 0) continue; // fichiers top-level inconnus : ignorés
    const dir = rel.slice(0, slash);
    if (dir.startsWith(".")) continue;
    (moduleData[dir] ??= { __files: {} }).__files[rel.slice(slash + 1)] = content;
  }
  if (Object.keys(moduleData).length > 0) project.moduleData = moduleData;
```

(`relativeToProject` = la normalisation déjà utilisée par la fonction pour ses propres lookups `menus/…` — la factoriser si elle est inline.)

- [ ] **Step 4: Test hub local_push qui échoue**

Dans le fichier de test hub couvrant `local_push`, ajouter (en copiant le seeding du test local_push existant) :

```typescript
it("local_push on an empty stub builds editorJson from files (incl. moduleData)", async () => {
  // seed: project stub (editorJson null) + connexion WS authentifiée, comme le test local_push existant
  // push: files = { "manifest.yaml": ..., "menus/shop_main.yaml": ..., "boutique/shop.yaml": "schema: boutique/v1\ncategories: []\n" }
  // assert: le project en DB a editorJson non-null, JSON.parse(...).moduleData.boutique.__files["shop.yaml"] contient "boutique/v1"
});

it("local_push on a real editor project does NOT overwrite editorJson", async () => {
  // seed: project avec editorJson = un Project non-stub (menus non vides)
  // push: files quelconques
  // assert: editorJson inchangé
});
```

Écrire ces deux tests en entier sur le pattern du test `local_push` existant du fichier.

- [ ] **Step 5: Implémenter dans hub.ts**

Remplacer la ligne `await upsertProjectContent(projectId, { hash, filesJson: JSON.stringify(files) });` par :

```typescript
    const patch: { hash: string; filesJson: string; editorJson?: string } = {
      hash, filesJson: JSON.stringify(files),
    };
    // Contenu poussé par le plugin (bootstrap Add-on / scénario FTP) : si le
    // project n'a jamais été édité (stub), construire l'état éditeur depuis
    // les fichiers pour qu'il soit éditable — jamais quand un vrai état existe.
    if (isEmptyStub(project.editorJson)) {
      patch.editorJson = JSON.stringify(importProjectFromFiles(projectId, files));
    }
    await upsertProjectContent(projectId, patch);
```

(+ imports `importProjectFromFiles`, `isEmptyStub` depuis `../lib/projectImport`. Vérifier que `getProject(projectId)` retourne bien `editorJson` — sinon sélectionner la colonne.)

- [ ] **Step 6: GREEN + suite complète**

Run: `cd backend && bun run test`
Expected: PASS.

- [ ] **Step 7: Docs + commit**

`ws-protocol.md`, section `local_push` : ajouter *"Si le project backend est un stub jamais édité (`isEmptyStub`), le backend construit aussi `editorJson` via `importProjectFromFiles` (les dossiers module inconnus deviennent `moduleData[<dir>].__files`). Un `editorJson` réel n'est jamais écrasé."*
`CHANGELOG.md` : `- local_push seeds editorJson from pushed files on never-edited stubs (plugin-bootstrapped content becomes editable; module dirs land in Project.moduleData).`

```bash
rtk git add backend/src/lib/projectImport.ts backend/src/lib/projectImport.test.ts backend/src/ws/hub.ts docs/architecture/ws-protocol.md CHANGELOG.md
rtk git commit -m "feat(backend): build editorJson from files on local_push stubs (module dirs -> moduleData)"
```

(+ le fichier de test hub touché.)

---

## Phase 1 — Plugin Boutique (repo `C:\Users\ibane\Documents\Minecraft\Plugins\Boutique`)

> Contexte repo : Maven, Java 16, Paper 1.18.2, `depend: [MenuAPI]`. Classes : `ShopPlugin`, `ShopCategory`, `ShopItem`, `manager/{ShopManager,TransactionManager,DatabaseManager}`, `menus/{ShopCategoryListMenu,ShopCategoryMenu}`, `commands/{BoutiqueCMD,TokensCMD}`, `sql/*`, `listener/JoinQuitListener`, `ShopPlaceHolders`. La monnaie tokens (MySQL/Hikari), PAPI et `/tokens` sont conservés tels quels.

### Task 4: Modernisation build + suppression de la couche MenuAPI + domaine POJO

**Files (repo Boutique):**
- Modify: `pom.xml`, `src/main/resources/plugin.yml`
- Delete: `src/main/java/fr/iban/boutique/menus/ShopCategoryListMenu.java`, `menus/ShopCategoryMenu.java`
- Rewrite: `src/main/java/fr/iban/boutique/ShopCategory.java`, `ShopItem.java` (POJO sans `ConfigurableItem`)
- Modify: `src/main/java/fr/iban/boutique/manager/TransactionManager.java`, `sql/SqlStorage.java`, `commands/BoutiqueCMD.java` → supprimé, `manager/ShopManager.java` → supprimé (remplacé Task 5 par `ShopRepo`)
- Create: `src/test/java/fr/iban/boutique/ShopItemTest.java`

**Interfaces:**
- Produces (consommé par Tasks 5-6) :

```java
public final class ShopItem {
    private final String id, name, icon;          // icon = Material name (string libre)
    private final double price;                    // prix de base
    private final int discount;                    // % item
    private final List<String> lore;
    private final List<String> buyCommands;        // %player% substitué à l'exécution
    private final ShopCategory category;           // back-ref, non-null
    // ctor + getters ; et :
    public double finalPrice(int wholeShopDiscount) {
        double mod = 1.0 - (wholeShopDiscount + category.getDiscount() + discount) / 100.0;
        return Math.max(0, price * mod);
    }
}
public final class ShopCategory {
    private final String id, name, icon;
    private final int discount;
    private final List<ShopItem> items;            // rempli par ShopRepo
}
```

- [ ] **Step 1: Branche + build de référence**

```bash
cd C:\Users\ibane\Documents\Minecraft\Plugins\Boutique
git checkout -b feat/artisan-addon
mvn -q -DskipTests package   # état de départ (doit compiler avant modif)
```

- [ ] **Step 2: pom.xml**

- `<java.version>` → `21` (et `maven.compiler.source/target` ou `<release>21</release>`).
- `paper-api` → `io.papermc.paper:paper-api:1.21.4-R0.1-SNAPSHOT` (provided).
- **Supprimer** la dépendance `fr.iban:MenuAPI`.
- **Ajouter** (provided, fourni au runtime par le plugin Artisan) :

```xml
<dependency>
  <groupId>net.artisanmc</groupId>
  <artifactId>artisan-core-api</artifactId>
  <version>1.0.0-SNAPSHOT</version>
  <scope>provided</scope>
</dependency>
```

et s'assurer que `<repositories>` n'est pas nécessaire pour lui (mavenLocal est consulté d'office par Maven).
- **Ajouter** JUnit 5 (test scope) + surefire à jour :

```xml
<dependency>
  <groupId>org.junit.jupiter</groupId>
  <artifactId>junit-jupiter</artifactId>
  <version>5.10.2</version>
  <scope>test</scope>
</dependency>
```

- Garder HikariCP shaded et PlaceholderAPI provided tels quels.

- [ ] **Step 3: plugin.yml**

```yaml
name: Boutique
version: 2.0.0
main: fr.iban.boutique.ShopPlugin
api-version: '1.21'
depend: [Artisan]
softdepend: [PlaceholderAPI]
commands:
  tokens:
    description: Gestion des tokens
```

(la commande `boutique` disparaît du plugin.yml — `/boutique` devient une commande authored `command/v1` shippée par le bootstrap, Task 6 ; les sous-commandes admin `createCategory`/`givetokens` disparaissent — les catégories se gèrent dans l'éditeur, `givetokens` existe déjà via `/tokens`).

- [ ] **Step 4: Supprimer la couche MenuAPI et réécrire le domaine**

- Supprimer `menus/*.java` et `commands/BoutiqueCMD.java` et `manager/ShopManager.java`.
- Réécrire `ShopItem`/`ShopCategory` exactement selon le bloc Interfaces ci-dessus (POJO immuables, plus aucun import `fr.iban.menuapi.*`).
- `TransactionManager.buy(Player, ShopItem, int wholeShopDiscount)` : adapter — le prix vient de `item.finalPrice(wholeShopDiscount)` (arrondi `(int) Math.round(...)` comme avant), le nom affiché de `item.getName()`, les commandes de `item.getBuyCommands()`. **Corriger le bug historique** : un item sans `buyCommands` doit REFUSER l'achat avec un message, pas silencieusement ne rien débiter (l'ancien code ne débitait que si la liste était non-vide).
- `SqlStorage.addPurchaseHistory` : remplacer `item.getDisplay().getItemStack().getItemMeta().getDisplayName()` par `item.getName()`.
- Purger tous les imports `fr.iban.menuapi.*` restants (`HexColor` dans TransactionManager : remplacer par les codes `§` déjà présents dans les strings ou `net.md_5.bungee.api.ChatColor.of(...)` si hex nécessaire — pas de nouvelle dépendance).
- `ShopPlugin` : retirer l'enregistrement de BoutiqueCMD et toute référence ShopManager (Task 5 branchera ShopRepo/BoutiqueModule ; à cette étape le plugin compile avec la boutique inerte, tokens/PAPI intacts).

- [ ] **Step 5: Test + build**

`src/test/java/fr/iban/boutique/ShopItemTest.java` :

```java
package fr.iban.boutique;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertEquals;

class ShopItemTest {
    private ShopItem item(int catDiscount, int itemDiscount, double price) {
        ShopCategory cat = new ShopCategory("weapons", "Armes", "DIAMOND_SWORD", catDiscount, new java.util.ArrayList<>());
        return new ShopItem("sword", "Épée", "DIAMOND_SWORD", price, itemDiscount,
                List.of(), List.of("give %player% diamond_sword 1"), cat);
    }

    @Test void finalPriceStacksWholeShopCategoryAndItemDiscounts() {
        assertEquals(60.0, item(20, 10, 100).finalPrice(10), 1e-9); // 100 * (1 - 0.40)
    }

    @Test void finalPriceNeverNegative() {
        assertEquals(0.0, item(80, 80, 100).finalPrice(80), 1e-9);
    }
}
```

Run: `mvn -q test` → PASS ; `mvn -q -DskipTests package` → BUILD SUCCESS.

- [ ] **Step 6: Commit**

```bash
git add pom.xml src/main/resources/plugin.yml src/main/java src/test/java
git commit -m "feat!: drop MenuAPI layer, POJO domain, Java 21 / Paper 1.21.4 / artisan-core-api"
```

(le `git add src/main/java` large est acceptable ici : c'est un rewrite de module entier dans un repo dédié, pas le monorepo Artisan.)

---

### Task 5: `ShopRepo` + `BoutiqueModule` (data sources + `boutique:buy`)

**Files (repo Boutique):**
- Create: `src/main/java/fr/iban/boutique/artisan/ShopRepo.java`
- Create: `src/main/java/fr/iban/boutique/artisan/BoutiqueModule.java`
- Modify: `src/main/java/fr/iban/boutique/ShopPlugin.java`
- Test: `src/test/java/fr/iban/boutique/artisan/ShopRepoTest.java`

**Interfaces:**
- Consumes: `ArtisanAPI` via `server.getServicesManager().getRegistration(ArtisanAPI.class).getProvider()` ; `api.project.projectIds()/list()/read()/hasContent()` ; `api.dataSources.register(new DataSourceDeclaration(ref, fetcher, schemaHint))` ; `api.commands.register(new CommandDeclaration(name, handler))` ; `api.modules.register(module)` ; handler args du pont Task 1 : `args.get("argv")` = `List<String>`.
- Produces: `ShopRepo.load(Function<String,String> readFile, List<String> shopFiles)` — parse et remplace l'état en mémoire ; `ShopRepo.categories(): List<ShopCategory>` ; `ShopRepo.findItem(String id): Optional<ShopItem>`. Data sources : `boutique:categories` → rows `{id, name, icon}` ; `boutique:items` → rows `{id, name, icon, category, price, final_price, lore}`.

Format `boutique/shop.yaml` (contrat partagé avec Task 6 migrateur et Task 7 éditeur) :

```yaml
schema: boutique/v1
whole_shop_discount: 0
categories:
  - id: weapons
    name: "Armes"
    icon: DIAMOND_SWORD
    discount: 0
    items:
      - id: diamond_sword
        name: "Épée en diamant"
        icon: DIAMOND_SWORD
        price: 100
        discount: 0
        lore: ["Une épée tranchante"]
        buy_commands: ["give %player% diamond_sword 1"]
```

- [ ] **Step 1: Test ShopRepo qui échoue**

```java
package fr.iban.boutique.artisan;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class ShopRepoTest {
    private static final String YAML = String.join("\n",
        "schema: boutique/v1",
        "whole_shop_discount: 5",
        "categories:",
        "  - id: weapons",
        "    name: Armes",
        "    icon: DIAMOND_SWORD",
        "    discount: 10",
        "    items:",
        "      - id: diamond_sword",
        "        name: Épée",
        "        icon: DIAMOND_SWORD",
        "        price: 100",
        "        discount: 5",
        "        buy_commands: [\"give %player% diamond_sword 1\"]",
        "");

    @Test void parsesCategoriesItemsAndDiscounts() {
        ShopRepo repo = new ShopRepo();
        repo.load(path -> YAML, List.of("shop.yaml"));
        assertEquals(1, repo.categories().size());
        var item = repo.findItem("diamond_sword").orElseThrow();
        assertEquals("Épée", item.getName());
        assertEquals(80.0, item.finalPrice(repo.wholeShopDiscount()), 1e-9); // 100*(1-0.20)
    }

    @Test void unknownSchemaOrMalformedYamlYieldsEmptyState() {
        ShopRepo repo = new ShopRepo();
        repo.load(path -> "schema: nope/v9", List.of("shop.yaml"));
        assertTrue(repo.categories().isEmpty());
        repo.load(path -> "{{{not yaml", List.of("shop.yaml"));
        assertTrue(repo.categories().isEmpty());
    }

    @Test void findItemAcrossMultipleFiles() {
        ShopRepo repo = new ShopRepo();
        repo.load(path -> YAML, List.of("a.yaml", "b.yaml")); // ids dupliqués: dernier gagne, pas de crash
        assertTrue(repo.findItem("diamond_sword").isPresent());
    }
}
```

Run: `mvn -q test` → FAIL (classe absente).

- [ ] **Step 2: Implémenter ShopRepo** (snakeyaml brut — bundlé par Paper ; pour les tests purs ajouter `org.yaml:snakeyaml:2.2` en scope `test` au pom si le classpath test ne l'a pas)

```java
package fr.iban.boutique.artisan;

import fr.iban.boutique.ShopCategory;
import fr.iban.boutique.ShopItem;
import org.yaml.snakeyaml.Yaml;

import java.util.*;
import java.util.function.Function;

/** État shop en mémoire, rechargé depuis boutique/*.yaml (api.project). Thread-safe par remplacement atomique. */
public final class ShopRepo {
    private volatile List<ShopCategory> categories = List.of();
    private volatile Map<String, ShopItem> itemsById = Map.of();
    private volatile int wholeShopDiscount = 0;

    public List<ShopCategory> categories() { return categories; }
    public Optional<ShopItem> findItem(String id) { return Optional.ofNullable(itemsById.get(id)); }
    public int wholeShopDiscount() { return wholeShopDiscount; }

    @SuppressWarnings("unchecked")
    public void load(Function<String, String> readFile, List<String> shopFiles) {
        List<ShopCategory> cats = new ArrayList<>();
        Map<String, ShopItem> byId = new HashMap<>();
        int shopDiscount = 0;
        for (String file : shopFiles) {
            String content = readFile.apply(file);
            if (content == null) continue;
            Map<String, Object> root;
            try {
                Object parsed = new Yaml().load(content);
                if (!(parsed instanceof Map)) continue;
                root = (Map<String, Object>) parsed;
            } catch (RuntimeException e) { continue; }
            if (!"boutique/v1".equals(root.get("schema"))) continue;
            shopDiscount = asInt(root.get("whole_shop_discount"), shopDiscount);
            for (Object rawCat : asList(root.get("categories"))) {
                if (!(rawCat instanceof Map)) continue;
                Map<String, Object> c = (Map<String, Object>) rawCat;
                List<ShopItem> items = new ArrayList<>();
                ShopCategory cat = new ShopCategory(
                        str(c, "id"), str(c, "name"), str(c, "icon"), asInt(c.get("discount"), 0), items);
                for (Object rawItem : asList(c.get("items"))) {
                    if (!(rawItem instanceof Map)) continue;
                    Map<String, Object> i = (Map<String, Object>) rawItem;
                    ShopItem item = new ShopItem(
                            str(i, "id"), str(i, "name"), str(i, "icon"),
                            asDouble(i.get("price")), asInt(i.get("discount"), 0),
                            strList(i.get("lore")), strList(i.get("buy_commands")), cat);
                    items.add(item);
                    byId.put(item.getId(), item);
                }
                cats.add(cat);
            }
        }
        this.categories = List.copyOf(cats);
        this.itemsById = Map.copyOf(byId);
        this.wholeShopDiscount = shopDiscount;
    }

    private static String str(Map<String, Object> m, String k) { Object v = m.get(k); return v == null ? "" : v.toString(); }
    private static int asInt(Object v, int dflt) { return v instanceof Number n ? n.intValue() : dflt; }
    private static double asDouble(Object v) { return v instanceof Number n ? n.doubleValue() : 0.0; }
    private static List<Object> asList(Object v) { return v instanceof List ? (List<Object>) v : List.of(); }
    private static List<String> strList(Object v) {
        List<String> out = new ArrayList<>();
        for (Object o : asList(v)) if (o != null) out.add(o.toString());
        return List.copyOf(out);
    }
}
```

Run: `mvn -q test` → PASS.

- [ ] **Step 3: BoutiqueModule + wiring ShopPlugin**

```java
package fr.iban.boutique.artisan;

import fr.iban.boutique.ShopPlugin;
import net.artisanmc.modules.api.*;
import org.bukkit.entity.Player;

import java.util.*;
import java.util.stream.Collectors;

public final class BoutiqueModule implements ArtisanModule {
    private final ShopPlugin plugin;
    private final ShopRepo repo;
    private ArtisanAPI api;

    public BoutiqueModule(ShopPlugin plugin, ShopRepo repo) { this.plugin = plugin; this.repo = repo; }

    @Override public String getId() { return "boutique"; }
    @Override public String getSchemaVersion() { return "boutique/v1"; }

    @Override public void onEnable(ArtisanAPI api) {
        this.api = api;
        reloadRepo();
        api.getDataSources().register(new DataSourceDeclaration(
                "boutique:categories",
                (player, params) -> repo.categories().stream()
                        .map(c -> Map.<String, Object>of("id", c.getId(), "name", c.getName(), "icon", c.getIcon()))
                        .collect(Collectors.toList()),
                "id, name, icon"));
        api.getDataSources().register(new DataSourceDeclaration(
                "boutique:items",
                (player, params) -> repo.categories().stream()
                        .flatMap(c -> c.getItems().stream())
                        .map(this::itemRow)
                        .collect(Collectors.toList()),
                "id, name, icon, category, price, final_price, lore"));
        api.getCommands().register(new CommandDeclaration("boutique:buy", this::handleBuy));
    }

    private Map<String, Object> itemRow(fr.iban.boutique.ShopItem i) {
        Map<String, Object> row = new HashMap<>();
        row.put("id", i.getId());
        row.put("name", i.getName());
        row.put("icon", i.getIcon());
        row.put("category", i.getCategory().getId());
        row.put("price", i.getPrice());
        row.put("final_price", (int) Math.round(i.finalPrice(repo.wholeShopDiscount())));
        row.put("lore", String.join("\n", i.getLore()));
        return row;
    }

    @SuppressWarnings("unchecked")
    private void handleBuy(Player player, Map<String, Object> args) {
        List<String> argv = args.get("argv") instanceof List<?> l
                ? l.stream().map(String::valueOf).collect(Collectors.toList()) : List.of();
        if (argv.isEmpty()) { player.sendMessage("§cUsage interne: boutique:buy <item_id>"); return; }
        var item = repo.findItem(argv.get(0)).orElse(null);
        if (item == null) { player.sendMessage("§cCet article n'existe plus."); return; }
        plugin.getTransactionManager().buy(player, item, repo.wholeShopDiscount());
    }

    @Override public void onReload() { reloadRepo(); }
    @Override public void onDisable() {}

    private void reloadRepo() {
        List<String> files = new ArrayList<>();
        Map<String, String> contents = new HashMap<>();
        for (String pid : api.getProject().projectIds()) {
            for (String rel : api.getProject().list(pid, "boutique")) {
                String content = api.getProject().read(pid, "boutique/" + rel);
                if (content != null) { files.add(pid + "/" + rel); contents.put(pid + "/" + rel, content); }
            }
        }
        repo.load(contents::get, files);
    }
}
```

**Note d'adaptation Kotlin→Java** : `ArtisanAPI` est une classe Kotlin à propriétés (`dataSources`, `commands`, `project`, `modules`) — depuis Java les accesseurs sont `getDataSources()`, `getCommands()`, `getProject()`, `getModules()` ; `ArtisanModule` expose `val id`/`val schemaVersion` → implémenter `getId()`/`getSchemaVersion()`. `DataSourceDeclaration`/`CommandDeclaration` sont des data classes Kotlin dont les lambdas sont des `kotlin.jvm.functions.FunctionN` — si le constructeur Java refuse une lambda Java directe, l'adapter (`(Function2<Player, Map<String,Object>, Unit>) (p, a) -> { ...; return kotlin.Unit.INSTANCE; }`). Vérifier à la compilation et adapter — c'est le point de friction attendu de cette task ; si ça devient illisible, extraire un petit helper `Declarations.java`.

`ShopPlugin.onEnable()` (après l'init tokens/DB existante) :

```java
var reg = getServer().getServicesManager().getRegistration(net.artisanmc.modules.api.ArtisanAPI.class);
if (reg == null) { getLogger().severe("Artisan introuvable — Boutique désactivée."); getServer().getPluginManager().disablePlugin(this); return; }
var api = reg.getProvider();
this.shopRepo = new ShopRepo();
api.getModules().register(new BoutiqueModule(this, shopRepo));
```

(+ getter `getTransactionManager()` si absent, champ `shopRepo`).

- [ ] **Step 4: Build + tests + commit**

Run: `mvn -q test && mvn -q -DskipTests package` → PASS / BUILD SUCCESS.

```bash
git add src/main/java/fr/iban/boutique/artisan src/main/java/fr/iban/boutique/ShopPlugin.java src/test/java/fr/iban/boutique/artisan pom.xml
git commit -m "feat: BoutiqueModule — data sources boutique:categories/items + boutique:buy via ArtisanAPI"
```

---

### Task 6: Migrateur legacy + bootstrap du contenu par défaut

**Files (repo Boutique):**
- Create: `src/main/java/fr/iban/boutique/artisan/LegacyConfigMigrator.java`
- Create: `src/main/java/fr/iban/boutique/artisan/Bootstrapper.java`
- Create (resources): `src/main/resources/bootstrap/manifest.yaml`, `bootstrap/menus/shop_main.yaml`, `bootstrap/menus/shop_category.yaml`, `bootstrap/dialogs/confirm_purchase.yaml`, `bootstrap/commands/boutique.yaml`, `bootstrap/boutique/shop.yaml`
- Modify: `src/main/java/fr/iban/boutique/ShopPlugin.java`
- Test: `src/test/java/fr/iban/boutique/artisan/LegacyConfigMigratorTest.java`

**Interfaces:**
- Consumes: `api.getProject().hasContent("boutique")` (gate bootstrap) ; format `boutique/v1` (Task 5).
- Produces: `LegacyConfigMigrator.migrate(String legacyConfigYaml): Optional<String>` — YAML `boutique/v1` depuis l'ancien `config.yml` MenuAPI (raw snakeyaml, blocs `menuitem` lus comme maps). `Bootstrapper.bootstrapIfAbsent(File projectsDir, Optional<String> migratedShopYaml)` — écrit `plugins/Artisan/projects/boutique_shop/` complet si absent.

**Flux runtime** (ShopPlugin.onEnable, après le register du module) : si `!api.getProject().hasContent("boutique")` → `Bootstrapper.bootstrapIfAbsent(new File(artisanPlugin.getDataFolder(), "projects"), LegacyConfigMigrator.migrate(<contenu de config.yml s'il existe>))` puis `getLogger().warning("Contenu Boutique bootstrappé dans projects/boutique_shop — lancer /artisan reload puis /artisan pushLocal boutique_shop pour le synchroniser.")` — un WARN post-mortem, pas d'interactivité (l'auto-push `backendHash.isEmpty()` le fera aussi au prochain hello si le backend a un stub). Le dossier data d'Artisan s'obtient via `api.getPlugin().getDataFolder()`.

- [ ] **Step 1: Test migrateur qui échoue**

```java
package fr.iban.boutique.artisan;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class LegacyConfigMigratorTest {
    /** Extrait représentatif du vrai config.yml MenuAPI (blocs sérialisés menuitem en maps). */
    private static final String LEGACY = String.join("\n",
        "whole-shop-discount: 5",
        "categories:",
        "  '1':",
        "    discount: 10",
        "    menuitem:",
        "      ==: menuitem",
        "      slot: 0",
        "      item:",
        "        ==: org.bukkit.inventory.ItemStack",
        "        type: DIAMOND_SWORD",
        "      name: '&bArmes'",
        "    items:",
        "      '1':",
        "        price: 100",
        "        discount: 5",
        "        buycommands:",
        "        - give %player% diamond_sword 1",
        "        menuitem:",
        "          ==: menuitem",
        "          slot: 0",
        "          item:",
        "            ==: org.bukkit.inventory.ItemStack",
        "            type: DIAMOND_SWORD",
        "          name: '&fÉpée en diamant'",
        "          lore:",
        "          - '&7Une épée tranchante'",
        "");

    @Test void migratesCategoriesItemsPricesAndStripsColorCodes() {
        String out = LegacyConfigMigrator.migrate(LEGACY).orElseThrow();
        assertTrue(out.contains("schema: boutique/v1"));
        assertTrue(out.contains("whole_shop_discount: 5"));
        assertTrue(out.contains("icon: DIAMOND_SWORD"));
        assertTrue(out.contains("price: 100"));
        assertTrue(out.contains("give %player% diamond_sword 1"));
        // Les noms gardent leurs codes couleur legacy (& → rendu MiniMessage viendra plus tard) :
        assertTrue(out.contains("Armes"));
    }

    @Test void emptyOrUnparseableConfigYieldsEmpty() {
        assertTrue(LegacyConfigMigrator.migrate("").isEmpty());
        assertTrue(LegacyConfigMigrator.migrate("{{{").isEmpty());
        assertTrue(LegacyConfigMigrator.migrate("database: {}").isEmpty()); // pas de categories
    }
}
```

**IMPORTANT — vérifier la structure réelle d'abord** : ouvrir `C:\Users\ibane\Documents\Minecraft\Plugins\Boutique\src\main\resources\config.yml` (et, s'il existe, un config.yml de prod) pour confirmer les chemins exacts (`categories.<id>.menuitem.{item.type,name,lore}`, `items.<id>.{price,discount,buycommands,menuitem}`). Ajuster LEGACY et le migrateur à la structure réelle — la structure ci-dessus vient de l'audit du code (`ShopManager` lisait `categories.<id>.{discount,menuitem,items...}` et `ConfigurableItem` sérialise `slot/item/name/lore`), pas d'un fichier réel.

- [ ] **Step 2: Implémenter le migrateur** (raw snakeyaml ; ids legacy numériques → slugs `cat_<n>`/`item_<n>` si le nom ne slugifie pas proprement)

```java
package fr.iban.boutique.artisan;

import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;

import java.util.*;

/** One-shot : ancien config.yml MenuAPI → boutique/v1. Lecture en maps brutes (jamais YamlConfiguration : blocs `==: menuitem`). */
public final class LegacyConfigMigrator {
    private LegacyConfigMigrator() {}

    @SuppressWarnings("unchecked")
    public static Optional<String> migrate(String legacyYaml) {
        Object parsed;
        try { parsed = new Yaml().load(legacyYaml); } catch (RuntimeException e) { return Optional.empty(); }
        if (!(parsed instanceof Map)) return Optional.empty();
        Map<String, Object> root = (Map<String, Object>) parsed;
        if (!(root.get("categories") instanceof Map)) return Optional.empty();

        List<Map<String, Object>> categories = new ArrayList<>();
        Map<String, Object> rawCats = (Map<String, Object>) root.get("categories");
        for (Map.Entry<String, Object> catEntry : rawCats.entrySet()) {
            if (!(catEntry.getValue() instanceof Map)) continue;
            Map<String, Object> c = (Map<String, Object>) catEntry.getValue();
            Map<String, Object> catDisplay = display(c.get("menuitem"));
            List<Map<String, Object>> items = new ArrayList<>();
            Object rawItems = c.get("items");
            if (rawItems instanceof Map) {
                for (Map.Entry<String, Object> itemEntry : ((Map<String, Object>) rawItems).entrySet()) {
                    if (!(itemEntry.getValue() instanceof Map)) continue;
                    Map<String, Object> i = (Map<String, Object>) itemEntry.getValue();
                    Map<String, Object> itemDisplay = display(i.get("menuitem"));
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("id", slug((String) itemDisplay.get("name"), "item_" + itemEntry.getKey()));
                    item.put("name", stripAmp((String) itemDisplay.getOrDefault("name", "item " + itemEntry.getKey())));
                    item.put("icon", itemDisplay.getOrDefault("icon", "BARRIER"));
                    item.put("price", i.getOrDefault("price", 0));
                    item.put("discount", i.getOrDefault("discount", 0));
                    item.put("lore", itemDisplay.getOrDefault("lore", List.of()));
                    item.put("buy_commands", i.getOrDefault("buycommands", List.of()));
                    items.add(item);
                }
            }
            Map<String, Object> cat = new LinkedHashMap<>();
            cat.put("id", slug((String) catDisplay.get("name"), "cat_" + catEntry.getKey()));
            cat.put("name", stripAmp((String) catDisplay.getOrDefault("name", "Catégorie " + catEntry.getKey())));
            cat.put("icon", catDisplay.getOrDefault("icon", "CHEST"));
            cat.put("discount", c.getOrDefault("discount", 0));
            cat.put("items", items);
            categories.add(cat);
        }
        if (categories.isEmpty()) return Optional.empty();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("schema", "boutique/v1");
        out.put("whole_shop_discount", root.getOrDefault("whole-shop-discount", 0));
        out.put("categories", categories);
        DumperOptions opts = new DumperOptions();
        opts.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        return Optional.of(new Yaml(opts).dump(out));
    }

    /** name/lore/icon depuis un bloc menuitem sérialisé ({==: menuitem, name, lore, item: {type}}). */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> display(Object rawMenuItem) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (rawMenuItem instanceof Map) {
            Map<String, Object> m = (Map<String, Object>) rawMenuItem;
            if (m.get("name") != null) out.put("name", m.get("name").toString());
            if (m.get("lore") instanceof List) {
                List<String> lore = new ArrayList<>();
                for (Object l : (List<Object>) m.get("lore")) lore.add(stripAmp(String.valueOf(l)));
                out.put("lore", lore);
            }
            if (m.get("item") instanceof Map && ((Map<String, Object>) m.get("item")).get("type") != null) {
                out.put("icon", ((Map<String, Object>) m.get("item")).get("type").toString());
            }
        }
        return out;
    }

    private static String stripAmp(String s) { return s == null ? "" : s.replaceAll("[&§][0-9a-fk-orx]", "").trim(); }

    private static String slug(String name, String fallback) {
        if (name == null) return fallback;
        String s = stripAmp(name).toLowerCase(Locale.ROOT)
                .replaceAll("[àâä]", "a").replaceAll("[éèêë]", "e").replaceAll("[îï]", "i")
                .replaceAll("[ôö]", "o").replaceAll("[ùûü]", "u").replaceAll("ç", "c")
                .replaceAll("[^a-z0-9]+", "_").replaceAll("^_+|_+$", "");
        return s.isEmpty() || !s.matches("^[a-z].*") ? fallback : s;
    }
}
```

Run: `mvn -q test` → PASS.

- [ ] **Step 3: Contenu bootstrap (resources)**

`bootstrap/manifest.yaml` — **VÉRIFIER d'abord la shape exacte attendue** en lisant `plugin/src/main/kotlin/net/artisanmc/plugin/provider/ProjectReader.kt` (repo Artisan, lignes ~39-72) et une fixture de test full-sync : la question ouverte est si `files.menus` liste des ids ou des noms de fichiers. Contenu (à ajuster sur ce point uniquement) :

```yaml
schema: manifest/v1
project_id: boutique_shop
default_lang: fr
languages: []
files:
  menus: [shop_main, shop_category]
  commands: [boutique]
  dialogs: [confirm_purchase]
```

`bootstrap/menus/shop_main.yaml` :

```yaml
schema: menu/v1
id: shop_main
title: "Boutique"
size: 54
context_inputs:
  - name: cats
    type: list
    source: { ref: "boutique:categories" }
layers:
  - id: main
    name: Main
    elements:
      - id: grid
        positions: "10-43"
        iterates: { source: cats, alias: cat }
        appearances:
          - material: "{cat.icon}"
            title: "{cat.name}"
            click:
              left:
                steps:
                  - kind: action
                    action:
                      type: open_menu
                      menu_id: shop_category
                      context: { category: "{cat.id}", category_name: "{cat.name}" }
```

`bootstrap/menus/shop_category.yaml` :

```yaml
schema: menu/v1
id: shop_category
title: "Boutique — {category_name}"
size: 54
context_inputs:
  - name: category
    type: string
  - name: category_name
    type: string
    default: ""
  - name: items
    type: list
    source: { ref: "boutique:items", filter: { category: "{category}" } }
layers:
  - id: main
    name: Main
    elements:
      - id: grid
        positions: "10-43"
        iterates: { source: items, alias: item }
        appearances:
          - material: "{item.icon}"
            title: "{item.name}"
            lore:
              - "{item.lore}"
              - "§ePrix : {item.final_price} tokens"
            click:
              left:
                steps:
                  - kind: action
                    action:
                      type: open_dialog
                      dialog_id: confirm_purchase
                      context: { item_id: "{item.id}", item_name: "{item.name}", item_price: "{item.final_price}" }
      - id: back
        positions: "49"
        appearances:
          - material: ARROW
            title: "§7Retour"
            click:
              left:
                steps:
                  - kind: action
                    action: { type: open_menu, menu_id: shop_main }
```

`bootstrap/dialogs/confirm_purchase.yaml` :

```yaml
schema: dialog/v1
id: confirm_purchase
title: "Confirmer l'achat"
can_close_with_escape: true
body:
  - { type: text, text: "Acheter {item_name} pour {item_price} tokens ?" }
buttons:
  - id: confirm
    label: "§aConfirmer"
    actions:
      - { type: run_command, command: "boutique:buy {item_id}" }
  - id: cancel
    label: "§cAnnuler"
    actions:
      - { type: open_menu, menu_id: shop_category }
```

`bootstrap/commands/boutique.yaml` :

```yaml
schema: command/v1
id: boutique
name: boutique
description: "Ouvre la boutique"
steps:
  - kind: action
    action: { type: open_menu, menu_id: shop_main }
```

`bootstrap/boutique/shop.yaml` : le YAML exemple de la section Interfaces de Task 5 (weapons/diamond_sword).

- [ ] **Step 4: Bootstrapper**

```java
package fr.iban.boutique.artisan;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.util.List;
import java.util.Optional;

/** Écrit le project par défaut boutique_shop dans plugins/Artisan/projects/ s'il n'existe pas. */
public final class Bootstrapper {
    private static final List<String> RESOURCES = List.of(
            "manifest.yaml", "menus/shop_main.yaml", "menus/shop_category.yaml",
            "dialogs/confirm_purchase.yaml", "commands/boutique.yaml", "boutique/shop.yaml");

    private Bootstrapper() {}

    /** @return true si le bootstrap a écrit quelque chose. */
    public static boolean bootstrapIfAbsent(File projectsDir, Optional<String> migratedShopYaml) throws IOException {
        File projectDir = new File(projectsDir, "boutique_shop");
        if (projectDir.exists()) return false;
        for (String res : RESOURCES) {
            File target = new File(projectDir, res);
            Files.createDirectories(target.getParentFile().toPath());
            if (res.equals("boutique/shop.yaml") && migratedShopYaml.isPresent()) {
                Files.writeString(target.toPath(), migratedShopYaml.get());
            } else {
                try (InputStream in = Bootstrapper.class.getResourceAsStream("/bootstrap/" + res)) {
                    if (in == null) throw new IOException("Missing bundled resource /bootstrap/" + res);
                    Files.write(target.toPath(), in.readAllBytes());
                }
            }
        }
        return true;
    }
}
```

Wiring `ShopPlugin.onEnable` (après le register du module, dans un try/catch IOException → `getLogger().severe`) :

```java
if (!api.getProject().hasContent("boutique")) {
    Optional<String> migrated = Optional.empty();
    File legacy = new File(getDataFolder(), "config.yml");
    if (legacy.exists()) migrated = LegacyConfigMigrator.migrate(Files.readString(legacy.toPath()));
    File projectsDir = new File(api.getPlugin().getDataFolder(), "projects");
    if (Bootstrapper.bootstrapIfAbsent(projectsDir, migrated)) {
        getLogger().warning("Contenu Boutique bootstrappé dans projects/boutique_shop"
                + (migrated.isPresent() ? " (catalogue migré depuis config.yml)" : " (catalogue exemple)")
                + " — /artisan reload puis /artisan pushLocal boutique_shop pour synchroniser.");
    }
}
```

- [ ] **Step 5: Build + commit**

Run: `mvn -q test && mvn -q -DskipTests package` → PASS / BUILD SUCCESS.

```bash
git add src/main/java/fr/iban/boutique/artisan src/main/resources/bootstrap src/main/java/fr/iban/boutique/ShopPlugin.java src/test/java/fr/iban/boutique/artisan/LegacyConfigMigratorTest.java
git commit -m "feat: legacy config migrator + default content bootstrap (boutique_shop project)"
```

---

## Phase 2 — Module éditeur (repo Artisan)

### Task 7: Package `@artisan/boutique-editor`

**Files (repo Artisan):**
- Create: `editor/packages/boutique-editor/package.json`, `src/index.ts`, `src/state.ts`, `src/shopYaml.ts`, `src/BoutiqueScreen.tsx`
- Modify: `editor/src/distribution/modules.manifest.ts` (+ entrée boutique), `editor/vite.config.ts`, `editor/vitest.config.ts`, `editor/tsconfig.json` (les 3 alias, miroir exact de `@artisan/quests-editor`)
- Test: `editor/packages/boutique-editor/src/shopYaml.test.ts`

**Interfaces:**
- Consumes: `FrontendModule` + `registerModule` (SDK) ; `Project.moduleData` + `useAccountStore.setModuleData` (Task 2, import host `@/state/accountStore` — dette P1c assumée, commentaire en tête de fichier) ; convention `__files` (Task 3) ; format `boutique/v1` (Task 5).
- Produces: état structuré :

```typescript
export interface BoutiqueItem {
  id: string; name: string; icon: string; price: number; discount: number;
  lore: string[]; buyCommands: string[];
}
export interface BoutiqueCategory {
  id: string; name: string; icon: string; discount: number; items: BoutiqueItem[];
}
export interface BoutiqueState { wholeShopDiscount: number; categories: BoutiqueCategory[]; }
```

`shopYaml.ts` : `serializeShopYaml(state: BoutiqueState): string` et `parseShopYaml(content: string): BoutiqueState | null` (round-trip exact du format Task 5, `buy_commands`/`whole_shop_discount` en snake_case). `state.ts` : `readBoutiqueState(project: Project): BoutiqueState` — lit `moduleData.boutique` ; si la forme est `{ __files }`, parse `__files["shop.yaml"]` ; sinon défaut vide. `exportFiles` du module : `(project) => ({ "boutique/shop.yaml": serializeShopYaml(readBoutiqueState(project)) })` — **uniquement si** l'état a au moins une catégorie OU si `moduleData.boutique` existe (ne pas injecter un shop.yaml vide dans tous les projects).

- [ ] **Step 1: Test shopYaml qui échoue**

```typescript
import { describe, expect, it } from "vitest";
import { parseShopYaml, serializeShopYaml } from "./shopYaml";
import type { BoutiqueState } from "./state";

const STATE: BoutiqueState = {
  wholeShopDiscount: 5,
  categories: [{
    id: "weapons", name: "Armes", icon: "DIAMOND_SWORD", discount: 10,
    items: [{
      id: "diamond_sword", name: "Épée", icon: "DIAMOND_SWORD", price: 100,
      discount: 5, lore: ["Tranchante"], buyCommands: ["give %player% diamond_sword 1"],
    }],
  }],
};

describe("shopYaml", () => {
  it("round-trips state through boutique/v1 YAML", () => {
    const yaml = serializeShopYaml(STATE);
    expect(yaml).toContain("schema: boutique/v1");
    expect(yaml).toContain("buy_commands:");
    expect(parseShopYaml(yaml)).toEqual(STATE);
  });

  it("parse returns null on wrong schema or invalid yaml", () => {
    expect(parseShopYaml("schema: nope/v9")).toBeNull();
    expect(parseShopYaml("{{{")).toBeNull();
  });
});
```

Run: `cd editor && npm test -- packages/boutique-editor` → FAIL (package absent — ajouter d'abord les 3 alias + package.json sinon vitest ne résout pas ; si vitest ne découvre pas les tests du nouveau package, vérifier la clé `include` de vitest.config et l'élargir comme pour editor-sdk).

- [ ] **Step 2: Implémenter le package**

`package.json` (copie de quests-editor, nom changé) :

```json
{ "name": "@artisan/boutique-editor", "version": "0.1.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@artisan/editor-sdk": "*", "yaml": "*" },
  "peerDependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" } }
```

`src/shopYaml.ts` :

```typescript
import { parse, stringify } from "yaml";
import type { BoutiqueCategory, BoutiqueItem, BoutiqueState } from "./state";

export function serializeShopYaml(state: BoutiqueState): string {
  return stringify({
    schema: "boutique/v1",
    whole_shop_discount: state.wholeShopDiscount,
    categories: state.categories.map((c) => ({
      id: c.id, name: c.name, icon: c.icon, discount: c.discount,
      items: c.items.map((i) => ({
        id: i.id, name: i.name, icon: i.icon, price: i.price, discount: i.discount,
        lore: i.lore, buy_commands: i.buyCommands,
      })),
    })),
  });
}

export function parseShopYaml(content: string): BoutiqueState | null {
  let root: unknown;
  try { root = parse(content); } catch { return null; }
  if (typeof root !== "object" || root === null) return null;
  const r = root as Record<string, unknown>;
  if (r.schema !== "boutique/v1") return null;
  const categories: BoutiqueCategory[] = (Array.isArray(r.categories) ? r.categories : []).map((c) => {
    const cat = c as Record<string, unknown>;
    const items: BoutiqueItem[] = (Array.isArray(cat.items) ? cat.items : []).map((i) => {
      const it = i as Record<string, unknown>;
      return {
        id: String(it.id ?? ""), name: String(it.name ?? ""), icon: String(it.icon ?? "BARRIER"),
        price: Number(it.price ?? 0), discount: Number(it.discount ?? 0),
        lore: (Array.isArray(it.lore) ? it.lore : []).map(String),
        buyCommands: (Array.isArray(it.buy_commands) ? it.buy_commands : []).map(String),
      };
    });
    return {
      id: String(cat.id ?? ""), name: String(cat.name ?? ""), icon: String(cat.icon ?? "CHEST"),
      discount: Number(cat.discount ?? 0), items,
    };
  });
  return { wholeShopDiscount: Number(r.whole_shop_discount ?? 0), categories };
}
```

`src/state.ts` :

```typescript
import { parseShopYaml } from "./shopYaml";

export interface BoutiqueItem { /* … bloc Interfaces ci-dessus, verbatim … */ }
export interface BoutiqueCategory { /* … */ }
export interface BoutiqueState { wholeShopDiscount: number; categories: BoutiqueCategory[]; }

export const EMPTY_STATE: BoutiqueState = { wholeShopDiscount: 0, categories: [] };

interface ProjectLike { moduleData?: Record<string, unknown> }

/** moduleData.boutique structuré, ou normalisation de la forme __files seedée par le backend. */
export function readBoutiqueState(project: unknown): BoutiqueState {
  const md = (project as ProjectLike).moduleData?.boutique;
  if (!md || typeof md !== "object") return EMPTY_STATE;
  const raw = md as Record<string, unknown>;
  if (raw.__files && typeof raw.__files === "object") {
    const content = (raw.__files as Record<string, string>)["shop.yaml"];
    return (content && parseShopYaml(content)) || EMPTY_STATE;
  }
  if (Array.isArray(raw.categories)) return raw as unknown as BoutiqueState;
  return EMPTY_STATE;
}

export function hasBoutiqueData(project: unknown): boolean {
  return (project as ProjectLike).moduleData?.boutique !== undefined;
}
```

`src/index.ts` :

```typescript
import type { FrontendModule } from "@artisan/editor-sdk";
import { BoutiqueScreen } from "./BoutiqueScreen";
import { readBoutiqueState, hasBoutiqueData } from "./state";
import { serializeShopYaml } from "./shopYaml";

const boutiqueModule: FrontendModule = {
  id: "boutique",
  displayName: "Boutique",
  schemaVersion: "boutique/v1",
  sidebar: { icon: () => null, label: "Boutique", to: "/m/boutique" },
  routes: [{ path: "/", component: BoutiqueScreen }],
  exportFiles: (project) => {
    const state = readBoutiqueState(project);
    if (!hasBoutiqueData(project) && state.categories.length === 0) return {};
    return { "boutique/shop.yaml": serializeShopYaml(state) };
  },
};
export default boutiqueModule;
```

`src/BoutiqueScreen.tsx` — v1 volontairement simple (même altitude que QuestsScreen, pas de SchemaForm : il est sans consommateur et limité) : liste des catégories → items en table éditable (name, icon, price, discount, buy commands en textarea une-par-ligne), boutons add/remove, le tout lisant `readBoutiqueState(project)` du project actif et écrivant via `useAccountStore.getState().setModuleData(projectId, "boutique", nextState)` (normalisation `__files` → structuré au premier write). Styling : composants `Button` du SDK + classes utilitaires/`var(--token)` comme QuestsScreen. Project actif : reprendre le mécanisme utilisé par les écrans host pour connaître le project courant (chercher comment `m.$moduleId`/ModuleHost et les écrans voisins y accèdent ; à défaut, sélecteur sur `useAccountStore` : premier project de `projectOrder`). Strings UI : anglais hardcodé (précédent quests).

- [ ] **Step 3: Manifest + alias**

`modules.manifest.ts` :

```typescript
  { id: "boutique", load: () => import("@artisan/boutique-editor").then((m) => m.default) },
```

`vite.config.ts` / `vitest.config.ts` / `tsconfig.json` : dupliquer les 3 entrées d'alias de `@artisan/quests-editor` en pointant `packages/boutique-editor/src/index.ts`.

- [ ] **Step 4: GREEN + suite complète**

Run: `cd editor && npm test`
Expected: PASS (round-trip shopYaml + zéro régression).

- [ ] **Step 5: Commit**

```bash
rtk git add editor/packages/boutique-editor editor/src/distribution/modules.manifest.ts editor/vite.config.ts editor/vitest.config.ts editor/tsconfig.json
rtk git commit -m "feat(editor): @artisan/boutique-editor module — catalog editor + shop.yaml export"
```

---

### Task 8: Docs + checklist de validation cross-stack

**Files (repo Artisan):**
- Modify: `docs/architecture/modules.md` (statut : le module shop V1.5 s'appelle "boutique" et est le proof of concept livré ; noter les écarts vs la spec — pas d'`api.bootstrap`, bootstrap écrit par l'Add-on lui-même ; CommandRegistry bridgé via run_command), `docs/architecture/editor-internals.md` (module boutique + moduleData), `CHANGELOG.md`
- Create: `docs/superpowers/specs/2026-07-08-boutique-addon-validation.md` (checklist smoke manuel)

- [ ] **Step 1: Docs**

Mettre à jour les trois docs (modules.md : section "Module boutique (V1.5, shipped)" de ~15 lignes résumant data sources, `boutique:buy`, bootstrap, moduleData ; renvoyer à ce plan).

- [ ] **Step 2: Checklist smoke manuel** (contenu du fichier de validation)

```markdown
# Validation cross-stack Boutique — smoke manuel (Docker)

Préparation : `./gradlew publishToMavenLocal` (Artisan), `mvn package` (Boutique),
copier Boutique-2.0.0.jar dans le mount plugins du container minecraft, `docker compose up`.

1. Boot : log Boutique "Contenu Boutique bootstrappé…" au premier démarrage ; `/artisan reload` ; `/artisan pushLocal boutique_shop`.
2. Éditeur : le module Boutique apparaît dans la sidebar (presence) ; le project boutique_shop liste shop_main/shop_category ; le module Boutique montre le catalogue (migré ou exemple).
3. In-game : `/boutique` ouvre shop_main ; les catégories viennent de boutique:categories ; clic catégorie → shop_category filtré ; clic item → dialog ; Confirmer → tokens débités, buy_commands exécutées, historique en DB.
4. Édition : changer un prix dans le module éditeur → Deploy → prix à jour in-game sans restart (onReload).
5. Round-trip : redéployer depuis l'éditeur n'efface PAS boutique/shop.yaml sur le serveur (exportFiles le régénère).
6. Solde insuffisant : message d'erreur, pas de débit. Item sans buy_commands : achat refusé.
```

- [ ] **Step 3: Commit**

```bash
rtk git add docs/architecture/modules.md docs/architecture/editor-internals.md CHANGELOG.md docs/superpowers/specs/2026-07-08-boutique-addon-validation.md
rtk git commit -m "docs: boutique add-on shipped — modules.md status, validation checklist"
```

---

## Vérification finale

- [ ] Repo Artisan : `cd plugin && ./gradlew test` ; `cd backend && bun run test` (**jamais `bun test`**) ; `cd editor && npm test` — tout vert.
- [ ] Repo Boutique : `mvn -q test && mvn -q -DskipTests package` — vert.
- [ ] `CHANGELOG.md` Artisan : entrées Task 1 (bridge), Task 3 (local_push editorJson).
- [ ] Dérouler la checklist smoke de Task 8 en Docker (manuel, avec l'utilisateur).
- [ ] `/sync-docs` sur le repo Artisan.

## Risques identifiés à l'exécution

- **Interop Kotlin↔Java des data classes** (Task 5) : les lambdas `DataSourceDeclaration.fetcher`/`CommandDeclaration.handler` sont des `kotlin.jvm.functions.FunctionN` — friction de compilation attendue, adapter localement (retour `kotlin.Unit.INSTANCE`).
- **Shape du manifest** (Task 6 Step 3) : ids vs noms de fichiers dans `files.*` — vérifier `ProjectReader.kt` avant d'écrire.
- **Structure réelle du config.yml legacy** (Task 6 Step 1) : le migrateur est écrit contre la structure déduite du code de `ShopManager` — la valider sur le fichier réel.
- **Syntaxe `positions` multi-plages** : les menus bootstrap utilisent une plage simple (`"10-43"`) pour éviter toute incertitude sur la syntaxe à virgules.
- **`{item.lore}` dans le lore** : l'interpolation d'une liste jointe par `\n` dans une ligne de lore peut rendre à plat — si le rendu est moche au smoke test, passer `lore` du data source row en simple première-ligne (string) et itérer plus tard.
