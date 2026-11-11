import * as sdk from "@artisan/editor-sdk";
import * as react from "react";
import * as reactDom from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";

/**
 * What a module bundle imports from the editor instead of embedding it (ADR
 * `runtime-editor-modules`): one React and one SDK for the whole page, or hooks break
 * and a module registers into a registry the editor never reads. Anything else a
 * bundle needs, it carries. Adding an entry is an SDK minor; removing one, a major.
 */
export const SHARED_MODULES: Readonly<Record<string, object>> = {
  react,
  "react-dom": reactDom,
  "react/jsx-runtime": jsxRuntime,
  "@artisan/editor-sdk": sdk,
};
