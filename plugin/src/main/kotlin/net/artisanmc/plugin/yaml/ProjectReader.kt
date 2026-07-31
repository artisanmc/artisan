package net.artisanmc.plugin.yaml

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.BundleCompiler
import net.artisanmc.plugin.model.*
import java.io.File
import java.util.logging.Logger

class ProjectReader(
    private val roots: net.artisanmc.plugin.project.ProjectRoots,
    private val logger: Logger? = null,
    /**
     * JAR-declared model documents (`ns:id` → model/v1 doc), supplied by the
     * ModelRegistry — resolved at load to type BARE data files (ADR
     * bare-data-files ①). Empty when no add-on declared anything (or at the
     * very first boot load, before add-ons enable — bare sources then read
     * untyped, i.e. every value literal, and get typed at the next reload).
     */
    private val declaredModels: () -> Map<String, Map<String, Any?>> = { emptyMap() },
) {
    /** Test convenience — production passes the shared [net.artisanmc.plugin.project.ProjectRoots]. */
    constructor(
        projectsRoot: File,
        logger: Logger? = null,
        declaredModels: () -> Map<String, Map<String, Any?>> = { emptyMap() },
    ) : this(net.artisanmc.plugin.project.ProjectRoots(projectsRoot), logger, declaredModels)

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    /**
     * Verify the YAML's `schema` field is either empty (legacy / pre-versioning)
     * or matches the expected version. Reject everything else with a clear error
     * pointing at the schema migration framework (see api.schemas).
     *
     * In V1 we only know "manifest/v1", "menu/v1", "command/v1", "dialog/v1".
     * Future versions will register a SchemaMigration via api.schemas.register(...)
     * and run loadToCurrent before Jackson binds the data class.
     */
    private fun requireSchema(file: File, actual: String, expected: String) {
        if (actual.isEmpty() || actual == expected) return
        throw IllegalArgumentException(
            "Unsupported schema version '$actual' in ${file.absolutePath} — " +
            "this plugin reads $expected only. Register a SchemaMigration via " +
            "api.schemas.register(...) to migrate from older versions."
        )
    }

    fun readAll(): List<ProjectBundle> =
        roots.all().values.mapNotNull { dir ->
            // Tolerant per project: a broken manifest/lang never nukes the
            // whole reload (which would fail plugin enable + cascade to
            // add-ons that `depend: Artisan`).
            runCatching { readProject(dir) }.getOrElse { e ->
                if (e is IllegalArgumentException) throw e // schema-version rejection stays loud
                logger?.warning("[Artisan] skipping project ${dir.name}: ${e.message}")
                null
            }
        }

    private fun readProject(projectDir: File): ProjectBundle? {
        val manifestFile = File(projectDir, "manifest.yaml").takeIf { it.exists() } ?: return null
        val manifest = mapper.readValue(manifestFile, ManifestYaml::class.java)
        requireSchema(manifestFile, manifest.schema, "manifest/v1")

        // Lang files are YAML trees; `LangFlattener` folds them back to the
        // dotted keys the runtime looks up (and still reads the legacy flat form).
        // Tolerant PER FILE, like menus/dialogs/data sources below: an unreadable
        // lang file degrades to no translations for that language (raw `{i18n:…}`
        // tags in game) instead of dropping the whole project — a hand-edit typo
        // in one lang file used to cost every menu, command and dialog of the
        // project, since this read sits above them all.
        val langMaps: Map<String, Map<String, String>> = manifest.languages.associateWith { lang ->
            val langFile = File(projectDir, "lang/$lang.yaml")
            if (!langFile.exists()) return@associateWith emptyMap()
            runCatching {
                LangFlattener.flatten(mapper.readValue(langFile, object : TypeReference<Map<String, Any?>>() {}))
            }.getOrElse { e ->
                logger?.warning(
                    "[Artisan] skipping lang/$lang.yaml of project ${projectDir.name}: ${e.message}"
                )
                emptyMap()
            }
        }

        // LEGACY item templates (template/v1). Item sets are no longer a
        // project-level shared entity — a set lives on the element that renders
        // it, and the editor inlines any `templates/` file away on import. This
        // read stays so a server whose disk still holds one keeps working until
        // the project is re-saved; nothing writes these files anymore.
        val templates: Map<String, TemplateYaml> = File(projectDir, "templates")
            .listFiles { f -> f.isFile && f.name.endsWith(".yaml") }
            ?.sortedBy { it.name }
            ?.mapNotNull { f ->
                runCatching {
                    val t = mapper.readValue(f, TemplateYaml::class.java)
                    requireSchema(f, t.schema, "template/v1")
                    if (t.id.isEmpty()) t.copy(id = f.nameWithoutExtension) else t
                }.getOrElse { e ->
                    logger?.warning("[Artisan] skipping template ${f.name}: ${e.message}")
                    null
                }
            }
            ?.associateBy { it.id } ?: emptyMap()

        // Tolerant per file (like data sources below): a single unparseable
        // menu/command/dialog — e.g. a stale-format file mid-migration — logs +
        // skips instead of failing the whole reload and the plugin enable.
        val menus = manifest.files.menus.mapNotNull { menuId ->
            val f = File(projectDir, "menus/$menuId.yaml").takeIf { it.exists() } ?: return@mapNotNull null
            runCatching {
                val menuYaml = mapper.readValue(f, MenuYaml::class.java)
                requireSchema(f, menuYaml.schema, "menu/v1")
                BundleCompiler.compile(
                    resolveTemplates(menuYaml, templates),
                    langMaps, logger, defaultLang = manifest.defaultLang,
                )
            }.getOrElse { e ->
                if (e is IllegalArgumentException) throw e // schema-version rejection stays loud
                logger?.warning("[Artisan] skipping menu ${f.name}: ${e.message}")
                null
            }
        }

        val commands = manifest.files.commands.mapNotNull { cmdId ->
            val f = File(projectDir, "commands/$cmdId.yaml").takeIf { it.exists() } ?: return@mapNotNull null
            runCatching {
                val cmdYaml = mapper.readValue(f, CommandYaml::class.java)
                requireSchema(f, cmdYaml.schema, "command/v1")
                cmdYaml
            }.getOrElse { e ->
                if (e is IllegalArgumentException) throw e // schema-version rejection stays loud
                logger?.warning("[Artisan] skipping command ${f.name}: ${e.message}")
                null
            }
        }

        val dialogs = manifest.files.dialogs.mapNotNull { dialogId ->
            val f = File(projectDir, "dialogs/$dialogId.yaml").takeIf { it.exists() } ?: return@mapNotNull null
            runCatching {
                val dialogYaml = mapper.readValue(f, DialogYaml::class.java)
                requireSchema(f, dialogYaml.schema, "dialog/v1")
                BundleDialog(dialogYaml, langMaps, defaultLang = manifest.defaultLang)
            }.getOrElse { e ->
                if (e is IllegalArgumentException) throw e // schema-version rejection stays loud
                logger?.warning("[Artisan] skipping dialog ${f.name}: ${e.message}")
                null
            }
        }

        // Project sources — scanned, not manifest-listed. Tolerant per file: a
        // bad source logs + skips, never blocks the project load. Two accepted
        // forms (ADR bare-data-files): the legacy inline `schema: data/v1`
        // document, or a BARE file (mapping = object source, list = table)
        // whose schema resolves from models/<id>.yaml or a JAR declaration.
        val dataDir = File(projectDir, "data")
        val projectModels = readProjectModels(projectDir)
        val singleFileSources = dataDir
            .listFiles { f -> f.isFile && f.name.endsWith(".yaml") }
            ?.sortedBy { it.name }
            ?.mapNotNull { f ->
                runCatching {
                    val sourceId = f.name.removeSuffix(".yaml")
                    val dsYaml = readSourceDocument(f, sourceId, projectModels)
                    BundleDataSource(dsYaml, langMaps, manifest.defaultLang)
                }.getOrElse { e ->
                    logger?.warning("[Artisan] skipping data source ${f.name}: ${e.message}")
                    null
                }
            } ?: emptyList()
        // Per-row granularity: data/<id>/ holds one file per row. `_source.yaml`
        // is OPTIONAL (ADR bare-data-files ③): absent → all files sorted by
        // name; present → its `order:` first (it may be the legacy full meta,
        // or minimal `model:` + `order:`).
        val perRowSources = dataDir
            .listFiles { f -> f.isDirectory }
            ?.sortedBy { it.name }
            ?.mapNotNull { dir ->
                runCatching {
                    val sourceId = dir.name
                    // `_source.yaml` is always META (legacy full form, or minimal
                    // `model:` + `order:`) — never bare values.
                    val metaFile = File(dir, "_source.yaml")
                    val meta = if (metaFile.isFile) {
                        val m = mapper.readValue(metaFile, DataSourceYaml::class.java)
                        requireSchema(metaFile, m.schema, "data/v1")
                        m.copy(
                            id = m.id.ifEmpty { sourceId },
                            fields = m.fields.ifEmpty { resolveFields(sourceId, m.model, projectModels) },
                        )
                    } else {
                        DataSourceYaml(id = sourceId, fields = resolveFields(sourceId, null, projectModels))
                    }
                    val onDisk = dir.listFiles { f -> f.isFile && f.name.endsWith(".yaml") && f.name != "_source.yaml" }
                        ?.associateBy { it.name.removeSuffix(".yaml") } ?: emptyMap()
                    // Declared order first, then hand-added files (byte-sorted).
                    val names = meta.order.filter { it in onDisk } +
                        onDisk.keys.filterNot { it in meta.order }.sorted()
                    val rows = names.mapNotNull { n ->
                        runCatching {
                            @Suppress("UNCHECKED_CAST")
                            mapper.readValue(onDisk[n]!!, Map::class.java) as Map<String, Any?>
                        }.getOrElse { e ->
                            logger?.warning("[Artisan] skipping row ${dir.name}/$n: ${e.message}")
                            null
                        }
                    }
                    BundleDataSource(meta.copy(shape = "table", rows = rows), langMaps, manifest.defaultLang)
                }.getOrElse { e ->
                    logger?.warning("[Artisan] skipping data source dir ${dir.name}: ${e.message}")
                    null
                }
            } ?: emptyList()
        val dataSources = singleFileSources + perRowSources

        return ProjectBundle(
            manifest.projectId, manifest.defaultLang, manifest.languages,
            menus, commands, dialogs, dataSources, langMaps,
        )
    }

    /**
     * Parses ONE data source file (single-file source or `_source.yaml`).
     * Exactly `schema: data/v1` (or a loud-rejected other version) selects the
     * legacy inline form; any other root — mapping or list — is BARE values
     * (ADR bare-data-files ②/③): id from filename, schema resolved beside.
     */
    private fun readSourceDocument(
        f: File,
        sourceId: String,
        projectModels: Map<String, Map<String, Any?>>,
    ): DataSourceYaml {
        val raw = mapper.readValue(f, Any::class.java)
        if (raw is Map<*, *> && (raw["schema"] as? String)?.startsWith("data/") == true) {
            val dsYaml = mapper.readValue(f, DataSourceYaml::class.java)
            requireSchema(f, dsYaml.schema, "data/v1")
            val fields = dsYaml.fields.ifEmpty { resolveFields(sourceId, dsYaml.model, projectModels) }
            return dsYaml.copy(id = dsYaml.id.ifEmpty { sourceId }, fields = fields)
        }
        return when (raw) {
            is List<*> -> DataSourceYaml(
                id = sourceId, shape = "table",
                fields = resolveFields(sourceId, null, projectModels),
                rows = raw.mapNotNull { r ->
                    @Suppress("UNCHECKED_CAST")
                    (r as? Map<String, Any?>)
                },
            )
            is Map<*, *> -> DataSourceYaml(
                id = sourceId, shape = "config",
                fields = resolveFields(sourceId, null, projectModels),
                value = raw.entries.associate { it.key.toString() to it.value },
            )
            else -> throw IllegalArgumentException("data source ${f.name}: root must be a mapping or a list")
        }
    }

    /**
     * Schema precedence for a source without inline `fields` (ADR
     * bare-data-files ①): explicit `model:` ref > `models/<sourceId>.yaml`
     * (its own fields, or its `model:` ref, one hop) > untyped (empty —
     * every value literal, never an error).
     */
    private fun resolveFields(
        sourceId: String,
        modelRef: String?,
        projectModels: Map<String, Map<String, Any?>>,
    ): List<DataFieldYaml> {
        fun fieldsOf(doc: Map<String, Any?>?): List<DataFieldYaml>? {
            val raw = doc?.get("fields") as? List<*> ?: return null
            return runCatching {
                raw.map { mapper.convertValue(flattenField(it), DataFieldYaml::class.java) }
            }.getOrNull()
        }
        fun lookup(ref: String): Map<String, Any?>? =
            declaredModels()[ref] ?: projectModels[ref]

        if (modelRef != null) return fieldsOf(lookup(modelRef)) ?: emptyList()
        val own = projectModels[sourceId] ?: return emptyList()
        fieldsOf(own)?.takeIf { it.isNotEmpty() }?.let { return it }
        val ref = own["model"] as? String ?: return emptyList()
        return fieldsOf(lookup(ref)) ?: emptyList()
    }

    /**
     * model/v1 fields come in two shapes: FLATTENED (`{name, kind, of…}` —
     * data/v1 inline vocabulary, add-on declarations) and the editor's
     * VERBATIM form (`{name, type: {kind, of…}}`). Normalize to flattened so
     * one DataFieldYaml binding reads both.
     */
    private fun flattenField(f: Any?): Any? {
        if (f !is Map<*, *>) return f
        val ty = f["type"] as? Map<*, *>
        val m: MutableMap<Any?, Any?> = if (ty != null) {
            flattenType(ty).also { it["name"] = f["name"] }
        } else {
            HashMap<Any?, Any?>(f).also { out ->
                (f["of"] as? Map<*, *>)?.let { out["of"] = flattenField(it) }
                (f["fields"] as? List<*>)?.let { out["fields"] = it.map(::flattenField) }
                (f["variants"] as? List<*>)?.let { vs -> out["variants"] = vs.map(::flattenVariant) }
            }
        }
        return m
    }

    private fun flattenType(t: Map<*, *>): MutableMap<Any?, Any?> {
        val m = HashMap<Any?, Any?>(t)
        (t["of"] as? Map<*, *>)?.let { m["of"] = flattenField(it) }
        (t["fields"] as? List<*>)?.let { m["fields"] = it.map(::flattenField) }
        (t["variants"] as? List<*>)?.let { vs -> m["variants"] = vs.map(::flattenVariant) }
        return m
    }

    private fun flattenVariant(v: Any?): Any? {
        if (v !is Map<*, *>) return v
        return HashMap<Any?, Any?>(v).also { out ->
            (v["fields"] as? List<*>)?.let { out["fields"] = it.map(::flattenField) }
        }
    }

    /** models/<id>.yaml docs, keyed by BOTH the file id and the doc's `id:` (ns refs). */
    private fun readProjectModels(projectDir: File): Map<String, Map<String, Any?>> {
        val out = mutableMapOf<String, Map<String, Any?>>()
        File(projectDir, "models").listFiles { f -> f.isFile && f.name.endsWith(".yaml") }
            ?.sortedBy { it.name }
            ?.forEach { f ->
                runCatching {
                    @Suppress("UNCHECKED_CAST")
                    val doc = mapper.readValue(f, Map::class.java) as Map<String, Any?>
                    out[f.name.removeSuffix(".yaml")] = doc
                    (doc["id"] as? String)?.let { out.putIfAbsent(it, doc) }
                }.getOrElse { e ->
                    logger?.warning("[Artisan] skipping model ${f.name}: ${e.message}")
                }
            }
        return out
    }

    /**
     * Resolves LEGACY `iterates.template` / `places.template` refs into
     * EFFECTIVE elements: the template's appearances/alias/key_field are
     * injected so the compiler and renderer stay template-unaware. A dangling
     * ref keeps the element's local fields (non-hermetic — renders nothing).
     * Migration shim: current projects carry their appearances on the element.
     * Also normalizes to the flat `elements` form (stacking order preserved).
     */
    private fun resolveTemplates(yaml: MenuYaml, templates: Map<String, TemplateYaml>): MenuYaml {
        if (templates.isEmpty()) return yaml
        val resolved = yaml.allElements.map { el ->
            val ref = el.iterates?.template ?: el.places?.template ?: return@map el
            val tpl = templates[ref] ?: return@map el
            el.copy(
                appearances = if (el.appearances.isEmpty()) tpl.appearances else el.appearances,
                iterates = el.iterates?.let {
                    if (it.template != null) it.copy(alias = tpl.alias.ifEmpty { it.alias }) else it
                },
                places = el.places?.let {
                    if (it.template != null) {
                        it.copy(
                            alias = tpl.alias.ifEmpty { it.alias },
                            keyField = tpl.keyField.ifEmpty { it.keyField },
                        )
                    } else it
                },
            )
        }
        return yaml.copy(elements = resolved, layers = emptyList())
    }
}
