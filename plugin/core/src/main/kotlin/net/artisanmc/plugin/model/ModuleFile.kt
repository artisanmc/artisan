package net.artisanmc.plugin.model

import java.io.File

/**
 * The file that makes a folder a module: `artisan-module.yml` (`schema: module/v1`), named so
 * that a module copied out of `plugins/Artisan/modules/` (a zip, a repository, an add-on's own
 * folder) still says what it is. `manifest.yaml` (`manifest/v1`, same fields) is what Artisan
 * wrote before, still read when the folder has no `artisan-module.yml`.
 */
object ModuleFile {
    const val NAME = "artisan-module.yml"
    const val SCHEMA = "module/v1"

    /** Before `artisan-module.yml`, by order of preference. */
    val LEGACY = listOf("manifest.yml", "manifest.yaml")
    const val LEGACY_SCHEMA = "manifest/v1"

    val NAMES = listOf(NAME) + LEGACY

    fun isModuleFile(path: String): Boolean = path in NAMES

    /** The folder's module file, or `null` when it is not a module. */
    fun find(dir: File): File? = NAMES.map { File(dir, it) }.firstOrNull { it.isFile }
}
