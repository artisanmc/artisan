import { expect, it } from "vitest";
import {
  childFolders,
  listFolders,
  newFolderError,
  normalizeFolderMeta,
  persistedFolderMeta,
  slugifyFolderName,
} from "./folders";
import type { Project } from "./types";

function project(folders?: Project["folders"]): Pick<Project, "documents" | "folders"> {
  return {
    documents: {
      menus: [{ id: "a", folder: "boutique/armes" }, { id: "b" }],
      commands: [{ id: "c", folder: "quetes" }],
    },
    folders,
  } as unknown as Pick<Project, "documents" | "folders">;
}

it("lists folders from filed Documents and remembered empty ones, ancestors included", () => {
  const p = project({ vide: {} });
  expect(listFolders(p)).toEqual(["boutique", "boutique/armes", "quetes", "vide"]);
  expect(childFolders(p, "")).toEqual(["boutique", "quetes", "vide"]);
  expect(childFolders(p, "boutique")).toEqual(["boutique/armes"]);
});

it("slugifies a typed name into a folder name", () => {
  expect(slugifyFolderName("Équipement Spécial")).toBe("equipement-special");
  expect(slugifyFolderName("  _Quêtes.v2 ")).toBe("quetes-v2");
});

it("refuses a bad name, a kind or resource folder, a fourth level and an existing folder", () => {
  const p = project();
  expect(newFolderError(p, "", "Boutique")).toBe("invalid_name");
  expect(newFolderError(p, "", "menus")).toBe("invalid_name");
  expect(newFolderError(p, "", "lang")).toBe("invalid_name");
  expect(newFolderError(p, "boutique/armes", "epees")).toBe(null);
  expect(newFolderError(p, "boutique/armes/epees", "x")).toBe("too_deep");
  expect(newFolderError(p, "boutique", "armes")).toBe("exists");
  expect(newFolderError(p, "", "nouveau")).toBe(null);
});

it("reads folder metadata tolerantly and persists only what disk does not already say", () => {
  expect(
    normalizeFolderMeta({
      boutique: { color: "#a855f7", position: { x: 1, y: 2 } },
      quetes: { color: "red" },
      Bad: {},
      "a/b/c/d": {},
    }),
  ).toEqual({ boutique: { color: "#a855f7", position: { x: 1, y: 2 } }, quetes: {} });
  expect(normalizeFolderMeta(["x"])).toEqual({});
  expect(
    persistedFolderMeta(project({ quetes: {}, vide: {}, boutique: { color: "#000000" } })),
  ).toEqual({ boutique: { color: "#000000" }, vide: {} });
});
