package net.artisanmc.modules.api.schemas;

import net.artisanmc.modules.api.annotations.Stable;

/** Reads a document's version discriminator. See {@code SchemaRegistry.loadToCurrent}. */
@Stable
@FunctionalInterface
public interface SchemaVersionReader<T> {
    String versionOf(T document);
}
