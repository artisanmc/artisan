package net.artisanmc.plugin

import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.jar.JarFile
import java.util.logging.Logger
import net.artisanmc.modules.api.ArtisanModule
import net.artisanmc.modules.api.editor.ModuleBrandDeclaration
import net.artisanmc.modules.api.editor.ModuleBrandRegistry

/**
 * A module's look in the editor: the brand it registered (`api.getModuleBrands()`), else the
 * files its jar carries under [DIR] (`artisan-brand/icon.svg`, `logo-dark.svg`…), read once per
 * module instance. A module needs no code for its icon and logo, nor a newer API: dropping the
 * files in its resources is enough. Read from the jar itself, never through the class loader,
 * which could answer with another plugin's file of the same name.
 */
internal class ModuleBrands(
    private val registry: ModuleBrandRegistry,
    private val modules: () -> List<ArtisanModule>,
    private val logger: Logger,
) {
    private class Found(val module: ArtisanModule, val brand: ModuleBrandDeclaration?)

    private val discovered = ConcurrentHashMap<String, Found>()

    fun find(moduleId: String): ModuleBrandDeclaration? {
        registry.find(moduleId)?.let { return it }
        val module = modules().firstOrNull { it.id == moduleId } ?: return null
        val cached = discovered[moduleId]
        if (cached != null && cached.module === module) return cached.brand
        val brand = fromJar(module)
        discovered[moduleId] = Found(module, brand)
        return brand
    }

    private fun fromJar(module: ArtisanModule): ModuleBrandDeclaration? {
        val location = runCatching { module.javaClass.protectionDomain?.codeSource?.location?.toURI() }.getOrNull()
            ?: return null
        val jar = runCatching { File(location) }.getOrNull()?.takeIf { it.isFile } ?: return null
        return try {
            JarFile(jar).use { file ->
                val files = ModuleBrandDeclaration.FILES.mapNotNull { name ->
                    val entry = file.getJarEntry("$DIR/$name.svg") ?: return@mapNotNull null
                    if (entry.size > ModuleBrandDeclaration.MAX_FILE_SIZE) {
                        throw IllegalArgumentException("$DIR/$name.svg is ${entry.size} bytes, ${ModuleBrandDeclaration.MAX_FILE_SIZE} at most")
                    }
                    name to file.getInputStream(entry).use { it.readNBytes(ModuleBrandDeclaration.MAX_FILE_SIZE + 1) }
                }.toMap()
                if (files.isEmpty()) null else ModuleBrandDeclaration(files)
            }
        } catch (e: Exception) {
            logger.warning("[Artisan] Module '${module.id}': its icon and logo ($DIR/ in ${jar.name}) are left out: ${e.message}")
            null
        }
    }

    companion object {
        const val DIR = "artisan-brand"
    }
}
