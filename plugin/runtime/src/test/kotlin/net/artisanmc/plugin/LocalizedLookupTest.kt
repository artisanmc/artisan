package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.engine.localize
import net.artisanmc.plugin.engine.lookupLocalized
import net.artisanmc.plugin.model.LocalizedText
import kotlin.test.*

/** The one `{i18n:key}` → address → literal chain shared by menus, dialogs and actions. */
class LocalizedLookupTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val langMap = mapOf("greet" to "Hello", "menus.m.title" to "Bonjour")

    @Test fun `an explicit i18n ref wins over the address`() {
        assertEquals("Hello", lookupLocalized("{i18n:greet}", langMap, "menus.m.title"))
    }

    @Test fun `a missing i18n ref keeps the ref as written`() {
        assertEquals("{i18n:nope}", lookupLocalized("{i18n:nope}", langMap, "menus.m.title"))
    }

    @Test fun `a literal is looked up at its address, else stands`() {
        assertEquals("Bonjour", lookupLocalized("Hi", langMap, "menus.m.title"))
        assertEquals("Hi", lookupLocalized("Hi", langMap, "menus.m.other"))
        assertEquals("Hi", lookupLocalized("Hi", langMap, null))
    }

    @Test fun `localize keeps a field-local map authoritative`() {
        val ctx = ExecutionContext(MockBukkit.getMock()!!.addPlayer("Steve"), lang = "fr", langMap = langMap)
        assertEquals("Salut", ctx.localize(LocalizedText.ofMap(mapOf("en" to "Hi", "fr" to "Salut")), "menus.m.title"))
        assertEquals("Bonjour", ctx.localize(LocalizedText.of("Hi"), "menus.m.title"))
        assertEquals("Hello", ctx.localize(LocalizedText.of("{i18n:greet}")))
    }
}
