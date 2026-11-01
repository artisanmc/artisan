package net.artisanmc.plugin.engine

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.model.ModelField
import net.artisanmc.modules.api.model.ModelFieldType
import net.artisanmc.modules.api.variable.DuplicateVariableException
import net.artisanmc.modules.api.variable.ModuleVariableDeclaration
import net.artisanmc.modules.api.variable.VariableRegistry
import net.artisanmc.modules.api.variable.VariableScope
import net.artisanmc.modules.api.variable.VariableType
import net.artisanmc.plugin.integrations.SoftDepRegistry
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ModuleVariableValuesTest {
    private val registry = VariableRegistry()
    private val warnings = mutableListOf<String>()
    private val members = mutableSetOf<String>()
    private val eval = ConditionEvaluator(SoftDepRegistry.EMPTY, CooldownStore())

    @BeforeTest fun setup() {
        MockBukkit.mock()
        registry.bindWarnings { warnings += it }
        ModuleVariableValues.registry = registry
        registry.bindOwner("guilds")
        registry.declare(ModuleVariableDeclaration("has_guild", VariableType.BOOLEAN, VariableScope.PLAYER) { p, _ -> p.name in members })
        registry.declare(ModuleVariableDeclaration("level", VariableType.NUMBER, VariableScope.PLAYER) { _, _ -> 3 })
        registry.declare(ModuleVariableDeclaration("broken", VariableType.NUMBER, VariableScope.PLAYER) { _, _ -> "three" })
        registry.bindOwner("quests")
        registry.declare(ModuleVariableDeclaration("status", VariableType.STRING, VariableScope.PLAYER,
            listOf("none", "completed"), ModelField("quest", ModelFieldType.string()), mapOf("en" to "A quest's status"),
        ) { _, key -> if (key == "daily/miner") "completed" else "none" })
        registry.bindOwner(null)
    }

    @AfterTest fun teardown() {
        ModuleVariableValues.registry = null
        MockBukkit.unmock()
    }

    private fun player() = MockBukkit.getMock()!!.addPlayer()
    private fun holds(expr: String, p: org.bukkit.entity.Player) = eval.evaluate(Condition.Expression(expr), ExecutionContext(p))

    @Test fun `a condition reads a module variable for the context's player`() {
        val p = player()
        assertFalse(holds("var.guilds.has_guild", p))
        members += p.name
        assertTrue(holds("var.guilds.has_guild", p), "read again at each evaluation, nothing cached")
        assertTrue(holds("!var.guilds.has_guild == false", p))
    }

    @Test fun `numbers, keyed variables and closed values compare as declared`() {
        val p = player()
        assertTrue(holds("var.guilds.level >= 3", p))
        assertTrue(holds("var.quests.status[\"daily/miner\"] == \"completed\"", p))
        assertTrue(holds("var.quests.status[\"weekly/fisher\"] == \"none\"", p))
    }

    @Test fun `an undeclared module or variable reads as absent`() {
        val p = player()
        assertFalse(holds("var.lands.claims > 0", p))
        assertFalse(holds("var.guilds.nope", p))
        assertTrue(holds("var.lands == null", p))
    }

    @Test fun `a value of another type reads as absent, said once`() {
        val p = player()
        assertFalse(holds("var.guilds.broken == \"three\"", p))
        assertFalse(holds("var.guilds.broken == \"three\"", p))
        assertEquals(1, warnings.size, warnings.toString())
    }

    @Test fun `an arg named var is not overridden`() {
        val p = player()
        val ctx = ExecutionContext(p, args = mapOf("var" to mapOf("guilds" to mapOf("has_guild" to true))))
        assertTrue(eval.evaluate(Condition.Expression("var.guilds.has_guild"), ctx))
    }

    @Test fun `texts read them too`() {
        val p = player()
        members += p.name
        assertEquals("guild: true, level: 3", ExecutionContext(p).render("guild: {var.guilds.has_guild}, level: {var.guilds.level}"))
    }

    @Test fun `a variable is named after its module, once, and leaves with it`() {
        assertFailsWith<IllegalStateException> {
            registry.declare(ModuleVariableDeclaration("x", VariableType.STRING, VariableScope.SERVER) { _, _ -> "" })
        }
        registry.bindOwner("guilds")
        assertFailsWith<DuplicateVariableException> {
            registry.declare(ModuleVariableDeclaration("has_guild", VariableType.BOOLEAN, VariableScope.PLAYER) { _, _ -> true })
        }
        registry.bindOwner(null)
        assertEquals(listOf("guilds.broken", "guilds.has_guild", "guilds.level", "quests.status"), registry.registered().map { it.qualifiedName })
        registry.unregisterOwnedBy("guilds")
        assertEquals(listOf("quests.status"), registry.registered().map { it.qualifiedName })
        assertNull(registry.find("guilds.has_guild"))
    }

    @Test fun `the presence entry names the variable, its type, key and values`() {
        assertEquals(
            mapOf(
                "name" to "quests.status", "type" to "string", "scope" to "player", "values" to listOf("none", "completed"),
                "key" to mapOf("name" to "quest", "type" to mapOf("kind" to "string")), "description" to mapOf("en" to "A quest's status"),
                "module_id" to "quests",
            ),
            registry.find("quests.status")!!.toWire(),
        )
    }
}
