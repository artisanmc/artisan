/**
 * Artisan — Pack schema v1 — TypeScript types
 *
 * Manifeste d'un pack Artisan. Vit à la racine d'une archive .itfz (zip)
 * qui contient le manifeste + les menus + templates + commandes + translations + assets référencés.
 *
 * Concepts :
 *   - Pack    = unité d'organisation dans le workspace + format d'export partageable.
 *   - Bundle  = artefact runtime signé (config + resource pack) consommé par le plugin.
 *               Concept différent, à ne pas confondre.
 */

export interface PackManifest {
  /** Verrouillé pour permettre les migrations. */
  schema: "pack/v1";
  /** Slug du pack. Lowercase + alphanum + tirets/underscores. */
  id: string;
  /** Nom affiché dans le dashboard et la marketplace. */
  name: string;
  /** Description courte pour la marketplace et l'import. */
  description?: string;
  /** Version semver (X.Y.Z). Bump à chaque export. */
  version: string;
  /** Nom d'auteur. En V3 marketplace, lié à un compte vérifié. */
  author?: string;
  /** Licence SPDX (MIT, CC-BY-NC-4.0, etc.). */
  license?: string;
  /** URL optionnelle de présentation. */
  homepage?: string;
  /** Tags pour catégorisation et recherche. */
  tags?: string[];
  /** Version minimum d'Artisan requise. */
  artisan_min_version?: string;
  /** Chemin relatif d'une image de preview dans l'archive. */
  preview_image?: string;
  /** Ids de menus inclus. Doivent avoir menus/<id>.json dans l'archive. */
  menus?: string[];
  /** Ids de templates inclus. Doivent avoir templates/<id>.json. */
  templates?: string[];
  /** Ids de commandes incluses. Doivent avoir commands/<id>.json conforme à command/v1. */
  commands?: string[];
  /** Traductions embarquées (sous-set du workspace). Calculé à l'export. */
  translations?: PackTranslationsMeta;
  /** Chemins d'assets inclus (relatifs à assets/). */
  assets?: string[];
  /** Plugins tiers requis (calculé à l'export). */
  requires_plugins?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface PackTranslationsMeta {
  /** Chemin relatif du fichier translations dans l'archive. Default: "translations.json". */
  file?: string;
  /** Nombre de clés embarquées (info pour les dialogs d'import). */
  key_count?: number;
  /** Langues couvertes par les traductions du pack. */
  languages?: string[];
}

/**
 * État d'un pack dans le workspace de l'admin (côté backend, hors manifeste).
 * Cet objet ne fait PAS partie du manifeste exporté — c'est le tracking côté Postgres.
 */
export interface WorkspacePack {
  /** Id local généré par le backend (UUID). */
  id: string;
  /** Id du compte propriétaire. */
  user_id: string;
  /** Id du pack tel qu'il apparaît dans le manifeste. */
  manifest_id: string;
  /** Nom affiché. */
  name: string;
  description?: string;
  /** Version courante (depuis le dernier import ou création/update). */
  version: string;
  /**
   * Source du pack.
   * - "user_created" : pack créé localement par l'admin.
   * - "imported"     : pack importé depuis un .itfz, peut être réimporté (overwrite).
   * - "forked"       : pack imported puis forké, devient user_created mais garde un pointer vers la source.
   */
  source: "user_created" | "imported" | "forked";
  /** Si imported ou forked, l'id source (ex. "creator-x/daily-quests"). */
  source_pack_id?: string;
  /** Si imported, version source à l'import — utile pour détecter les updates dispos. */
  source_version?: string;
  /** Pack par défaut auto-créé pour chaque nouvel admin (le "Personal"). */
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** Layout du contenu de l'archive .itfz. */
export const PACK_ARCHIVE_LAYOUT = {
  manifest: "manifest.json",
  menusDir: "menus/",
  templatesDir: "templates/",
  commandsDir: "commands/",
  translationsFile: "translations.json",
  assetsDir: "assets/",
  optionalReadme: "README.md",
  optionalPreview: "preview.png",
} as const;
