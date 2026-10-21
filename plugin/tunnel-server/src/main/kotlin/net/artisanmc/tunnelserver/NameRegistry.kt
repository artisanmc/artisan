package net.artisanmc.tunnelserver

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import net.artisanmc.tunnel.Tunnel
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.logging.Level
import java.util.logging.Logger

/**
 * The names addresses took (ADR `editor-tunnel`): `survie.<domain>` for the tunnel `<id>`, one name per id,
 * first come first served. Kept in [file], rewritten whole on each change: a few thousand names at most.
 * Without [file], names last until a restart.
 *
 * A name nobody connected under for [expiry] is free again; [banned] names can never be taken.
 */
class NameRegistry(
    private val file: File?,
    private val reserved: Set<String> = RESERVED,
    private val expiry: Duration = Duration.ofDays(90),
    /** Names one id takes per UTC day, and one address (the plugin's) for all its ids: squatting costs connections. */
    private val changesPerDay: Int = 3,
    private val claimsPerAddressPerDay: Int = 10,
    private val clock: Clock = Clock.systemUTC(),
    private val logger: Logger = Logger.getLogger("artisan-tunnel-server"),
) {
    data class Entry(val id: String, val claimedAt: Instant, val seenAt: Instant)

    /** The names file. */
    data class Stored(val names: Map<String, Entry> = emptyMap(), val banned: Set<String> = emptySet())

    sealed interface Claim {
        data class Taken(val name: String, val previous: String?) : Claim
        data class Refused(val error: String) : Claim
    }

    private val names = HashMap<String, Entry>()
    private val banned = HashSet<String>()
    /** Names taken today, per id and per `address:` (in memory: a restart forgets them). */
    private val changes = HashMap<String, Pair<LocalDate, Int>>()

    init {
        if (file != null && file.isFile) {
            runCatching { mapper.readValue(file, Stored::class.java) }
                .onSuccess { names += it.names; banned += it.banned }
                .onFailure { logger.log(Level.SEVERE, "Names file $file unreadable, starting without names", it) }
        }
    }

    @Synchronized
    fun nameOf(id: String): String? = names.entries.firstOrNull { it.value.id == id }?.key

    @Synchronized
    fun idOf(name: String): String? = names[name]?.id

    /** Whether [id], from [address], could take [name] now: null if so, else the error [claim] would give. */
    @Synchronized
    fun refusal(id: String, name: String, address: String = ""): String? = when {
        !Tunnel.validName(name) -> "invalid"
        isReserved(name) -> "reserved"
        names[name]?.let { it.id != id } == true -> "taken"
        names[name] != null -> null
        used(id) >= changesPerDay -> "too_many"
        address.isNotEmpty() && used("address:$address") >= claimsPerAddressPerDay -> "too_many"
        else -> null
    }

    /** [id] takes [name], giving back the one it had. */
    @Synchronized
    fun claim(id: String, name: String, address: String = ""): Claim {
        refusal(id, name, address)?.let { return Claim.Refused(it) }
        val previous = nameOf(id)
        if (previous == name) return Claim.Taken(name, previous)
        val now = clock.instant()
        previous?.let(names::remove)
        names[name] = Entry(id, now, now)
        count(id)
        if (address.isNotEmpty()) count("address:$address")
        save()
        return Claim.Taken(name, previous)
    }

    private fun used(key: String) = changes[key]?.takeIf { it.first == today() }?.second ?: 0

    private fun count(key: String) {
        changes[key] = today() to (used(key) + 1)
    }

    /** [id] gives its name back; the name it had, if any. */
    @Synchronized
    fun release(id: String): String? = nameOf(id)?.also { names.remove(it); save() }

    /** Frees [name] (admin); [ban] also keeps anyone from taking it again. The id that held it, if any. */
    @Synchronized
    fun revoke(name: String, ban: Boolean): String? {
        val held = names.remove(name)?.id
        if (ban) banned += name
        if (held != null || ban) save()
        return held
    }

    @Synchronized
    fun unban(name: String): Boolean = banned.remove(name).also { if (it) save() }

    /**
     * [id] connected, or is still connected: its name stays. Names of ids not seen for [expiry] and not
     * in [connected] go back.
     */
    @Synchronized
    fun seen(id: String, connected: Set<String>) {
        val now = clock.instant()
        var changed = false
        names.entries.firstOrNull { it.value.id == id }?.let { entry ->
            if (Duration.between(entry.value.seenAt, now) > Duration.ofHours(1)) {
                entry.setValue(entry.value.copy(seenAt = now))
                changed = true
            }
        }
        val expired = names.filter { (_, e) -> e.id !in connected && e.id != id && Duration.between(e.seenAt, now) > expiry }.keys
        if (expired.isNotEmpty()) {
            names.keys -= expired
            logger.info("Names expired: ${expired.joinToString()}")
            changed = true
        }
        if (changed) save()
    }

    @Synchronized
    fun all(): Map<String, Entry> = names.toMap()

    @Synchronized
    fun bannedNames(): Set<String> = banned.toSet()

    private fun isReserved(name: String) =
        name in reserved || name in banned || BLOCKED_WORDS.any { it in name }

    private fun today() = LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC)

    private fun save() {
        val target = file ?: return
        try {
            target.absoluteFile.parentFile?.mkdirs()
            val temporary = File(target.absoluteFile.parentFile, "${target.name}.tmp")
            mapper.writerWithDefaultPrettyPrinter().writeValue(temporary, Stored(names.toSortedMap(), banned.toSortedSet()))
            Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        } catch (e: Exception) {
            logger.log(Level.SEVERE, "Names file $target not written: names last until a restart", e)
        }
    }

    companion object {
        private val mapper = jacksonObjectMapper().findAndRegisterModules()
            .configure(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false)

        /** Names of the tunnel server itself and of the project, or that read as someone official. */
        val RESERVED = setOf(
            "connect", "tunnel", "www", "api", "app", "admin", "administrator", "root", "system", "status", "health",
            "mail", "smtp", "imap", "pop", "ftp", "ns1", "ns2", "cdn", "static", "assets", "files", "download", "downloads",
            "docs", "doc", "wiki", "help", "support", "contact", "abuse", "security", "legal", "privacy", "terms",
            "blog", "news", "shop", "store", "boutique", "pay", "billing", "account", "accounts", "auth", "oauth", "sso",
            "dashboard", "panel", "console", "editor", "dev", "staging", "test", "demo", "official", "staff", "team",
            "artisan", "artisanmc", "artisan-mc",
        )

        /**
         * Words no name may contain: brands people sign in to, and what phishing pages are named after.
         * Minecraft itself is not in it: servers rightly say they are one.
         */
        val BLOCKED_WORDS = listOf(
            "paypal", "discord", "mojang", "microsoft", "xbox", "google", "apple", "icloud", "steam", "epicgames",
            "nitro", "login", "signin", "password", "verify", "wallet", "bank", "crypto", "giftcard", "freecoins",
        )
    }
}
