import { describe, expect, it } from "vitest";
import {
  BundleError,
  checkBundleSdk,
  rewriteBundleImports,
  sharedShimSource,
  validateBundleModule,
} from "./runtimeBundle";

const at = (s: string) => `blob:${s}`;

describe("rewriteBundleImports", () => {
  it("points every shared import at the editor's instance, minified or not", async () => {
    const code = [
      'import{jsx as e}from"react/jsx-runtime";',
      'import * as R from "react";',
      "import { Button } from '@artisan/editor-sdk';",
      'export { useState } from "react";',
      "const meta = import.meta.url;",
      'const later = import("react-dom");',
      "export default { id: 'x' };",
    ].join("\n");
    const out = await rewriteBundleImports(code, at);
    expect(out).toContain('from"blob:react/jsx-runtime"');
    expect(out).toContain('from "blob:react"');
    expect(out).toContain("from 'blob:@artisan/editor-sdk'");
    expect(out).toContain('export { useState } from "blob:react"');
    expect(out).toContain('import("blob:react-dom")');
    expect(out).toContain("import.meta.url");
  });

  it("refuses a bundle split in chunks or importing a package the editor does not share", async () => {
    await expect(rewriteBundleImports('import "./chunk.js";', at)).rejects.toBeInstanceOf(
      BundleError,
    );
    await expect(rewriteBundleImports('import x from "lodash";', at)).rejects.toThrow(/lodash/);
    await expect(rewriteBundleImports("import(name);", at)).rejects.toThrow(/computed/);
  });
});

describe("sharedShimSource", () => {
  it("re-exports every named export of the editor's instance", () => {
    const src = sharedShimSource("react", { default: {}, useState: () => 0, "not-an-ident": 1 });
    expect(src).toContain('globalThis.__ARTISAN_EDITOR_SHARED__["react"]');
    expect(src).toContain("export default m.default ?? m;");
    expect(src).toContain('export const useState = m["useState"];');
    expect(src).not.toContain("not-an-ident =");
  });
});

describe("bundle checks", () => {
  const mod = { id: "msquests", displayName: "Quests", routes: [], sidebar: {} };

  it("accepts the module served under its own id", () => {
    expect(validateBundleModule(mod, "msquests")).toBe(mod);
  });

  it("refuses a module served under another id, or built against a newer SDK", () => {
    expect(() => validateBundleModule(mod, "other")).toThrow(/declares module "msquests"/);
    expect(() => validateBundleModule({ ...mod, sdk: "99.0" }, "msquests")).toThrow(BundleError);
    expect(() => checkBundleSdk("99.0")).toThrow(/older-editor/);
    expect(() => checkBundleSdk("nope")).toThrow(/invalid/);
  });
});
