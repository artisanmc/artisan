package gg.interfaze.plugin.yaml

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import gg.interfaze.plugin.engine.BundleCompiler
import gg.interfaze.plugin.model.*
import java.io.File
import java.util.logging.Logger

class PackReader(private val packsRoot: File, private val logger: Logger? = null) {

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    fun readAll(): List<PackBundle> =
        packsRoot.listFiles { f -> f.isDirectory }
            ?.mapNotNull { readPack(it) }
            ?: emptyList()

    private fun readPack(packDir: File): PackBundle? {
        val manifestFile = File(packDir, "manifest.yaml").takeIf { it.exists() } ?: return null
        val manifest = mapper.readValue(manifestFile, ManifestYaml::class.java)

        val langMaps: Map<String, Map<String, String>> = manifest.languages.associateWith { lang ->
            val langFile = File(packDir, "lang/$lang.yaml")
            if (langFile.exists()) mapper.readValue(langFile, object : TypeReference<Map<String, String>>() {})
            else emptyMap()
        }

        val menus = manifest.files.menus.mapNotNull { menuId ->
            val f = File(packDir, "menus/$menuId.yaml").takeIf { it.exists() } ?: return@mapNotNull null
            BundleCompiler.compile(mapper.readValue(f, MenuYaml::class.java), langMaps, logger)
        }

        val commands = manifest.files.commands.mapNotNull { cmdId ->
            val f = File(packDir, "commands/$cmdId.yaml").takeIf { it.exists() } ?: return@mapNotNull null
            mapper.readValue(f, CommandYaml::class.java)
        }

        return PackBundle(manifest.packId, manifest.defaultLang, manifest.languages, menus, commands, dialogs = emptyList())
    }
}
