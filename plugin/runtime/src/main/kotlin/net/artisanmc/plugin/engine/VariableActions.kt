package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.variable.VariableType

/**
 * `set_var`, `add_var`, `clear_var` (ADR `triggers-and-variables` §5): the only writes of a Project
 * variable. A name that is not a Variable of the chain's project, a module Variable (read-only), or
 * a value that does not read as the Variable's type is skipped with a warning: never a silent write
 * of something else.
 */
internal object VariableActions {

    fun setVar(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val (variables, variable) = target("set_var", ctx, args, rt) ?: return ctx
        val raw = args["value"]
        val value = valueOf(variable, raw, ctx, rt)
        if (value == null) {
            rt.warn("set_var: '$raw' is not a ${variable.type.wire()} for Variable ${variable.ref} — skipped")
            return ctx
        }
        variables.set(variable, ctx.player, value)
        return ctx
    }

    fun addVar(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val (variables, variable) = target("add_var", ctx, args, rt) ?: return ctx
        if (variable.type != VariableType.NUMBER) {
            rt.warn("add_var: Variable ${variable.ref} is a ${variable.type.wire()}, not a number — skipped")
            return ctx
        }
        variables.add(variable, ctx.player, Args.double(args, "amount", 1.0))
        return ctx
    }

    fun clearVar(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val (variables, variable) = target("clear_var", ctx, args, rt) ?: return ctx
        variables.clear(variable, ctx.player)
        return ctx
    }

    /** The Variable `var` names in the chain's project, or null after a warning. */
    private fun target(action: String, ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): Pair<ProjectVariables, ProjectVariable>? {
        val name = Args.str(args, "var")?.trim().orEmpty()
        val variables = ModuleVariableValues.projects
        if (variables == null) {
            rt.warn("$action: Variables are not available on this server — skipped")
            return null
        }
        val variable = variables.find(ctx.projectId, name)
        if (variable == null) {
            val why = when {
                name.isEmpty() -> "no `var`"
                '.' in name -> "'$name' is a module Variable: read-only, its module writes it through its own actions"
                else -> "no Variable '$name' in project ${ctx.projectId ?: "(none)"}"
            }
            rt.warn("$action: $why — skipped")
            return null
        }
        return variables to variable
    }

    /** [raw] as [variable]'s type: a lone `{expr}` keeps its type, any other template is rendered (§6). */
    private fun valueOf(variable: ProjectVariable, raw: Any?, ctx: ExecutionContext, rt: EngineRuntime): Any? {
        raw ?: return null
        val resolver = rt.executor.argResolver(ctx)
        val resolved = when (variable.type) {
            VariableType.STRING -> when (raw) {
                is String -> ArgCoercion.LONE_EXPR.matchEntire(raw.trim())
                    ?.let { resolver.value(it.groupValues[1].trim())?.toString() }
                    ?: resolver.text(raw)
                else -> raw
            }
            else -> ArgCoercion.convert(variable.type.wire(), raw, resolver)
        }
        return variable.accept(resolved)
    }
}
