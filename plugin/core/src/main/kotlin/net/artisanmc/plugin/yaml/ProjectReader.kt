package net.artisanmc.plugin.yaml

import net.artisanmc.plugin.engine.RuntimeProject
import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.MenuCompiler
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
    /**
     * Called for each Document the server failed to load (`projectId`, relative
     * path, reason).
     *
     * Without it a broken YAML is skipped silently on both sides: the server does
     * not run it, the editor does not show it, and nothing explains why it is gone.
     * The signal reaches the editor through `project_read`.
     */
    private val onSkip: (String, String, String) -> Unit = { _, _, _ -> },
) {
    /** Test convenience — production passes the shared [net.artisanmc.plugin.project.ProjectRoots]. */
    constructor(
        projectsRoot: File,
        logger: Logger? = null,
        declaredModels: () -> Map<String, Map<String, Any?>> = { emptyMap() },
    ) : this(net.artisanmc.plugin.project.ProjectRoots(projectsRoot), logger, declaredModels)

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    /** What a kind's reader needs from the project being read. */
    private class ReadContext(
        val projectId: String,
        val manifest: ManifestYaml,
        val langMaps: Map<String, Map<String, String>>,
        val templates: Map<String, TemplateYaml>,
    )

    /**
     * One reader per core kind: a file of that kind, its id (the file name) and
     * the project's context, to the runtime Document the loaded Project carries under
     * that kind (ADR `extensible-document-kinds`, decision 10). The folder loop
     * in [readDocuments] knows no kind by name; a registered kind without a reader
     * here is left on disk for the module that owns it.
     */
    private val coreReaders: Map<String, (File, String, ReadContext) -> RuntimeDocument> = mapOf(
        DocumentKinds.MENU.kind to { f, menuId, ctx ->
            val menuYaml = withFileId(mapper.readValue(f, MenuYaml::class.java), menuId, f)
            requireSchema(f, menuYaml.schema, *DocumentKinds.MENU.schemaVersions.toTypedArray())
            val currentMenu =
                if (menuYaml.schema == DocumentKinds.MENU.canonicalSchema) menuYaml
                else menuYaml.copy(schema = DocumentKinds.MENU.canonicalSchema)
            MenuCompiler.compile(
                resolveTemplates(currentMenu, ctx.templates),
                ctx.langMaps, logger, defaultLang = ctx.manifest.defaultLang,
            ).copy(
                projectId = ctx.projectId,
                loreMaxWidth = ctx.manifest.loreMaxWidth,
                escapeGoesBack = ctx.manifest.escapeGoesBack,
            )
        },
        DocumentKinds.COMMAND.kind to { f, cmdId, _ ->
            val cmdYaml = withFileId(mapper.readValue(f, CommandYaml::class.java), cmdId, f)
            requireSchema(f, cmdYaml.schema, *DocumentKinds.COMMAND.schemaVersions.toTypedArray())
            cmdYaml
        },
        DocumentKinds.DIALOG.kind to { f, dialogId, ctx ->
            val dialogYaml = withFileId(mapper.readValue(f, DialogYaml::class.java), dialogId, f)
            requireSchema(f, dialogYaml.schema, *DocumentKinds.DIALOG.schemaVersions.toTypedArray())
            RuntimeDialog(dialogYaml, ctx.langMaps, defaultLang = ctx.manifest.defaultLang, projectId = ctx.projectId)
        },
    )

    /**
     * The reader of a kind the core does not know (one a module registered):
     * the file's mapping as is, checked against the kind's declared `schema:`
     * labels, under the id its file name gives (ADR `extensible-document-kinds`,
     * W6). The owning module reads it back through `ProjectContentApi.documents`.
     */
    private fun rawReader(kind: DocumentKind): (File, String, ReadContext) -> RuntimeDocument = { f, docId, ctx ->
        val root = mapper.readValue(f, Map::class.java)
        val data: Map<String, Any?> = root?.entries?.associate { it.key.toString() to it.value } ?: emptyMap()
        val schema = data["schema"]?.toString().orEmpty()
        requireSchema(f, schema, *kind.schemaVersions.toTypedArray())
        val declaredId = data["id"]?.toString()
        if (!declaredId.isNullOrEmpty() && declaredId != docId) {
            logger?.warning("[Artisan] ${f.path}: id '$declaredId' ignored; the file name '$docId' is the id.")
        }
        RuntimeRawDocument(docId, kind.kind, schema, ctx.projectId, data - "id")
    }

    /**
     * Verify the YAML's `schema` field is either empty (legacy / pre-versioning)
     * or matches the expected version. Reject everything else with a clear error
     * pointing at the schema migration framework (see api.schemas), as an
     * [UnsupportedSchemaException]: the per-file `runCatching` blocks below let
     * that type (and only it) fail the reload.
     */
    private fun requireSchema(file: File, actual: String, vararg expected: String) {
        if (actual.isEmpty() || actual in expected) return
        throw UnsupportedSchemaException(
            "Unsupported schema version '$actual' in ${file.absolutePath} — " +
            "this plugin reads ${expected.joinToString(", ")} only. Register a SchemaMigration via " +
            "api.schemas.register(...) to migrate from older versions."
        )
    }

    /**
     * The **file name is a Document's identity**.
     *
     * One rule: the file wins. A diverging inner `id:` is ignored and logged, so a
     * legacy project says so instead of silently disagreeing. Two rules ("the file,
     * unless an id is present") would keep the ambiguity alive.
     */
    private inline fun <reified T : Any> withFileId(doc: T, fileId: String, file: File): T {
        val current = when (doc) {
            is MenuYaml -> doc.id
            is CommandYaml -> doc.id
            is DialogYaml -> doc.id
            else -> ""
        }
        if (current.isNotEmpty() && current != fileId) {
            logger?.warning(
                "[Artisan] ${file.name} declares 'id: $current', ignored: the identity is the file " +
                "name ('$fileId'). Remove that field, and rename the file if you wanted the other name."
            )
        }
        @Suppress("UNCHECKED_CAST")
        return when (doc) {
            is MenuYaml -> doc.copy(id = fileId) as T
            is CommandYaml -> doc.copy(id = fileId) as T
            is DialogYaml -> doc.copy(id = fileId) as T
            else -> doc
        }
    }

    /**
     * The module's Documents, **discovered by scan** of every themed folder
     * ([DocumentLayout]): `<folders…>/<kind dir>/<id>.yaml`. A file the layout
     * refuses (duplicate id, subfolder of a kind folder…) is reported through
     * [onSkip] and not read. Alphabetical order, so stable from one load to the next.
     */
    private fun documentFiles(projectId: String, projectDir: File): List<DocumentLayout.Entry> {
        val paths = projectDir.walkTopDown()
            .maxDepth(SCAN_DEPTH)
            .onEnter { dir ->
                dir == projectDir || !(dir.name.startsWith(".") ||
                    (dir.parentFile == projectDir && dir.name in DocumentLayout.RESOURCE_DIRS))
            }
            .filter { it.isFile }
            .map { it.relativeTo(projectDir).invariantSeparatorsPath }
            .toList()
        val layout = DocumentLayout.classify(paths, DocumentKinds.all().map { it.dir }.toSet())
        for (e in layout.errors) {
            logger?.warning("[Artisan] skipping ${projectDir.name}/${e.path}: ${e.reason}")
            onSkip(projectId, e.path, e.reason)
        }
        return layout.documents.sortedBy { it.id }
    }

    fun readAll(): List<RuntimeProject> =
        roots.all().mapNotNull { (projectId, dir) ->
            // Tolerant per project: a broken manifest/lang never nukes the
            // whole reload (which would fail plugin enable + cascade to
            // add-ons that `depend: Artisan`).
            tolerant("project ${dir.name}") { readProject(projectId, dir) }
        }

    /**
     * The one failure rule of a read, per file: [read]'s exception is logged as
     * `skipping <what>` and the file yields `null`, except an
     * [UnsupportedSchemaException] when [loudSchema] (the default), which fails
     * the reload. [onFail] lets a step report the skip further ([onSkip]).
     */
    private inline fun <T> tolerant(
        what: String,
        loudSchema: Boolean = true,
        onFail: (Throwable) -> Unit = {},
        read: () -> T,
    ): T? = runCatching(read).getOrElse { e ->
        if (loudSchema && e is UnsupportedSchemaException) throw e
        logger?.warning("[Artisan] skipping $what: ${e.message}")
        onFail(e)
        null
    }

    /** One project, in named steps: manifest → lang → legacy templates → Documents → sources. */
    private fun readProject(projectId: String, projectDir: File): RuntimeProject? {
        val manifest = readManifest(projectId, projectDir) ?: return null
        val langMaps = readLangMaps(projectDir, manifest)
        val templates = readLegacyTemplates(projectDir)
        val documents = readDocuments(projectDir, ReadContext(projectId, manifest, langMaps, templates))
        val dataDir = File(projectDir, "data")
        val projectModels = readProjectModels(projectDir)
        val dataSources = readSingleFileSources(dataDir, projectModels, langMaps, manifest.defaultLang) +
            readPerRowSources(dataDir, projectModels, langMaps, manifest.defaultLang)
        return RuntimeProject(
            projectId, manifest.defaultLang, manifest.languages,
            documents, dataSources, langMaps,
        )
    }

    /** `manifest.yaml`, or `null` when the folder has none (not a project). */
    private fun readManifest(projectId: String, projectDir: File): ManifestYaml? {
        val manifestFile = File(projectDir, "manifest.yaml").takeIf { it.exists() } ?: return null
        val manifest = mapper.readValue(manifestFile, ManifestYaml::class.java)
        requireSchema(manifestFile, manifest.schema, "manifest/v1")
        if (manifest.projectId.isNotEmpty() && manifest.projectId != projectId) {
            logger?.warning("[Artisan] ${manifestFile.path}: legacy project_id '${manifest.projectId}' ignored; resolved identity is '$projectId'. Remove project_id from this manifest.")
        }
        return manifest
    }

    /**
     * Lang files are YAML trees; `LangFlattener` folds them back to the dotted
     * keys the runtime looks up (and still reads the legacy flat form).
     * Tolerant PER FILE, like menus/dialogs/data sources: an unreadable lang
     * file degrades to no translations for that language (raw `{i18n:…}` tags
     * in game) instead of dropping the whole project, since this read sits
     * above every menu, command and dialog.
     */
    private fun readLangMaps(projectDir: File, manifest: ManifestYaml): Map<String, Map<String, String>> =
        manifest.languages.associateWith { lang ->
            val langFile = File(projectDir, "lang/$lang.yaml")
            if (!langFile.exists()) return@associateWith emptyMap()
            tolerant("lang/$lang.yaml of project ${projectDir.name}") {
                LangFlattener.flatten(mapper.readValue(langFile, object : TypeReference<Map<String, Any?>>() {}))
            } ?: emptyMap()
        }

    /**
     * LEGACY item templates (template/v1). Item sets are no longer a
     * project-level shared entity — a set lives on the element that renders
     * it, and the editor inlines any `templates/` file away on import. This
     * read stays so a server whose disk still holds one keeps working until
     * the project is re-saved; nothing writes these files anymore. A template
     * of an unknown schema is skipped like any broken one (not loud).
     */
    private fun readLegacyTemplates(projectDir: File): Map<String, TemplateYaml> =
        File(projectDir, "templates")
            .listFiles { f -> f.isFile && f.name.endsWith(".yaml") }
            ?.sortedBy { it.name }
            ?.mapNotNull { f ->
                tolerant("template ${f.name}", loudSchema = false) {
                    val t = mapper.readValue(f, TemplateYaml::class.java)
                    requireSchema(f, t.schema, "template/v1")
                    if (t.id.isEmpty()) t.copy(id = f.nameWithoutExtension) else t
                }
            }
            ?.associateBy { it.id } ?: emptyMap()

    /**
     * Every Document the layout finds, each file through its kind's reader.
     * Tolerant per file (like data sources): a single unparseable Document —
     * e.g. a stale-format file mid-migration — logs + skips (and is reported
     * through [onSkip]) instead of failing the whole reload and the plugin
     * enable.
     */
    private fun readDocuments(projectDir: File, ctx: ReadContext): Map<String, List<RuntimeDocument>> {
        val byDir = documentFiles(ctx.projectId, projectDir).groupBy { it.dir }
        return DocumentKinds.all().associate { kind ->
            val reader = coreReaders[kind.kind] ?: rawReader(kind)
            kind.kind to byDir[kind.dir].orEmpty().mapNotNull { entry ->
                val f = File(projectDir, entry.path)
                tolerant(
                    "${kind.kind} ${entry.path}",
                    onFail = { e -> onSkip(ctx.projectId, entry.path, e.message ?: e::class.simpleName.orEmpty()) },
                ) { reader(f, entry.id, ctx) }
            }
        }
    }

    /*
     * Project sources — scanned, not manifest-listed. Tolerant per file: a bad
     * source logs + skips, never blocks the project load. Two accepted forms
     * (ADR bare-data-files): the legacy inline `schema: data/v1` document, or a
     * BARE file (mapping = object source, list = table) whose schema resolves
     * from models/<id>.yaml or a JAR declaration.
     */

    /** `data/<id>.yaml`: one file per source. */
    private fun readSingleFileSources(
        dataDir: File,
        projectModels: Map<String, Map<String, Any?>>,
        langMaps: Map<String, Map<String, String>>,
        defaultLang: String,
    ): List<RuntimeDataSource> = dataDir
        .listFiles { f -> f.isFile && f.name.endsWith(".yaml") }
        ?.sortedBy { it.name }
        ?.mapNotNull { f ->
            tolerant("data source ${f.name}") {
                val sourceId = f.name.removeSuffix(".yaml")
                val dsYaml = readSourceDocument(f, sourceId, projectModels)
                RuntimeDataSource(dsYaml, langMaps, defaultLang)
            }
        } ?: emptyList()

    /**
     * Per-row granularity: data/<id>/ holds one file per row. `_source.yaml`
     * is OPTIONAL (ADR bare-data-files ③): absent → all files sorted by name;
     * present → its `order:` first (it may be the legacy full meta, or minimal
     * `model:` + `order:`).
     */
    private fun readPerRowSources(
        dataDir: File,
        projectModels: Map<String, Map<String, Any?>>,
        langMaps: Map<String, Map<String, String>>,
        defaultLang: String,
    ): List<RuntimeDataSource> = dataDir
        .listFiles { f -> f.isDirectory }
        ?.sortedBy { it.name }
        ?.mapNotNull { dir ->
            tolerant("data source dir ${dir.name}") {
                RuntimeDataSource(readPerRowSource(dir, projectModels), langMaps, defaultLang)
            }
        } ?: emptyList()

    private fun readPerRowSource(dir: File, projectModels: Map<String, Map<String, Any?>>): DataSourceYaml {
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
            tolerant("row ${dir.name}/$n") {
                @Suppress("UNCHECKED_CAST")
                mapper.readValue(onDisk[n]!!, Map::class.java) as Map<String, Any?>
            }
        }
        return meta.copy(shape = "table", rows = rows)
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
     * Migration shim: current projects carry their own display + states.
     * Also normalizes to the flat `elements` form (stacking order preserved).
     */
    private fun resolveTemplates(yaml: MenuYaml, templates: Map<String, TemplateYaml>): MenuYaml {
        if (templates.isEmpty()) return yaml
        val resolved = yaml.allElements.map { el ->
            val ref = el.iterates?.template ?: el.places?.template ?: return@map el
            val tpl = templates[ref] ?: return@map el
            // A legacy template's list is addressed display-first (index 0 is
            // the `default` state), same order the element's display + states use.
            val hasOwn = el.display != AppearanceYaml() || el.states.isNotEmpty()
            el.copy(
                display = if (hasOwn) el.display else tpl.appearances.firstOrNull() ?: AppearanceYaml(),
                states = if (hasOwn) el.states else tpl.appearances.drop(1),
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

    private companion object {
        /** Deep enough to report a misplaced file a few levels past [DocumentLayout.MAX_DEPTH]. */
        const val SCAN_DEPTH = DocumentLayout.MAX_DEPTH + 5
    }
}
