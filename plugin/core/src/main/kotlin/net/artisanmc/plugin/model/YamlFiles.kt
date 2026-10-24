package net.artisanmc.plugin.model

import java.io.File

/**
 * The two YAML extensions a module's files may carry: `.yml`, the Bukkit/Paper norm and what
 * Artisan writes ([EXT]), and `.yaml`, what it wrote before. Both are read everywhere; `<stem>.yml` and
 * `<stem>.yaml` side by side are one file twice, never merged: a Document is refused
 * ([DocumentLayout] `duplicate_id`), any other file is read from its `.yml` copy and the
 * other is named in the log.
 *
 * Mirrored by the editor (`lib/yamlFiles.ts`).
 */
object YamlFiles {
    val EXTENSIONS = listOf(".yml", ".yaml")

    /** The extension of every YAML file Artisan writes. */
    const val EXT = ".yml"

    fun isYaml(name: String): Boolean = EXTENSIONS.any { name.endsWith(it) }

    /** [name] without its YAML extension, or `null` when it has none. */
    fun stem(name: String): String? = EXTENSIONS.firstOrNull { name.endsWith(it) }?.let { name.dropLast(it.length) }

    /** [path] under [EXT] when it is a YAML path (`menus/shop.yaml` → `menus/shop.yml`). */
    fun canonical(path: String): String = stem(path)?.let { it + EXT } ?: path

    /**
     * Where [path] (relative to [root]) is on disk: [path] when it is there, its other YAML
     * spelling when only that one is, else [canonical] for a YAML path not there at all. The
     * module file is the folder's ([ModuleFile.find]), else [ModuleFile.NAME].
     */
    fun onDisk(root: File, path: String): String {
        val stem = stem(path) ?: return path
        if (File(root, path).exists()) return path
        if (ModuleFile.isModuleFile(path)) return ModuleFile.find(root)?.name ?: ModuleFile.NAME
        return EXTENSIONS.map { stem + it }.firstOrNull { File(root, it).exists() } ?: (stem + EXT)
    }

    /** `<dir>/<stem>.yml`, else `<dir>/<stem>.yaml`, else `null`; [onBoth] names the one left out. */
    fun find(dir: File, stem: String, onBoth: (ignored: File) -> Unit = {}): File? {
        val (yml, yaml) = EXTENSIONS.map { File(dir, stem + it) }
        return when {
            yml.isFile -> yml.also { if (yaml.isFile) onBoth(yaml) }
            yaml.isFile -> yaml
            else -> null
        }
    }

    /** The YAML files of [dir] by stem, a stem held twice by its `.yml` copy ([onBoth] as in [find]). */
    fun list(dir: File, onBoth: (ignored: File) -> Unit = {}): Map<String, File> {
        val out = sortedMapOf<String, File>()
        dir.listFiles { f -> f.isFile && isYaml(f.name) }?.sortedBy { it.name }?.forEach { f ->
            val stem = stem(f.name)!!
            val held = out[stem]
            when {
                held == null -> out[stem] = f
                f.name.endsWith(".yml") -> { onBoth(held); out[stem] = f }
                else -> onBoth(f)
            }
        }
        return out
    }
}
