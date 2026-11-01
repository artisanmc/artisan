package net.artisanmc.plugin.actiondsl

/**
 * Action DSL parser. Language-symmetric port of
 * `editor/src/lib/actionDsl/parser.ts`. `parseActionDsl(source)` → the pure
 * `DslStep` list. Indentation drives block structure; each line is an action
 * verb or an `if`/`else if`/`else` header. Conditions parse to the typed
 * {@link DslCondition} vocabulary, with free comparisons falling back to
 * `Expression` and `%ph% ==/matches` to `PlaceholderEquals`/`PlaceholderMatch`.
 */

class DslParseError(message: String, val line: Int, val col: Int? = null) :
    RuntimeException(if (col != null) "$message (line $line, col $col)" else "$message (line $line)")

private val PREDICATES = setOf(
    "has_permission",
    "has_money",
    "has_item",
    "has_xp",
    "has_level",
    "world_is",
    "time_is",
    "random_chance",
    "cooldown_passed",
    "player_in_region",
    "has_var",
    "pagination_at_first",
    "pagination_at_last",
)

fun parseActionDsl(source: String): List<DslStep> {
    val lines = lex(source)
    if (lines.isEmpty()) return emptyList()
    return BlockParser(lines).parseBlock(lines[0].indent)
}

private class BlockParser(private val lines: List<LogicalLine>) {
    private var pos = 0

    private fun peek(): LogicalLine? = lines.getOrNull(pos)

    fun parseBlock(indent: Int): List<DslStep> {
        val steps = mutableListOf<DslStep>()
        while (pos < lines.size) {
            val line = lines[pos]
            if (line.indent < indent) break
            if (line.indent > indent) throw DslParseError("Unexpected indentation", line.line)
            val head = line.tokens[0]
            if (head.type == TokenType.WORD && head.value == "if") {
                steps.add(parseIf(indent))
            } else if (head.type == TokenType.WORD && (head.value == "else" || head.value == "elif")) {
                break // handled by the enclosing parseIf
            } else {
                pos++
                steps.add(DslStep.ActionStep(parseActionLine(line)))
            }
        }
        return steps
    }

    private fun parseIf(indent: Int): DslStep {
        val cases = mutableListOf<DslIfCase>()
        var elseSteps: List<DslStep>? = null

        val first = lines[pos]
        pos++
        cases.add(readCase(first, 1, indent))

        while (pos < lines.size) {
            val line = lines[pos]
            if (line.indent != indent) break
            val t0 = line.tokens[0]
            val isElse = t0.type == TokenType.WORD && t0.value == "else"
            if (!isElse) break
            val t1 = line.tokens.getOrNull(1)
            if (t1 != null && t1.type == TokenType.WORD && t1.value == "if") {
                pos++
                cases.add(readCase(line, 2, indent))
            } else {
                pos++
                elseSteps = parseBlock(childIndent(indent, line))
                break
            }
        }

        return DslStep.IfStep(cases, elseSteps)
    }

    /** Read one if/else-if arm: condition tokens (after `condStart`) + child block. */
    private fun readCase(header: LogicalLine, condStart: Int, indent: Int): DslIfCase {
        val toks = header.tokens
        if (toks[toks.size - 1].type != TokenType.COLON) {
            throw DslParseError("Expected ':' to open an if block", header.line)
        }
        val condToks = toks.subList(condStart, toks.size - 1)
        if (condToks.isEmpty()) throw DslParseError("Empty condition", header.line)
        val (conditions, joins) = CondParser(condToks, header.line).parseFlat()
        val steps = parseBlock(childIndent(indent, header))
        return DslIfCase(conditions, joins, steps)
    }

    private fun childIndent(parentIndent: Int, header: LogicalLine): Int {
        val next = peek()
        if (next == null || next.indent <= parentIndent) {
            throw DslParseError("Expected an indented block", header.line)
        }
        return next.indent
    }
}

private fun parseActionLine(line: LogicalLine): DslAction {
    val c = LineCursor(line.tokens, line.line)
    val verb = c.word()
    val a = parseVerb(verb, c)
    c.end()
    return a
}

private fun parseVerb(verb: String, c: LineCursor): DslAction = when (verb) {
    "broadcast" -> DslAction.Broadcast(c.text())
    "send_message" -> DslAction.SendMessage(c.text())
    "give_item" -> DslAction.GiveItem(c.word(), c.int())
    "take_item" -> DslAction.TakeItem(c.word(), c.int())
    "give_money" -> DslAction.GiveMoney(c.num())
    "take_money" -> DslAction.TakeMoney(c.num())
    "give_xp" -> DslAction.GiveXp(c.int())
    "give_level" -> DslAction.GiveLevel(c.int())
    "run_command" -> {
        val command = c.rawString()
        c.keyword("as")
        val asConsole = c.oneOf("player", "console")
        DslAction.RunCommand(command, asConsole)
    }
    "play_sound" -> {
        val sound = c.word()
        val kw = c.keywords(listOf("vol", "pitch"))
        DslAction.PlaySound(sound, kw["vol"], kw["pitch"])
    }
    "teleport" -> {
        val world = c.word()
        val x = c.num()
        val y = c.num()
        val z = c.num()
        val kw = c.keywords(listOf("yaw", "pitch"))
        DslAction.Teleport(world, x, y, z, kw["yaw"], kw["pitch"])
    }
    "show_title" -> {
        val title = c.text()
        val subtitle = c.optText()
        val kw = c.keywords(listOf("fadeIn", "stay", "fadeOut"))
        DslAction.ShowTitle(title, subtitle, kw["fadeIn"], kw["stay"], kw["fadeOut"])
    }
    "open_menu" -> {
        val menuId = c.word()
        val tail = c.menuTail()
        DslAction.OpenMenu(menuId, tail.clearContext, tail.context)
    }
    "open_dialog" -> {
        val dialogId = c.word()
        val tail = c.menuTail()
        DslAction.OpenDialog(dialogId, tail.clearContext, tail.context)
    }
    "close_menu" -> DslAction.CloseMenu
    "close_dialog" -> DslAction.CloseDialog
    "open_previous_menu" -> DslAction.OpenPreviousMenu
    "paginate" -> {
        val direction = c.oneOf("next", "prev")
        val targetElementId = c.optWord()
        DslAction.Paginate(direction, targetElementId)
    }
    "run_actions" -> DslAction.RunActions(c.exprRest())
    "set" -> {
        val arg = c.word()
        c.op("=")
        DslAction.SetArg(arg, c.exprRest())
    }
    "cycle" -> {
        val direction = c.optOneOf("next", "prev") ?: "next"
        val arg = c.word()
        c.keyword("in")
        val list = c.exprRest()
        if (direction == "prev") DslAction.SetArgCyclePrev(arg, list)
        else DslAction.SetArgCycleNext(arg, list)
    }
    else -> throw DslParseError("Unknown action '$verb'", c.line, 1)
}

private class CondParser(private val toks: List<Token>, private val line: Int) {
    private var pos = 0

    private fun peek(): Token? = toks.getOrNull(pos)
    private fun next(): Token {
        val t = toks.getOrNull(pos) ?: throw DslParseError("Unexpected end of condition", line)
        pos++
        return t
    }
    private fun isWord(v: String): Boolean {
        val t = peek()
        return t != null && t.type == TokenType.WORD && t.value == v
    }
    private fun isOp(v: String): Boolean {
        val t = peek()
        return t != null && t.type == TokenType.OP && t.value == v
    }

    /** Top level of an `if`: flat conditions + joins (precedence applied at eval). */
    fun parseFlat(): Pair<List<DslCondition>, List<String>?> {
        val conditions = mutableListOf(parseAtom())
        val joins = mutableListOf<String>()
        while (isWord("and") || isWord("or")) {
            joins.add(next().value)
            conditions.add(parseAtom())
        }
        if (peek() != null) throw DslParseError("Unexpected token in condition", line)
        return Pair(conditions, if (joins.isNotEmpty()) joins else null)
    }

    /** Inside parentheses: precedence-aware, returns one (possibly composite) condition. */
    private fun parseGrouped(): DslCondition = parseOr()

    private fun parseOr(): DslCondition {
        val of = mutableListOf(parseAnd())
        while (isWord("or")) {
            next()
            of.add(parseAnd())
        }
        return if (of.size > 1) DslCondition.Or(of) else of[0]
    }

    private fun parseAnd(): DslCondition {
        val of = mutableListOf(parseAtom())
        while (isWord("and")) {
            next()
            of.add(parseAtom())
        }
        return if (of.size > 1) DslCondition.And(of) else of[0]
    }

    private fun parseAtom(): DslCondition {
        if (isWord("not")) {
            next()
            return DslCondition.Not(parseAtom())
        }
        if (isOp("(")) {
            next()
            val c = parseGrouped()
            if (!isOp(")")) throw DslParseError("Expected ')'", line)
            next()
            return c
        }
        val t = peek()
        if (t != null && t.type == TokenType.WORD && PREDICATES.contains(t.value)) {
            return parsePredicate()
        }
        return parseComparison()
    }

    private fun parsePredicate(): DslCondition {
        val name = next().value
        val args = mutableListOf<Token>()
        if (isOp("(")) {
            next()
            while (!isOp(")")) {
                args.add(next())
                if (isOp(",")) next()
            }
            next() // )
        }
        val argVals = args.filter { it.type != TokenType.OP }
        fun str(i: Int): String {
            val a = argVals.getOrNull(i)
                ?: throw DslParseError("$name missing argument ${i + 1}", line)
            return a.value
        }
        fun num(i: Int): Double = str(i).toDouble()
        return when (name) {
            "has_permission" -> DslCondition.HasPermission(str(0))
            "has_money" -> DslCondition.HasMoney(num(0))
            "has_item" -> DslCondition.HasItem(str(0), num(1))
            "has_xp" -> DslCondition.HasXp(num(0))
            "has_level" -> DslCondition.HasLevel(num(0))
            "world_is" -> DslCondition.WorldIs(str(0))
            "random_chance" -> DslCondition.RandomChance(num(0))
            "cooldown_passed" -> DslCondition.CooldownPassed(str(0))
            "player_in_region" -> DslCondition.PlayerInRegion(str(0))
            "has_var" -> DslCondition.HasVar(str(0))
            "time_is" -> {
                val v = str(0)
                if (v == "day" || v == "night") {
                    DslCondition.TimeIs(TimeRange.Named(v))
                } else {
                    // A tick window lexes as `num - num`; reassemble from the RAW
                    // arg tokens (`args`, which keeps the `-`) — `argVals` dropped it.
                    val raw = args.joinToString("") { it.value }
                    val mm = Regex("^(\\d+)-(\\d+)$").find(raw)
                        ?: throw DslParseError("time_is expects day|night|<from>-<to>", line)
                    DslCondition.TimeIs(
                        TimeRange.Ticks(mm.groupValues[1].toInt(), mm.groupValues[2].toInt()),
                    )
                }
            }
            "pagination_at_first" ->
                DslCondition.PaginationAtFirst(if (argVals.isNotEmpty()) str(0) else null)
            "pagination_at_last" ->
                DslCondition.PaginationAtLast(if (argVals.isNotEmpty()) str(0) else null)
            else -> throw DslParseError("Unknown predicate '$name'", line)
        }
    }

    /** A comparison / free expression atom, up to the next top-level and/or/) . */
    private fun parseComparison(): DslCondition {
        val run = mutableListOf<Token>()
        var depth = 0
        while (peek() != null) {
            val t = peek()!!
            if (depth == 0 && t.type == TokenType.WORD && (t.value == "and" || t.value == "or")) break
            if (depth == 0 && t.type == TokenType.OP && t.value == ")") break
            if (t.type == TokenType.OP && t.value == "(") depth++
            if (t.type == TokenType.OP && t.value == ")") depth--
            run.add(next())
        }
        if (run.isEmpty()) throw DslParseError("Expected a condition", line)
        // %ph% == "value"  →  placeholder_equals ; %ph% matches "re" → placeholder_match
        if (run.size == 3 && run[0].type == TokenType.PAPI && run[2].type == TokenType.STRING) {
            if (run[1].type == TokenType.OP && run[1].value == "==") {
                return DslCondition.PlaceholderEquals(run[0].value, run[2].value)
            }
            if (run[1].type == TokenType.WORD && run[1].value == "matches") {
                return DslCondition.PlaceholderMatch(run[0].value, run[2].value)
            }
        }
        return DslCondition.Expression(exprSource(run))
    }
}

private class MenuTail(val clearContext: Boolean, val context: Map<String, String>?)

private class LineCursor(private val toks: List<Token>, val line: Int) {
    private var pos = 0

    private fun peek(): Token? = toks.getOrNull(pos)
    private fun nextTok(what: String): Token {
        val t = toks.getOrNull(pos) ?: throw DslParseError("Expected $what", line)
        pos++
        return t
    }

    fun word(): String {
        val t = nextTok("an identifier")
        if (t.type != TokenType.WORD) {
            throw DslParseError("Expected an identifier, got '${t.value}'", line, t.col)
        }
        return t.value
    }

    fun optWord(): String? {
        val t = peek()
        if (t != null && t.type == TokenType.WORD) {
            pos++
            return t.value
        }
        return null
    }

    fun num(): Double {
        var sign = 1.0
        val p = peek()
        if (p != null && p.type == TokenType.OP && p.value == "-") {
            pos++
            sign = -1.0
        }
        val t = nextTok("a number")
        if (t.type != TokenType.NUMBER) {
            throw DslParseError("Expected a number, got '${t.value}'", line, t.col)
        }
        return sign * t.value.toDouble()
    }

    fun int(): Double = Math.round(num()).toDouble()

    fun rawString(): String {
        val t = nextTok("a quoted string")
        if (t.type != TokenType.STRING) throw DslParseError("Expected a quoted string", line, t.col)
        return t.value
    }

    fun text(): DslText {
        val t = nextTok("text or @key")
        return when (t.type) {
            TokenType.STRING -> DslText.Lit(t.value)
            TokenType.KEY -> DslText.Ref(t.value)
            else -> throw DslParseError("Expected \"text\" or @key, got '${t.value}'", line, t.col)
        }
    }

    fun optText(): DslText? {
        val t = peek()
        if (t != null && (t.type == TokenType.STRING || t.type == TokenType.KEY)) return text()
        return null
    }

    fun op(v: String) {
        val t = nextTok("'$v'")
        if (t.type != TokenType.OP || t.value != v) throw DslParseError("Expected '$v'", line, t.col)
    }

    fun keyword(v: String) {
        val t = nextTok("'$v'")
        if (t.type != TokenType.WORD || t.value != v) throw DslParseError("Expected '$v'", line, t.col)
    }

    fun oneOf(vararg vals: String): String {
        val t = nextTok(vals.joinToString("|"))
        if (t.type != TokenType.WORD || !vals.contains(t.value)) {
            throw DslParseError("Expected one of ${vals.joinToString(", ")}", line, t.col)
        }
        return t.value
    }

    fun optOneOf(vararg vals: String): String? {
        val t = peek()
        if (t != null && t.type == TokenType.WORD && vals.contains(t.value)) {
            pos++
            return t.value
        }
        return null
    }

    /** Trailing `key=value` pairs (numeric values). Order-independent. */
    fun keywords(spec: List<String>): Map<String, Double> {
        val out = mutableMapOf<String, Double>()
        while (peek()?.type == TokenType.WORD && toks.getOrNull(pos + 1)?.value == "=") {
            val key = word()
            op("=")
            if (!spec.contains(key)) throw DslParseError("Unknown option '$key'", line)
            out[key] = num()
        }
        return out
    }

    /** `[clear] [with k="v" ...]` tail shared by open_menu / open_dialog. */
    fun menuTail(): MenuTail {
        var clear = false
        var context: Map<String, String>? = null
        if (peek()?.type == TokenType.WORD && peek()!!.value == "clear") {
            pos++
            clear = true
        }
        if (peek()?.type == TokenType.WORD && peek()!!.value == "with") {
            pos++
            val ctx = mutableMapOf<String, String>()
            while (peek()?.type == TokenType.WORD) {
                val key = word()
                op("=")
                ctx[key] = rawString()
            }
            context = ctx
        }
        return MenuTail(clear, context)
    }

    /** The rest of the line as a canonical expression string (set / cycle). */
    fun exprRest(): String {
        val rest = toks.subList(pos, toks.size).toList()
        pos = toks.size
        if (rest.isEmpty()) throw DslParseError("Expected an expression", line)
        return exprSource(rest)
    }

    fun end() {
        val t = peek()
        if (t != null) throw DslParseError("Unexpected '${t.value}'", line, t.col)
    }
}
