package net.artisanmc.plugin.yaml

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.BundleCompiler
import net.artisanmc.plugin.model.*
import java.io.File
import java.util.logging.Logger

class ProjectReader(private val projectsRoot: File, private val logger: Logger? = null) {

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
        projectsRoot.listFiles { f -> f.isDirectory }
            ?.mapNotNull { readProject(it) }
            ?: emptyList()

    private fun readProject(projectDir: File): ProjectBundle? {
        val manifestFile = File(projectDir, "manifest.yaml").takeIf { it.exists() } ?: return null
        val manifest = mapper.readValue(manifestFile, ManifestYaml::class.java)
        requireSchema(manifestFile, manifest.schema, "manifest/v1")

        val langMaps: Map<String, Map<String, String>> = manifest.languages.associateWith { lang ->
            val langFile = File(projectDir, "lang/$lang.yaml")
            if (langFile.exists()) mapper.readValue(langFile, object : TypeReference<Map<String, String>>() {})
            else emptyMap()
        }

        val menus = manifest.files.menus.mapNotNull { menuId ->
            val f = File(projectDir, "menus/$menuId.yaml").takeIf { it.exists() } ?: return@mapNotNull null
            val menuYaml = mapper.readValue(f, MenuYaml::class.java)
            requireSchema(f, menuYaml.schema, "menu/v1")
            BundleCompiler.compile(menuYaml, langMaps, logger, defaultLang = manifest.defaultLang)
        }

        val commands = manifest.files.commands.mapNotNull { cmdId ->
            val f = File(projectDir, "commands/$cmdId.yaml").takeIf { it.exists() } ?: return@mapNotNull null
            val cmdYaml = mapper.readValue(f, CommandYaml::class.java)
            requireSchema(f, cmdYaml.schema, "command/v1")
            cmdYaml
        }

        val dialogs = manifest.files.dialogs.mapNotNull { dialogId ->
            val f = File(projectDir, "dialogs/$dialogId.yaml").takeIf { it.exists() } ?: return@mapNotNull null
            val dialogYaml = mapper.readValue(f, DialogYaml::class.java)
            requireSchema(f, dialogYaml.schema, "dialog/v1")
            BundleDialog(dialogYaml, langMaps, defaultLang = manifest.defaultLang)
        }

        // Project sources (data/v1) — scanned, not manifest-listed. Tolerant per
        // file: a bad source logs + skips, never blocks the project load.
        val dataSources = File(projectDir, "data")
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

        return ProjectBundle(
            manifest.projectId, manifest.defaultLang, manifest.languages,
            menus, commands, dialogs, dataSources,
        )
    }
}
