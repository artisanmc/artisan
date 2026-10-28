package net.artisanmc.plugin.engine

import be.seeseemelk.mockbukkit.MockBukkit
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import net.artisanmc.plugin.session.ScreenValue

/**
 * The placeholder contract for the previous-menu feature, as injected by
 * `SyncedMenuProvider.decorateNavigation`: `has_previous_menu` is a boolean a
 * condition can read, `previous_menu` is an object whose bare rendering is the
 * screen id.
 */
class NavigationPlaceholderTest {

    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() { MockBukkit.unmock() }

    private fun player() = MockBukkit.getMock()!!.addPlayer()

    private fun decorated(hasPrevious: Boolean, previousId: String? = null): ExecutionContext {
        val extra = buildMap<String, Any> {
            put("has_previous_menu", hasPrevious)
            if (previousId != null) put("previous_menu", ScreenValue(mapOf("id" to previousId), previousId))
        }
        return ExecutionContext(player(), args = extra)
    }

    @Test fun `previous_menu id and bare rendering`() {
        val ctx = decorated(true, "shop_main")
        assertEquals("shop_main", ctx.render("{previous_menu.id}"))
        assertEquals("shop_main", ctx.render("{previous_menu}"))
    }

    @Test fun `has_previous_menu drives an expression condition`() {
        val yes = decorated(true, "wiki")
        val no = decorated(false)
        val evaluator = ConditionEvaluator.EMPTY
        assertTrue(evaluator.evaluate(Condition.Expression("has_previous_menu"), yes))
        assertFalse(evaluator.evaluate(Condition.Expression("has_previous_menu"), no))
    }

    @Test fun `an unbound previous_menu renders its source (visible mistake)`() {
        val ctx = decorated(false)
        assertEquals("{previous_menu.id}", ctx.render("{previous_menu.id}"))
    }
}
