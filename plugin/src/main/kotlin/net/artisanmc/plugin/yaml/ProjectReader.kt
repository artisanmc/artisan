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
) {
    /** Test convenience — production passes the shared [net.artisanmc.plugin.project.ProjectRoots]. */
    constructor(projectsRoot: File, logger: Logger? = null)
        : this(net.artisanmc.plugin.project.ProjectRoots(projectsRoot), logger)

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

        val langMaps: Map<String, Map<String, String>> = manifest.languages.associateWith { lang ->
            val langFile = File(projectDir, "lang/$lang.yaml")
            if (langFile.exists()) mapper.readValue(langFile, object : TypeReference<Map<String, String>>() {})
            else emptyMap()
        }

        // Item templates (template/v1) — scanned like data sources so a
        // hand-added file loads without a manifest edit. Tolerant per file.
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

        // Project sources (data/v1) — scanned, not manifest-listed. Tolerant per
        // file: a bad source logs + skips, never blocks the project load.
        val dataDir = File(projectDir, "data")
        val singleFileSources = dataDir
            .listFiles { f -> f.isFile && f.name.endsWith(".yaml") }
            ?.sortedBy { it.name }
            ?.mapNotNull { f ->
                runCatching {
                    val dsYaml = mapper.readValue(f, DataSourceYaml::class.java)
                    requireSchema(f, dsYaml.schema, "data/v1")
                    BundleDataSource(dsYaml, langMaps, manifest.defaultLang)
                }.getOrElse { e ->
                    logger?.warning("[Artisan] skipping data source ${f.name}: ${e.message}")
                    null
                }
            } ?: emptyList()
        // Per-row granularity (ADR composable-data-models §2): data/<id>/ holds
        // _source.yaml (meta + fields + row order) and one file per row.
        val perRowSources = dataDir
            .listFiles { f -> f.isDirectory && File(f, "_source.yaml").isFile }
            ?.sortedBy { it.name }
            ?.mapNotNull { dir ->
                runCatching {
                    val meta = mapper.readValue(File(dir, "_source.yaml"), DataSourceYaml::class.java)
                    requireSchema(File(dir, "_source.yaml"), meta.schema, "data/v1")
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
                    BundleDataSource(meta.copy(rows = rows), langMaps, manifest.defaultLang)
                }.getOrElse { e ->
                    logger?.warning("[Artisan] skipping data source dir ${dir.name}: ${e.message}")
                    null
                }
            } ?: emptyList()
        val dataSources = singleFileSources + perRowSources

        return ProjectBundle(
            manifest.projectId, manifest.defaultLang, manifest.languages,
            menus, commands, dialogs, dataSources,
        )
    }

    /**
     * Resolves `iterates.template` / `places.template` refs into EFFECTIVE
     * elements: the template's appearances/alias/key_field are injected so the
     * compiler and renderer stay template-unaware. A dangling ref keeps the
     * element's local fields (non-hermetic — typically renders nothing).
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
