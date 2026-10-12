package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import org.bukkit.entity.Player

/**
 * Les rappels de la surface publique, en interfaces fonctionnelles plutôt qu'en
 * types fonction Kotlin.
 *
 * Une lambda Kotlin se compile en `kotlin.jvm.functions.FunctionN`. Exposer ça
 * dans une signature publique obligeait chaque add-on à mettre la kotlin-stdlib
 * sur son classpath de compilation, et surtout interdisait de relocaliser la
 * stdlib dans le shadowJar — donc Artisan servait ses `kotlin.*` sous les noms
 * d'origine à tout le serveur, jusqu'au `LinkageError` dès qu'un autre plugin
 * Kotlin faisait pareil (cf. ApiSurfaceIsJavaFriendlyTest).
 *
 * Ce sont des `fun interface` : les appelants Kotlin passent toujours une
 * lambda (conversion SAM), les appelants Java une lambda Java. Personne n'écrit
 * `object : DataFetcher`.
 */

/** Produit les lignes d'une data source. Cf. [DataSourceDeclaration.fetcher]. */
@Stable
fun interface DataFetcher {
    fun fetch(player: Player?, params: Map<String, Any?>): List<Map<String, Any?>>
}

/** Exécute une commande de module. Cf. [CommandDeclaration.handler]. */
@Stable
fun interface CommandHandler {
    fun handle(player: Player, args: Map<String, Any?>)
}

/** Reçoit un événement publié sur le [ModuleEventBus]. */
@Stable
fun interface ModuleEventHandler {
    fun onEvent(event: ModuleEvent)
}

/** Lit le discriminant de version d'un document. Cf. `SchemaRegistry.loadToCurrent`. */
@Stable
fun interface SchemaVersionReader<T> {
    fun versionOf(document: T): String
}
