/**
 * A component is a named look, linked (ADR `element-parts-and-sliced-images`, decision 6): a
 * file `components/<name>.yml` holding the parameters it takes and a list of parts. A look that
 * writes `component` is read as the parts of that file, its parameters put in. This is the one
 * place that reading is written for the editor and its pack builder; `Components.kt` (pack) and
 * `MenuComponents.kt` (runtime) are its twins, held together by `testdata/component-expansion.json`.
 */

type Json = Record<string, unknown>;
const isMap = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** A component found for a look: its file, and the module whose images its bare names are (`""`: none). */
export interface FoundComponent {
  file: unknown;
  owner: string;
}

/** The name a look's `component` gives: `component: confirm` or `component: { name: confirm, … }`. */
export function componentName(look: unknown): string | null {
  const c = isMap(look) ? look.component : undefined;
  if (typeof c === "string") return c || null;
  if (isMap(c) && typeof c.name === "string") return c.name || null;
  return null;
}

/** A parameter's value for this look: what the look gives, else the component's default. */
function valueOf(name: string, params: Json, args: Json): unknown {
  if (name !== "name" && args[name] !== undefined && args[name] !== null) return args[name];
  const p = params[name];
  return isMap(p) ? p.default : undefined;
}

const PARAM = /\{([a-z][a-z0-9_]*)\}/g;

/** `text` with each `{param}` of the component replaced; another `{…}` stays for the player's expressions. */
function fill(
  text: string,
  params: Json,
  values: (name: string) => unknown,
  lang?: string,
): string {
  return text.replace(PARAM, (whole, name: string) => {
    if (!(name in params)) return whole;
    const v = values(name);
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (isMap(v)) {
      const own = lang !== undefined ? v[lang] : undefined;
      const first = Object.values(v).find((x) => typeof x === "string");
      return typeof own === "string" ? own : typeof first === "string" ? first : "";
    }
    return "";
  });
}

/** The languages the text parameters a string uses are written in, in first-seen order. */
function languages(text: string, params: Json, values: (name: string) => unknown): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(PARAM)) {
    const v = match[1]! in params ? values(match[1]!) : undefined;
    if (isMap(v)) for (const lang of Object.keys(v)) if (!out.includes(lang)) out.push(lang);
  }
  return out;
}

/**
 * The parts a component means for a look that gives it `args` (the look's `component` map; a
 * bare name gives none). An image's name is a literal or exactly one parameter: a bare name
 * written in the component's file is its owner's image (`<owner>:<name>`), a name the look
 * gives is read in the look's module. A part whose image has no value is left out.
 */
export function componentParts(found: FoundComponent, args: unknown): unknown[] {
  const file = isMap(found.file) ? found.file : {};
  const params = isMap(file.params) ? file.params : {};
  const given = isMap(args) ? args : {};
  const values = (name: string) => valueOf(name, params, given);
  const owned = (name: string) =>
    found.owner && !name.includes(":") ? `${found.owner}:${name}` : name;
  const out: unknown[] = [];
  for (const part of Array.isArray(file.parts) ? file.parts : []) {
    if (!isMap(part)) continue;
    if (typeof part.image === "string") {
      const ref = /^\{([a-z][a-z0-9_]*)\}$/.exec(part.image);
      if (!ref || !(ref[1]! in params)) {
        out.push({ ...part, image: owned(part.image) });
        continue;
      }
      const name = ref[1]!;
      const mine = name !== "name" && given[name] !== undefined && given[name] !== null;
      const value = values(name);
      if (typeof value !== "string" || !value) continue;
      out.push({ ...part, image: mine ? value : owned(value) });
      continue;
    }
    const label = part.label;
    if (typeof label === "string") {
      const langs = languages(label, params, values);
      out.push({
        ...part,
        label: langs.length
          ? Object.fromEntries(langs.map((lang) => [lang, fill(label, params, values, lang)]))
          : fill(label, params, values),
      });
    } else if (isMap(label)) {
      out.push({
        ...part,
        label: Object.fromEntries(
          Object.entries(label).map(([lang, text]) => [
            lang,
            typeof text === "string" ? fill(text, params, values, lang) : text,
          ]),
        ),
      });
    } else out.push(part);
  }
  return out;
}

/**
 * A look as it is drawn: one that names a component gets its parts (and loses `component`,
 * `image`, `label` and its own `parts`); a name `find` does not answer leaves the look as
 * written, so it draws nothing. Another look is returned as is.
 */
export function expandLook(look: unknown, find: (name: string) => FoundComponent | null): unknown {
  const name = componentName(look);
  if (!name || !isMap(look)) return look;
  const found = find(name);
  if (!found) return look;
  const { component, image: _image, label: _label, parts: _parts, ...rest } = look;
  return { ...rest, parts: componentParts(found, component) };
}

/** A menu with every look of its elements expanded (`expandLook`); the same object when none names a component. */
export function expandMenuComponents(
  menu: unknown,
  find: (name: string) => FoundComponent | null,
): unknown {
  if (!isMap(menu)) return menu;
  let changed = false;
  const element = (el: unknown): unknown => {
    if (!isMap(el)) return el;
    let next = expandLook(el, find) as Json;
    if (Array.isArray(next.states)) {
      const states = next.states.map((state) => expandLook(state, find));
      if (states.some((state, i) => state !== (next.states as unknown[])[i]))
        next = { ...next, states };
    }
    if (next !== el) changed = true;
    return next;
  };
  const elements = Array.isArray(menu.elements) ? menu.elements.map(element) : menu.elements;
  const layers = Array.isArray(menu.layers)
    ? menu.layers.map((layer) =>
        isMap(layer) && Array.isArray(layer.elements)
          ? { ...layer, elements: layer.elements.map(element) }
          : layer,
      )
    : menu.layers;
  if (!changed) return menu;
  return {
    ...menu,
    ...(menu.elements !== undefined ? { elements } : {}),
    ...(menu.layers !== undefined ? { layers } : {}),
  };
}

/**
 * Which component a name written in a module's menu is: `<module>:<name>` that module's,
 * `artisan:<name>` the common one, a bare name the menu's module's then the common one.
 * `component(module, name)` gives a module's file (`""`: the common ones), or undefined.
 */
export function findComponent(
  module: string,
  name: string,
  component: (module: string, name: string) => unknown,
  common = "artisan",
): FoundComponent | null {
  const colon = name.indexOf(":");
  const scopes = colon >= 0 ? [name.slice(0, colon)] : [module, common];
  const bare = colon >= 0 ? name.slice(colon + 1) : name;
  for (const scope of scopes) {
    if (!scope) continue;
    const file = component(scope === common ? "" : scope, bare);
    if (file !== undefined && file !== null) return { file, owner: scope };
  }
  return null;
}
