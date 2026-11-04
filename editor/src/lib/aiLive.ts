/**
 * Reading a tool call's input while the model is still writing it (ADR `editor-assistant`): the
 * hub relays the raw JSON as it grows, so it is not valid JSON until the call ends. Only string
 * fields are read, each up to where it has been written.
 */

/** The string fields of [json], each as far as it goes; a field still open is cut at its last whole character. */
export function partialStringFields(json: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const key = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*"/g;
  let match: RegExpExecArray | null = key.exec(json);
  while (match) {
    let i = key.lastIndex;
    let raw = "";
    let closed = false;
    while (i < json.length) {
      const c = json[i]!;
      if (c === "\\") {
        // An escape cut in the middle waits for the next read.
        const piece = json.slice(i, json[i + 1] === "u" ? i + 6 : i + 2);
        if (piece.length < 2 || (piece[1] === "u" && piece.length < 6)) break;
        raw += piece;
        i += piece.length;
        continue;
      }
      if (c === '"') {
        closed = true;
        i += 1;
        break;
      }
      raw += c;
      i += 1;
    }
    try {
      fields[match[1]!] = JSON.parse(`"${raw}"`) as string;
    } catch {
      // A field the model wrote oddly is left out rather than shown wrong.
    }
    if (!closed) break;
    key.lastIndex = i;
    match = key.exec(json);
  }
  return fields;
}

/** A file being written: what `write_document`'s input says so far. */
export interface LiveWrite {
  id: string;
  project?: string;
  path?: string;
  content: string;
}

/** The `write_document` calls among [tools], read as far as written. */
export function liveWrites(
  tools: readonly { id: string; name: string; input: string }[] | undefined,
): LiveWrite[] {
  return (tools ?? [])
    .filter((tool) => tool.name === "write_document")
    .map((tool) => {
      const fields = partialStringFields(tool.input);
      return {
        id: tool.id,
        project: fields.project,
        path: fields.path,
        content: fields.content ?? "",
      };
    });
}
