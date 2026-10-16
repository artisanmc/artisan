package net.artisanmc.modules.api.datasource;

import java.util.Objects;
import net.artisanmc.modules.api.annotations.Stable;
import net.artisanmc.modules.api.annotations.Sunset;
import net.artisanmc.modules.api.model.ModelFieldType;

/**
 * Row-field kinds a data source could declare in its {@link DataSourceDeclaration#getSchema()}
 * before 2.0.0. Since 2.0.0 a {@link DataSourceField} takes a {@link ModelFieldType}, the one
 * field-type vocabulary of the API (Data models, Action arguments, data source rows).
 *
 * <p>Mapping ({@link #toModelFieldType()}): {@code STRING} → {@link ModelFieldType#string()},
 * {@code NUMBER} → {@link ModelFieldType#number()}, {@code INTEGER} → {@link ModelFieldType#integer()},
 * {@code BOOLEAN} → {@link ModelFieldType#bool()}, {@code LIST} → {@code list(string())} (1.x said
 * nothing of the elements), {@code OBJECT} → {@code object([])} (nor of the fields),
 * {@code ITEM} → {@link ModelFieldType#item()}. The {@code data_sources} wire spells the same
 * kind either way ({@code string}, {@code list}, …).
 *
 * <p>Declared in Java, not Kotlin: a Kotlin enum exposes {@code getEntries()},
 * which returns {@code kotlin.enums.EnumEntries}. The shadowJar relocates that type
 * but the published API JAR does not, so a Kotlin add-on writing
 * {@code FieldKind.entries} would compile and then break at runtime.
 * See ApiSurfaceIsJavaFriendlyTest.
 */
@Stable
@Sunset(
    reason = "One field-type vocabulary: ModelFieldType (data source rows, Data models, Action arguments)",
    removeInVersion = "3.0.0",
    replacement = "ModelFieldType, through new DataSourceField(name, ModelFieldType)"
)
public enum FieldKind {
    STRING, NUMBER, INTEGER, BOOLEAN, LIST, OBJECT, ITEM;

    /** The {@link ModelFieldType} this kind stands for (see the class comment for the mapping). */
    public ModelFieldType toModelFieldType() {
        return switch (this) {
            case STRING -> ModelFieldType.string();
            case NUMBER -> ModelFieldType.number();
            case INTEGER -> ModelFieldType.integer();
            case BOOLEAN -> ModelFieldType.bool();
            case LIST -> ModelFieldType.list(ModelFieldType.string());
            case OBJECT -> ModelFieldType.object(java.util.List.of());
            case ITEM -> ModelFieldType.item();
        };
    }

    /**
     * The closest kind of {@code type}, for a reader still on {@link DataSourceField#getType()}:
     * text-like kinds ({@code ltext}, {@code minimessage*}, {@code enum}, {@code document_ref})
     * read as {@code STRING}, {@code actions} and {@code conditions} as {@code LIST},
     * {@code map}, {@code model} and {@code union} as {@code OBJECT}.
     */
    public static FieldKind closestTo(ModelFieldType type) {
        Objects.requireNonNull(type, "type");
        return switch (type.getKind()) {
            case "number" -> NUMBER;
            case "integer" -> INTEGER;
            case "boolean" -> BOOLEAN;
            case "item" -> ITEM;
            case "list", "actions", "conditions" -> LIST;
            case "object", "map", "model", "union" -> OBJECT;
            default -> STRING;
        };
    }
}
