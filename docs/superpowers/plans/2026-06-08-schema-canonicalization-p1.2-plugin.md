# Canonicalisation P1.2 — conformité plugin (réaligner le parsing sur le menu/v1 canonique)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Réaligner le parsing du plugin Kotlin sur la forme `menu/v1` canonique que l'éditeur émet désormais (P1.1), pour restaurer l'intégration éditeur↔plugin. Le seul vrai désalignement introduit par P1.1 : les conditions composites sont émises avec `of` (canonique) mais `ConditionParser` lit encore `all`/`any`.

**Architecture:** Analyse du code plugin : `ActionParser` (pagination_next/prev, show_title, open_dialog/close_dialog), `MenuTitleParser` (title array/string/map), `BundleCompiler` (`if` Map-ou-List) sont **déjà** compatibles avec le canonique. Le seul écart est `ConditionParser.parse` : `and → raw["all"]`, `or → raw["any"]` → doit lire `of`. On corrige ces 2 lignes, on met à jour les tests existants qui utilisent `all`/`any`, et on ajoute un **oracle cross-stack** : parser les exemples canoniques de l'éditeur (`docs/schema/menu/v1/examples/`) à travers `BundleCompiler` sans erreur.

**Tech Stack:** Kotlin 2.0, JUnit 5 (`./gradlew test`), Jackson (YAML/JSON), MockBukkit.

**Prérequis:** P1.1 mergée (éditeur émet le canonique).

**Gaps runtime NON traités ici (déjà documentés, projets séparés)** : exécution des branches `if` de clic (`extractFromSteps` ne garde que `kind:"action"`) ; parsing/éval de `expression` et `set_arg*` (l'éditeur peut les émettre ; le plugin les ignore/drop l'appearance via le `runCatching` de `compileAppearance`). Les menus de migration zmenu/DeluxeMenus n'utilisent pas ces constructs.

---

### Task 1 : `ConditionParser` lit `of` pour `and`/`or`

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ConditionParser.kt`
- Modify/Create: test du ConditionParser (le retrouver ; sinon créer `plugin/src/test/kotlin/net/artisanmc/plugin/engine/ConditionParserTest.kt`)

- [ ] **Step 1 : Trouver le test existant + les fixtures `all`/`any`**

Run (working_directory `plugin`):
```bash
rg -n "\"all\"|\"any\"|ConditionParser|Condition\.And|Condition\.Or" src/test
```
Noter les fichiers/tests qui encodent des conditions composites en `all`/`any` (ils devront passer en `of`).

- [ ] **Step 2 : Écrire/mettre à jour le test attendant `of` (RED)**

Dans le test du ConditionParser (existant ou nouveau), ajouter/migrer :
```kotlin
@Test
fun `parses and with of key`() {
    val raw = mapOf(
        "type" to "and",
        "of" to listOf(
            mapOf("type" to "has_permission", "perm" to "vip"),
            mapOf("type" to "has_money", "amount" to 100),
        ),
    )
    val c = ConditionParser.parse(raw) as Condition.And
    assertEquals(2, c.all.size)
    assertTrue(c.all[0] is Condition.HasPermission)
}

@Test
fun `parses or with of key`() {
    val raw = mapOf(
        "type" to "or",
        "of" to listOf(
            mapOf("type" to "has_permission", "perm" to "a"),
            mapOf("type" to "has_permission", "perm" to "b"),
        ),
    )
    val c = ConditionParser.parse(raw) as Condition.Or
    assertEquals(2, c.any.size)
}

@Test
fun `parses not with of key`() {
    val raw = mapOf("type" to "not", "of" to mapOf("type" to "has_permission", "perm" to "x"))
    val c = ConditionParser.parse(raw) as Condition.Not
    assertTrue(c.inner is Condition.HasPermission)
}
```
Migrer tout test existant utilisant `all`/`any` vers `of` (mettre à jour la fixture, garder l'assertion sur `Condition.And.all`/`Or.any` qui sont les noms de champ internes).

- [ ] **Step 3 : Run (RED)**

Run (working_directory `plugin`): `./gradlew test --tests "*ConditionParser*"`
Expected : FAIL — le parser lit encore `all`/`any`, le test fournit `of`.

- [ ] **Step 4 : Corriger `ConditionParser`**

Remplacer les deux lignes `and`/`or` :
```kotlin
            "and"                -> Condition.And((raw["of"] as List<*>).map { parse(it as Map<String, Any>) })
            "or"                 -> Condition.Or((raw["of"] as List<*>).map { parse(it as Map<String, Any>) })
```
(`not` lit déjà `of` — inchangé.)

- [ ] **Step 5 : Run (GREEN)**

Run (working_directory `plugin`): `./gradlew test --tests "*ConditionParser*"`
Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/ConditionParser.kt plugin/src/test
git commit -m "fix(plugin): ConditionParser reads canonical 'of' for and/or"
```

---

### Task 2 : Oracle cross-stack — les exemples canoniques de l'éditeur compilent dans le plugin

But : prouver que ce que l'éditeur émet (forme canonique, fichiers `docs/schema/menu/v1/examples/`) est parsable par le plugin sans erreur.

**Files:**
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/engine/CanonicalConformanceTest.kt`

- [ ] **Step 1 : Écrire le test**

```kotlin
package net.artisanmc.plugin.engine

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import com.fasterxml.jackson.module.kotlin.readValue
import net.artisanmc.plugin.model.MenuYaml
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

class CanonicalConformanceTest {

    private val mapper = ObjectMapper().registerKotlinModule()

    // Resolve from the repo root. Gradle runs tests with working dir = plugin module dir.
    private fun example(name: String): MenuYaml {
        val candidates = listOf(
            File("../docs/schema/menu/v1/examples/$name"),
            File("docs/schema/menu/v1/examples/$name"),
        )
        val f = candidates.firstOrNull { it.exists() }
            ?: error("example not found from ${File(".").absolutePath}: tried $candidates")
        return mapper.readValue(f)
    }

    @Test
    fun `canonical button example compiles with its actions`() {
        val menu = example("canonical-button.json")
        val compiled = BundleCompiler.compile(menu, emptyMap())
        // The button element has one appearance with a left-click of two flat action steps.
        val apps = compiled.compiledAppearances.values.flatten()
        assertTrue(apps.isNotEmpty(), "expected at least one compiled appearance")
        val leftActions = apps.first().clicks[ClickType.LEFT]?.actions ?: emptyList()
        assertTrue(leftActions.any { it is Action.RunCommand }, "expected a run_command action")
        assertTrue(leftActions.any { it is Action.SendMessage }, "expected a send_message action")
    }

    @Test
    fun `canonical conditional example compiles its appearance condition`() {
        val menu = example("canonical-conditional.json")
        val compiled = BundleCompiler.compile(menu, emptyMap())
        val apps = compiled.compiledAppearances.values.flatten()
        // First appearance gates on has_permission (an `if` array of one condition).
        assertTrue(
            apps.any { app -> app.conditions.any { it is Condition.HasPermission } },
            "expected a has_permission gate to compile",
        )
        // NOTE: the click `kind:"if"` branch is intentionally NOT executed by the plugin
        // (documented runtime gap) — we only assert the menu compiles without throwing.
    }
}
```

- [ ] **Step 2 : Run + ajuster le chemin si besoin**

Run (working_directory `plugin`): `./gradlew test --tests "*CanonicalConformanceTest*"`
Expected : PASS. Si `example not found`, lire le `absolutePath` affiché et ajuster le `candidates` (selon le working dir réel de Gradle). Vérifier aussi les vrais noms de champs : `CompiledAppearance.conditions` / `.clicks`, `ClickHandler.actions`, `ClickType.LEFT` (lire `CompiledAppearance`/`ClickHandler`/`ClickType` si une assertion ne compile pas, et corriger l'assertion — PAS le code de prod).

- [ ] **Step 3 : Commit**

```bash
git add plugin/src/test/kotlin/net/artisanmc/plugin/engine/CanonicalConformanceTest.kt
git commit -m "test(plugin): cross-stack oracle — canonical editor examples compile"
```

---

### Task 3 : Suite plugin complète + docs

**Files:**
- Modify: `docs/architecture/schemas-codegen.md`, `CHANGELOG.md`

- [ ] **Step 1 : Suite plugin verte**

Run (working_directory `plugin`): `./gradlew test`
Expected : BUILD SUCCESSFUL. Si un test casse à cause du passage `all`/`any`→`of`, le migrer vers `of` (et seulement ça). Ne pas réintroduire `all`/`any` dans le parser.

- [ ] **Step 2 : Docs**

- `docs/architecture/schemas-codegen.md` : marquer **P1.2 ✅** (plugin conforme — `ConditionParser` en `of`, oracle cross-stack). Rappeler les gaps runtime restants (branches if de clic, `expression`, `set_arg*`).
- `CHANGELOG.md` `[Unreleased]` : `ConditionParser` lit `of` (réaligne le plugin sur le menu/v1 canonique) ; oracle cross-stack « exemples éditeur compilent dans le plugin ».

- [ ] **Step 3 : Commit**

```bash
git add docs/architecture/schemas-codegen.md CHANGELOG.md
git commit -m "docs(schema): P1.2 — plugin conforms to canonical menu/v1"
```

---

## Self-review

- **Couverture** : `ConditionParser` `of` (T1), oracle cross-stack (T2), suite verte + docs (T3). ✓
- **Périmètre minimal justifié** : l'analyse du code montre que `ActionParser`/`MenuTitleParser`/`BundleCompiler` sont déjà compatibles canonique ; seul `ConditionParser` divergeait. Pas de réécriture des DTO (le plugin a déjà des sealed classes à la main). ✓
- **Gaps assumés** : branches `if` de clic, `expression`, `set_arg*` non exécutés — documentés, hors P1.2. Le `runCatching` de `compileAppearance` empêche un crash (l'appearance fautive est droppée + logguée). ✓
- **Risque** : faible — 2 lignes de prod + tests. Le plugin reste tolérant en lecture (title string-ou-array, if map-ou-array) → pas de régression sur d'anciens bundles.
- **Cohérence des noms** : `ConditionParser`, `CanonicalConformanceTest`, `Condition.And.all`/`Or.any` (champs internes inchangés). ✓

## Suite

- **Intégration éditeur↔plugin restaurée** → `main` est de nouveau déployable/testable de bout en bout. La cible « tester les menus zmenu prod » est débloquée côté stack.
- **P2** : command/v1, dialog/v1, translations/v1, manifest, template — même patron (canoniser le schéma, conformer éditeur+plugin, oracle). À noter : `command/v1` et `dialog/v1` ont aussi des DTO plugin (`CommandYaml`, `DialogYaml`) et un export éditeur.
- Puis **dé-parquer la feature IA** (`2026-06-08-ai-assistant-design.md`).
