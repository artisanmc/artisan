package net.artisanmc.modules.api.action;

import net.artisanmc.modules.api.annotations.Stable;

/** Two declarations for the same action name. A module's actions are namespaced ({@code quests:start}). */
@Stable
public final class DuplicateActionException extends IllegalStateException {
    public DuplicateActionException(String name) {
        super("action '" + name + "' is already registered");
    }
}
