package net.artisanmc.plugin

import net.artisanmc.plugin.engine.Action
import net.artisanmc.plugin.engine.Step
import net.artisanmc.plugin.engine.assignI18nAddresses
import net.artisanmc.plugin.actiondsl.compileActionDsl
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Action texts carry their canonical i18n ADDRESS so inline mode can translate
 * them: the menu file holds the default language's literal, the other languages
 * sit at that address in `lang/<lang>.yaml`.
 *
 * The counter scheme is the editor's (`visitStepLTexts` in i18nSites.ts) and the
 * two sides must agree exactly, or a translated string lands at an address the
 * runtime never looks up: walk order is document order, `if` cases before the
 * `else`; messages, titles and subtitles count INDEPENDENTLY; the first of each
 * has no suffix (`.message`, `.show_title`, `.show_subtitle`), the rest are
 * `_1`, `_2`… from the second one on.
 */
class ActionI18nAddressTest {

    private fun addresses(dsl: String, prefix: String): List<String?> {
        val out = mutableListOf<String?>()
        fun walk(steps: List<Step>) {
            for (s in steps) when (s) {
                is Step.ActionStep -> when (val a = s.action) {
                    is Action.SendMessage -> out.add(a.i18n)
                    is Action.Broadcast -> out.add(a.i18n)
                    is Action.ShowTitle -> { out.add(a.i18nTitle); out.add(a.i18nSubtitle) }
                    else -> {}
                }
                is Step.IfStep -> { s.cases.forEach { walk(it.steps) }; walk(s.elseSteps) }
            }
        }
        walk(assignI18nAddresses(compileActionDsl(dsl), prefix))
        return out
    }

    @Test fun `the first message of a handler has no suffix, the next ones count from 1`() {
        val got = addresses(
            """
            send_message "a"
            send_message "b"
            send_message "c"
            """.trimIndent(),
            "menus.shop.elements.buy.default.click.left",
        )
        assertEquals(
            listOf(
                "menus.shop.elements.buy.default.click.left.message",
                "menus.shop.elements.buy.default.click.left.message_1",
                "menus.shop.elements.buy.default.click.left.message_2",
            ),
            got,
        )
    }

    @Test fun `titles and subtitles count independently of messages`() {
        val got = addresses(
            """
            send_message "m"
            show_title "t" "s"
            show_title "t2" "s2"
            """.trimIndent(),
            "commands.give",
        )
        assertEquals(
            listOf(
                "commands.give.message",
                "commands.give.show_title", "commands.give.show_subtitle",
                "commands.give.show_title_1", "commands.give.show_subtitle_1",
            ),
            got,
        )
    }

    @Test fun `counters run across branches in document order, cases before else`() {
        val got = addresses(
            """
            if has_permission(vip):
              send_message "in-case"
            else:
              send_message "in-else"
            send_message "after"
            """.trimIndent(),
            "p",
        )
        assertEquals(listOf("p.message", "p.message_1", "p.message_2"), got)
    }

    @Test fun `a subtitle-less show_title consumes no subtitle counter`() {
        val got = addresses(
            """
            show_title "one"
            show_title "two" "sub"
            """.trimIndent(),
            "p",
        )
        assertEquals(
            listOf("p.show_title", null, "p.show_title_1", "p.show_subtitle"),
            got,
        )
    }
}
