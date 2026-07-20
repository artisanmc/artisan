# Unique Data-source Row Keys

## Goal

Ensure every Project table row receives a usable, unique Row key as soon as it is created, and reject manual Row-key collisions. Canonical translation keys must therefore use the authored Row key instead of a positional fallback during normal editing.

## Row creation

`addSourceRow` derives the Row-key field and its declared type from the table's Data model before inserting the row.

- For a `number` or `integer` Row key, it assigns the first free positive integer: `1`, `2`, `3`, and so on. Gaps are reused.
- For a string-like Row key, it assigns the first free `row_n` value: `row_1`, `row_2`, `row_3`, and so on. Gaps are reused.
- The generated value is written before localized-text sites are minted, so their first canonical key already contains the generated Row key.

Boolean, localized-text, list, object, model, and item fields are not valid Row-key types. The existing model editor restrictions remain the source of truth for selectable Row-key fields.

## Manual editing and uniqueness

The store owns the uniqueness invariant. When `setSourceValue` targets the active Row-key field of a table row, it validates the proposed value before mutating the row.

- Empty string Row keys are rejected.
- String Row keys are compared after `trim().toLowerCase()`, so `VIP`, ` vip `, and `vip` collide.
- Numeric Row keys are compared numerically.
- The current row is excluded from the collision check.
- Invalid updates leave the previous stored value and all translations unchanged.
- Valid string Row keys are stored as their trimmed lowercase form, matching the lowercase canonical i18n path.

`setSourceValue` returns a structured result that distinguishes success, an empty Row key, and a duplicate Row key. Non-Row-key edits retain their current behavior and report success.

## Editor behavior

The Row-key cell uses a local draft instead of writing every keystroke directly to the store. It commits on blur or Enter.

- A successful commit clears any previous error and displays the canonical stored value.
- An empty or duplicate commit displays an inline localized error in that cell and restores the stored value.
- Other cells remain editable.
- Generated IDs appear immediately when a row is added.

## Existing invalid data

Existing duplicate Row keys are not silently renamed during project loading because doing so would change externally referenced row identities. They continue to use the defensive positional i18n fallback until an administrator gives each row a unique Row key. Editing one of those Row-key cells applies the same validation rules and cannot introduce another collision.

## Translation behavior

For valid rows, localized fields use `sources.<source-name>.<row-key>.<field-path>`, entirely lowercase. A valid Row-key rename rekeys the localized sites and moves every language value to the new canonical key. A rejected rename performs no rekey.

The positional `row_n` fallback remains only as defensive support for legacy/imported invalid data; rows created through the editor no longer depend on it.

## Tests

- Store tests cover generated string and numeric keys, reuse of gaps, and uniqueness across multiple additions.
- Store tests cover empty and duplicate manual updates, including case-insensitive string collisions, and assert the previous value is preserved.
- i18n/store tests assert generated and valid renamed Row keys become the canonical path while all translations survive a valid rename.
- UI tests assert an invalid Row-key edit shows the localized inline error and restores the stored value.
- The full editor test suite and production build remain green.

