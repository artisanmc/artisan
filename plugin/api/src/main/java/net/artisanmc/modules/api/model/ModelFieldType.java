package net.artisanmc.modules.api.model;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Stable;
import org.jetbrains.annotations.Nullable;

/**
 * The type of a declared field: the editor's field kit, as a Data model declares it
 * (ADR {@code composable-data-models}) and as an Action declares its arguments (ADR
 * {@code extensible-document-kinds}, one type system). Built through the static factories;
 * {@link #toWire()} is the {@code model/v1} {@code FieldType} shape the editor reads.
 *
 * <p>Leaves: {@code string}, {@code number}, {@code integer}, {@code boolean}, {@code ltext}
 * (localizable text), {@code minimessage}, {@code minimessage_multiline}, {@code item},
 * {@code actions} (an action chain), {@code conditions}. Composites: {@code list(of)},
 * {@code object(fields)}, {@code model(ref)}, {@code map(of)}, {@code enum(values)},
 * {@code union(tag, variants)}. {@code document_ref(kind)} is the reference to a Document of
 * a kind ({@code menu}, {@code dialog}, a module kind): the editor resolves it, renames it,
 * flags a dead ref and draws the edge.
 */
@Stable
public final class ModelFieldType {
    private final String kind;
    private final @Nullable ModelFieldType of;
    private final List<ModelField> fields;
    private final @Nullable String ref;
    private final List<String> values;
    private final @Nullable String tag;
    private final List<UnionVariant> variants;
    private final @Nullable String documentKind;

    private ModelFieldType(
        String kind,
        @Nullable ModelFieldType of,
        List<ModelField> fields,
        @Nullable String ref,
        List<String> values,
        @Nullable String tag,
        List<UnionVariant> variants,
        @Nullable String documentKind
    ) {
        this.kind = kind;
        this.of = of;
        this.fields = List.copyOf(fields);
        this.ref = ref;
        this.values = List.copyOf(values);
        this.tag = tag;
        this.variants = List.copyOf(variants);
        this.documentKind = documentKind;
    }

    private static ModelFieldType leaf(String kind) {
        return new ModelFieldType(kind, null, List.of(), null, List.of(), null, List.of(), null);
    }

    public static ModelFieldType string() {
        return leaf("string");
    }

    public static ModelFieldType number() {
        return leaf("number");
    }

    public static ModelFieldType integer() {
        return leaf("integer");
    }

    public static ModelFieldType bool() {
        return leaf("boolean");
    }

    /** A localizable text: a string in the default language, or a {@code {lang: text}} map. */
    public static ModelFieldType ltext() {
        return leaf("ltext");
    }

    public static ModelFieldType minimessage() {
        return leaf("minimessage");
    }

    public static ModelFieldType minimessageMultiline() {
        return leaf("minimessage_multiline");
    }

    /** A material id or a complete item value. */
    public static ModelFieldType item() {
        return leaf("item");
    }

    /** An action chain (the keyed structured wire). */
    public static ModelFieldType actions() {
        return leaf("actions");
    }

    /** The core condition vocabulary, evaluated by the menu engine. */
    public static ModelFieldType conditions() {
        return leaf("conditions");
    }

    public static ModelFieldType list(ModelFieldType of) {
        return new ModelFieldType("list", Objects.requireNonNull(of, "of"), List.of(), null, List.of(), null, List.of(), null);
    }

    public static ModelFieldType object(List<ModelField> fields) {
        return new ModelFieldType("object", null, Objects.requireNonNull(fields, "fields"), null, List.of(), null, List.of(), null);
    }

    /** A reference to another declared Data model, by id. */
    public static ModelFieldType model(String ref) {
        return new ModelFieldType("model", null, List.of(), Objects.requireNonNull(ref, "ref"), List.of(), null, List.of(), null);
    }

    /** A dictionary: string key to a value of {@code of}. */
    public static ModelFieldType map(ModelFieldType of) {
        return new ModelFieldType("map", Objects.requireNonNull(of, "of"), List.of(), null, List.of(), null, List.of(), null);
    }

    /** A closed value set; the stored value is one of {@code values}. */
    public static ModelFieldType enumOf(List<String> values) {
        return new ModelFieldType("enum", null, List.of(), null, Objects.requireNonNull(values, "values"), null, List.of(), null);
    }

    /** A discriminated union: the value carries {@code [tag]: <variant name>} plus that variant's fields. */
    public static ModelFieldType union(String tag, List<UnionVariant> variants) {
        return new ModelFieldType("union", null, List.of(), null, List.of(), Objects.requireNonNull(tag, "tag"),
            Objects.requireNonNull(variants, "variants"), null);
    }

    /** A reference to a Document of {@code kind} ({@code menu}, {@code dialog}, a module kind). */
    public static ModelFieldType documentRef(String kind) {
        return new ModelFieldType("document_ref", null, List.of(), null, List.of(), null, List.of(), Objects.requireNonNull(kind, "kind"));
    }

    /** The kind name as the editor spells it ({@code string}, {@code list}, {@code document_ref}...). */
    public String getKind() {
        return kind;
    }

    /** Element type of a {@code list} or {@code map}; null otherwise. */
    public @Nullable ModelFieldType getOf() {
        return of;
    }

    /** Fields of an {@code object}; empty otherwise. */
    public List<ModelField> getFields() {
        return fields;
    }

    /** Model id of a {@code model}; null otherwise. */
    public @Nullable String getRef() {
        return ref;
    }

    /** Values of an {@code enum}; empty otherwise. */
    public List<String> getValues() {
        return values;
    }

    /** Tag field of a {@code union}; null otherwise. */
    public @Nullable String getTag() {
        return tag;
    }

    /** Variants of a {@code union}; empty otherwise. */
    public List<UnionVariant> getVariants() {
        return variants;
    }

    /** Target kind of a {@code document_ref}; null otherwise. */
    public @Nullable String getDocumentKind() {
        return documentKind;
    }

    /** The editor's {@code ModelFieldType} shape: {@code {kind}} plus the composite's own key. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("kind", kind);
        if (of != null) out.put("of", of.toWire());
        if (!fields.isEmpty() || kind.equals("object")) {
            if (kind.equals("object")) out.put("fields", fields.stream().map(ModelField::toWire).toList());
        }
        if (ref != null) out.put("ref", ref);
        if (kind.equals("enum")) out.put("values", values);
        if (tag != null) out.put("tag", tag);
        if (kind.equals("union")) out.put("variants", variants.stream().map(UnionVariant::toWire).toList());
        if (documentKind != null) out.put("document", documentKind);
        return out;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof ModelFieldType other
            && kind.equals(other.kind) && Objects.equals(of, other.of) && fields.equals(other.fields)
            && Objects.equals(ref, other.ref) && values.equals(other.values) && Objects.equals(tag, other.tag)
            && variants.equals(other.variants) && Objects.equals(documentKind, other.documentKind);
    }

    @Override
    public int hashCode() {
        return Objects.hash(kind, of, fields, ref, values, tag, variants, documentKind);
    }

    @Override
    public String toString() {
        return "ModelFieldType(" + toWire() + ")";
    }
}
