package net.artisanmc.modules.api.action;

import java.util.Map;
import net.artisanmc.modules.api.annotations.Beta;

/**
 * Executes one declared action (ADR {@code extensible-document-kinds}, R1): the engine dispatches
 * every step of a chain by name to the handler of its {@link ActionDeclaration}, the core actions
 * ({@code open_menu}, {@code give_item}...) included. The handler never sees the wire: {@code args}
 * is the normalized map of its declared arguments (a scalar wire value is bound to the primary
 * argument, a bare name to an empty map). It runs on the player's thread.
 *
 * @see ActionDeclaration#normalize
 */
@Beta
@FunctionalInterface
public interface ActionHandler {
    /** Runs the action and returns the context the next action of the chain runs with (usually {@code ctx}). */
    ActionContext execute(ActionContext ctx, Map<String, Object> args, ActionRuntime runtime);
}
