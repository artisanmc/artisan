package net.artisanmc.modules.api.playercommand;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import net.artisanmc.modules.api.annotations.Stable;
import org.jetbrains.annotations.Nullable;

/**
 * A command typed by players whose behaviour belongs to a module and whose dressing (name,
 * aliases, permission, cooldown, conditions, texts) belongs to the admin. The {@link #getId() id}
 * never changes: an admin's override targets it.
 *
 * <pre>{@code
 * api.getPlayerCommands().register(PlayerCommandDeclaration.builder("attribution:open")
 *     .name("attribution")
 *     .aliases("source")
 *     .permission("artisanattribution.command")
 *     .description(Map.of("en", "How did you find the server?", "fr", "Comment as-tu connu le serveur ?"))
 *     .executor(ctx -> service.openOwn(ctx.getPlayer()))
 *     .child(PlayerCommandDeclaration.builder("attribution:stats")
 *         .permission("artisanattribution.stats")
 *         .executor(ctx -> service.stats(ctx.getSender()))
 *         .consoleAllowed(true)
 *         .build())
 *     .build());
 * }</pre>
 *
 * A child is reached as {@code /<root name> <child name>}; in this version only the root can be
 * renamed by the admin.
 *
 * <p>A command that only opens a menu declares it with {@link Builder#opensMenu(String)} instead of
 * an executor: Artisan opens it (the arguments bind to the menu's context inputs of the same name)
 * and the editor draws the link on the board.
 */
@Stable
public final class PlayerCommandDeclaration {
    private static final Pattern ID = Pattern.compile("[a-z0-9_]+:[a-z0-9_.-]+");
    private static final Pattern NAME = Pattern.compile("[a-z0-9_.-]+");

    private final String id;
    private final String name;
    private final List<String> aliases;
    private final @Nullable String permission;
    private final Map<String, String> description;
    private final List<CommandArgument> arguments;
    private final @Nullable PlayerCommandExecutor executor;
    private final @Nullable String opensMenu;
    private final boolean consoleAllowed;
    private final List<PlayerCommandDeclaration> children;

    private PlayerCommandDeclaration(Builder b) {
        this.id = b.id;
        this.name = b.name != null ? b.name : b.id.substring(b.id.indexOf(':') + 1);
        if (!NAME.matcher(name).matches()) throw new IllegalArgumentException("invalid command name '" + name + "'");
        this.aliases = List.copyOf(b.aliases);
        this.permission = b.permission;
        this.description = Map.copyOf(b.description);
        this.arguments = List.copyOf(b.arguments);
        this.executor = b.executor;
        this.opensMenu = b.opensMenu;
        this.consoleAllowed = b.consoleAllowed;
        this.children = List.copyOf(b.children);
        if (executor == null && opensMenu == null && children.isEmpty()) {
            throw new IllegalArgumentException("command '" + id + "' has neither an executor, a menu nor a child");
        }
        if (executor != null && opensMenu != null) {
            throw new IllegalArgumentException("command '" + id + "' has both an executor and a menu");
        }
        if (opensMenu != null && consoleAllowed) {
            throw new IllegalArgumentException("command '" + id + "' opens a menu: the console cannot run it");
        }
        boolean optionalSeen = false;
        for (int i = 0; i < arguments.size(); i++) {
            CommandArgument arg = arguments.get(i);
            if (arg.getType() == CommandArgument.Type.TEXT && i != arguments.size() - 1) {
                throw new IllegalArgumentException("command '" + id + "': the TEXT argument '" + arg.getName() + "' must be the last");
            }
            if (!arg.isRequired()) optionalSeen = true;
            else if (optionalSeen) {
                throw new IllegalArgumentException("command '" + id + "': required argument '" + arg.getName() + "' after an optional one");
            }
        }
        String namespace = namespace();
        List<String> childNames = new ArrayList<>();
        for (PlayerCommandDeclaration child : children) {
            if (!child.namespace().equals(namespace)) {
                throw new IllegalArgumentException("child '" + child.id + "' is not in the namespace '" + namespace + "'");
            }
            if (childNames.contains(child.name)) {
                throw new IllegalArgumentException("command '" + id + "' has two children named '" + child.name + "'");
            }
            childNames.add(child.name);
        }
    }

    /** Starts a declaration; {@code id} is {@code <module>:<name>}, lowercase. */
    public static Builder builder(String id) {
        return new Builder(id);
    }

    /** {@code <module>:<name>}: what an override targets, never changed by the admin. */
    public String getId() { return id; }

    /** The module part of the id, also the prefix of the always-reachable {@code /<namespace>:<name>}. */
    public String namespace() { return id.substring(0, id.indexOf(':')); }

    /** The default name typed by players. */
    public String getName() { return name; }

    public List<String> getAliases() { return aliases; }

    /** The default permission; null: everyone. */
    public @Nullable String getPermission() { return permission; }

    /** By language code; may be empty. */
    public Map<String, String> getDescription() { return description; }

    public List<CommandArgument> getArguments() { return arguments; }

    /** Null for a root that just groups children, or for a command that opens a menu. */
    public @Nullable PlayerCommandExecutor getExecutor() { return executor; }

    /**
     * The menu this command opens instead of running an executor, as the Action DSL names it
     * ({@code boutique_addon:shop_main}, or a bare id resolved server-wide); null otherwise.
     */
    @Stable
    public @Nullable String getOpensMenu() { return opensMenu; }

    /** Whether the console may run it; a player-only command refuses the console with a message. */
    public boolean isConsoleAllowed() { return consoleAllowed; }

    public List<PlayerCommandDeclaration> getChildren() { return children; }

    @Override
    public String toString() {
        return "PlayerCommandDeclaration(" + id + ")";
    }

    @Stable
    public static final class Builder {
        private final String id;
        private @Nullable String name;
        private final List<String> aliases = new ArrayList<>();
        private @Nullable String permission;
        private final Map<String, String> description = new LinkedHashMap<>();
        private final List<CommandArgument> arguments = new ArrayList<>();
        private @Nullable PlayerCommandExecutor executor;
        private @Nullable String opensMenu;
        private boolean consoleAllowed;
        private final List<PlayerCommandDeclaration> children = new ArrayList<>();

        private Builder(String id) {
            Objects.requireNonNull(id, "id");
            if (!ID.matcher(id).matches()) throw new IllegalArgumentException("invalid command id '" + id + "': expected <module>:<name>, lowercase");
            this.id = id;
        }

        /** Defaults to the part of the id after the colon. */
        public Builder name(String name) { this.name = name.toLowerCase(java.util.Locale.ROOT); return this; }

        public Builder aliases(String... aliases) {
            for (String alias : aliases) this.aliases.add(alias.toLowerCase(java.util.Locale.ROOT));
            return this;
        }

        public Builder permission(@Nullable String permission) { this.permission = permission; return this; }

        public Builder description(Map<String, String> byLanguage) { description.putAll(byLanguage); return this; }

        public Builder arguments(List<CommandArgument> arguments) { this.arguments.addAll(arguments); return this; }

        public Builder argument(CommandArgument argument) { arguments.add(argument); return this; }

        public Builder executor(PlayerCommandExecutor executor) { this.executor = Objects.requireNonNull(executor); return this; }

        /**
         * Opens {@code menuRef} instead of running an executor: a player-only command whose
         * arguments become the menu's context. Qualify the ref with the module's folder
         * ({@code boutique_addon:shop_main}) so that another folder's menu of the same id is not taken.
         */
        @Stable
        public Builder opensMenu(String menuRef) {
            if (menuRef.isBlank()) throw new IllegalArgumentException("menu ref is blank");
            this.opensMenu = menuRef.trim();
            return this;
        }

        public Builder consoleAllowed(boolean allowed) { this.consoleAllowed = allowed; return this; }

        public Builder child(PlayerCommandDeclaration child) { children.add(Objects.requireNonNull(child)); return this; }

        public PlayerCommandDeclaration build() { return new PlayerCommandDeclaration(this); }
    }
}
