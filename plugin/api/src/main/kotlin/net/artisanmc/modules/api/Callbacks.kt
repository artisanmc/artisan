package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import org.bukkit.entity.Player

/**
 * Public-surface callbacks, as functional interfaces rather than Kotlin function types.
 *
 * A Kotlin lambda compiles to `kotlin.jvm.functions.FunctionN`. Exposing that in a
 * public signature forced every add-on to put kotlin-stdlib on its compile classpath,
 * and above all prevented relocating the stdlib in the shadowJar, so Artisan served
 * its `kotlin.*` classes under their original names to the whole server, up to a
 * `LinkageError` as soon as another Kotlin plugin did the same
 * (see ApiSurfaceIsJavaFriendlyTest).
 *
 * They are `fun interface`s: Kotlin callers still pass a lambda (SAM conversion),
 * Java callers a Java lambda.
 */

/** Produces a data source's rows. See [DataSourceDeclaration.fetcher]. */
@Stable
fun interface DataFetcher {
    fun fetch(player: Player?, params: Map<String, Any?>): List<Map<String, Any?>>
}

/** Runs a module command. See [CommandDeclaration.handler]. */
@Stable
fun interface CommandHandler {
    fun handle(player: Player, args: Map<String, Any?>)
}

/** Receives an event published on the [ModuleEventBus]. */
@Stable
fun interface ModuleEventHandler {
    fun onEvent(event: ModuleEvent)
}

/** Reads a document's version discriminator. See `SchemaRegistry.loadToCurrent`. */
@Stable
fun interface SchemaVersionReader<T> {
    fun versionOf(document: T): String
}
