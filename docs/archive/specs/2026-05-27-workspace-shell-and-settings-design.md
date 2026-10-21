# Workspace Shell + Settings Page Design

> Spec brainstormée le 2026-05-27. Étend `docs/superpowers/specs/2026-05-26-ui-information-architecture-design.md` §3 — le Workspace passe de "canvas plein écran sans onglets" à "shell à onglets avec Overview par défaut + Translations + Data Sources built-in". Aligne le Workspace sur le Module hub (même structure).

**Goal** — Désencombrer le top bar du canvas (trop de boutons pour l'utilisateur), unifier Workspace et Module derrière le même shell à onglets, et créer une page Settings dédiée pour héberger les préférences UI (langue éditeur en V1, autres sections futures).

**Statut** — Spec validée le 2026-05-27. Implémentation V1 ci-dessous.

---

## 1. Décisions capturées

Réponses utilisateur au brainstorming :

1. **Pivot architectural** — Workspace devient un shell à onglets (comme le Module). **OK**.
2. **Storage langue éditeur** — localStorage + sync backend si logged-in (`B`).
3. **Settings** — page dédiée `/settings` à sections (`C`), pas un popover.
4. **Dropdown kebab top bar** — Import + Export + Delete pack (`B`).
5. **PatternsGallery** — déplacée dans le kebab (`B`).

---

## 2. Workspace shell

**Lexique** — "shell" désigne ici la structure interne de la route `/workspace/$workspaceId` (top bar + tab strip + content). C'est différent de la `WorkspaceSidebar` globale (montée dans `__root.tsx`, à gauche de l'`Outlet`) qui reste inchangée hors ajout du bouton Settings §4.1.

### 2.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│ [Pack name]  [Pack lang ▾]  [Undo Redo]  [Deploy]  [⋮]      │  ← top bar
├─────────────────────────────────────────────────────────────┤
│ [Overview *]  [Translations]  [Data Sources]                │  ← tabs full-page
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  (Onglet actif : canvas Konva, ou Translations, ou DS)      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Onglets built-in

| Onglet | Contenu | Source |
|---|---|---|
| **Overview** (default) | Le canvas Konva actuel (menus/commands/dialogs inline). Pas de changement de comportement. | Existant : `Stage` + `EditorPane` dans `SplitPane`. |
| **Translations** | La page Translations en plein écran. Remplace l'overlay déclenché aujourd'hui par le bouton `Languages` du top bar. | Adapter `TranslationPanel` pour s'afficher en page (pas modal). |
| **Data Sources** | Idem, plein écran. | Adapter `DataSourcesPanel`. |

### 2.3 Extension Modules (V1.5+, hors scope d'impl V1)

Le Module hub (déjà specifié dans le spec d'hier §4) garde la même structure. Les onglets built-in (Overview / Translations / Data Sources) sont communs Workspace + Module ; le Module ajoute ses tabs (Data, Categories…) déclarés par le plugin via son `FrontendModule.tabs[]`.

### 2.4 Navigation entre onglets

Param de query `?tab=overview|translations|data-sources` sur `/workspace/$workspaceId`. Default `overview`. Switching = `useNavigate({ search: { tab: "translations" } })`. Permet deeplink + back/forward propre.

---

## 3. Top bar simplifié

### 3.1 Composition après refactor

De gauche à droite :

1. **Pack name** (display)
2. **`LangSwitcher`** — sélecteur de langue du **contenu** du pack (controle ce que le canvas affiche en preview)
3. **`UndoRedoButtons`**
4. **`DeployButtons`**
5. **Kebab `⋮`** — dropdown

### 3.2 Contenu du kebab dropdown

```
┌─────────────────────────┐
│ Importer un pack        │
│ Exporter le pack        │
│ Patterns gallery        │
│ ─────────────────────── │
│ Supprimer ce workspace  │  ← rouge, en bas, séparé
└─────────────────────────┘
```

Le séparateur isole l'action destructive.

### 3.3 Éléments supprimés du top bar

- `EditorLangSwitcher` → déplacé vers `/settings` §4
- Bouton Translations (icon `Languages` + badge) → remplacé par l'onglet
- Bouton Data Sources (icon `Database`) → remplacé par l'onglet
- Bouton Patterns gallery (icon `BookOpen`) → dans le kebab
- Bouton Delete pack (rouge) → dans le kebab
- `PackIOButtons` (import + export) → dans le kebab

### 3.4 Badge "translations missing"

Le badge numérique sur le bouton Translations actuel (count des keys non traduites) — à porter sur l'onglet "Translations" lui-même quand `totalMissing(pack) > 0`.

---

## 4. Sidebar Settings + Page `/settings`

### 4.1 Bouton dans la sidebar

`WorkspaceSidebar` gagne un **bouton Settings en bas** (sticky bottom de la sidebar, sous la section Modules) :

```
┌─────────────────────────┐
│ [Network Dropdown ▾]    │
├─────────────────────────┤
│ MES WORKSPACES          │
│  • Menu principal       │
│  • Lobby                │
│  • + Nouveau workspace  │
│                         │
│ MODULES INSTALLÉS       │
│  Aucun module installé. │
├─────────────────────────┤
│ ⚙ Settings              │  ← sticky bottom
└─────────────────────────┘
```

Layout : la sidebar passe en `flex flex-col`, la zone scrollable du milieu prend `flex-1`, le bouton Settings est en bas.

### 4.2 Route `/settings`

Nouvelle route `editor/src/routes/settings.tsx`. Layout interne : sidebar de sections à gauche, contenu à droite.

```
┌───────────────────┬─────────────────────────────────┐
│ Apparence *       │  Apparence                      │
│ (futur : Compte)  │  ┌────────────────────────────┐ │
│                   │  │ Langue de l'éditeur :      │ │
│                   │  │ [EditorLangSwitcher]       │ │
│                   │  └────────────────────────────┘ │
└───────────────────┴─────────────────────────────────┘
```

V1 ship uniquement la section **Apparence**. Stubs pour Compte / Notifications restent pour les itérations futures.

---

## 5. Storage de la langue éditeur

### 5.1 Architecture

- **Source de vérité côté client** : `localStorage["i18nextLng"]` (clé déjà utilisée par react-i18next).
- **Si user logged-in** : aussi persistée côté backend sur `users.editor_language` (nouvelle colonne TEXT nullable).
- **Anonymous** : localStorage uniquement.

### 5.2 Sync flow

| Trigger | Action |
|---|---|
| **Au boot (hydrate)** | `getMe()` retourne le user avec `editor_language?`. Si présent et différent de `localStorage["i18nextLng"]` → écrase localStorage + `i18n.changeLanguage(serverValue)`. |
| **Au changement (user clique EditorLangSwitcher dans /settings)** | Update localStorage + `i18n.changeLanguage(newValue)` immédiat. Si logged-in : `PATCH /api/v1/auth/me { editor_language: newValue }` async (fire-and-forget, pas de blocking). |
| **Au login** | Idem boot — fetch `editor_language` du user, sync localStorage. |
| **Au logout** | Garde localStorage tel quel (l'user anonyme conserve sa préférence dans son browser). |

### 5.3 Backend changes

- **Schema** : nouvelle colonne `users.editor_language` (TEXT nullable, default NULL).
- **Migration Drizzle** : `backend/drizzle/000X_add_user_editor_language.sql`.
- **Endpoint** : `PATCH /api/v1/auth/me` body `{ editor_language?: string }` → update `users.editor_language` du user de la session cookie. Retourne `{ user: AuthUserDto }`.
- **Endpoint étendu** : `GET /api/v1/auth/me` retourne désormais `editor_language` dans le `user` DTO.

### 5.4 Edge cases

- **Backend down** au moment du changement : localStorage est update direct, le PATCH échoue silencieusement (log warn console). Au prochain reload, si l'user re-fetch via `getMe()`, le backend retourne la vieille valeur — mais localStorage a la nouvelle. Conflict ? On reste sur la STRATEGIE backend = source de vérité pour logged-in : si backend retourne une valeur, écrase localStorage. **Conséquence pratique** : si l'user change la langue offline (backend down), le changement est local seulement et sera écrasé au prochain getMe(). Acceptable comme limitation V1.
- **Anonymous → login transition** : si l'user anonyme a "fr" en localStorage et login sur un compte qui a "en" backend → écrase localStorage avec "en". Si on veut préserver le choix anonyme : ajouter un step "voulez-vous garder votre langue préférée ?" — pas critique V1, default = backend wins.

---

## 6. Scope V1

### 6.1 In scope

| Item | Détail |
|---|---|
| `WorkspaceShell` component | Onglets en haut. Default `?tab=overview`. Switching via URL param. |
| Tab routes / state | Param de query, pas de file-based subroutes (overkill). |
| Workspace tab : Overview | Le canvas existant (Stage + EditorPane). Pas de changement fonctionnel. |
| Workspace tab : Translations | Adapter `TranslationPanel` pour s'afficher en page (pas modal). |
| Workspace tab : Data Sources | Adapter `DataSourcesPanel`. |
| Top bar refactor | Suppression des items déplacés, ajout du kebab dropdown. |
| Kebab dropdown component | Import / Export / Patterns / ─── / Delete pack. |
| Badge translations missing | Sur l'onglet "Translations" (replace badge du bouton supprimé). |
| Sidebar Settings button | Sticky bottom, lien vers `/settings`. |
| `/settings` route + sidebar de sections | Layout split. Section Apparence visible. |
| Section Apparence | Contient `EditorLangSwitcher` adapté. |
| Backend `users.editor_language` | Migration + endpoint PATCH + GET étendu. |
| Sync flow login/change | Code dans `authStore.hydrate` + `EditorLangSwitcher` onChange. |

### 6.2 Out of scope (différé V1.5 ou plus tard)

- Rapatriement de `/account` dans `/settings` (page Compte sera ajoutée plus tard)
- Sections Settings autres qu'Apparence (Notifications, Workspaces defaults, etc.)
- Refonte du contenu de Patterns gallery (juste déplacée)
- Module-injected tabs (déjà spécifié dans le spec d'hier §4, pas affecté ici)
- Restructure interne du `TranslationPanel` au-delà du minimum pour qu'il s'affiche en page

---

## 7. Migration / breaking notes

- Le composant `TranslationPanel` aujourd'hui s'attend à être rendu dans un overlay/modal contrôlé par `translationsOpen` state. Nouveau usage : rendu inline sur la page d'onglet. Pas de breaking API mais ajustements de layout.
- Idem `DataSourcesPanel`.
- Le `EditorLangSwitcher` actuel est un button-component dans le top bar. Migré tel quel dans `/settings` (juste un déplacement de mount point), le composant lui-même est minimalement adapté pour appeler le sync backend en plus de `i18n.changeLanguage`.

---

## 8. Edge cases UI

- **Switching de tab avec changements unsaved** : autosave existe déjà (`usePackAutoSave` 2s debounce). En théorie pas d'unsaved. Edge à valider en QA.
- **Deeplink `/workspace/$id?tab=translations`** : page charge directement sur cet onglet. Browser back/forward fonctionne.
- **Tab Translations / Data Sources rendu sans pack chargé** : afficher un état "Pack en cours de chargement…" cohérent avec le canvas.
- **Pack supprimé pendant que l'utilisateur est sur un tab non-Overview** : navigate to `/` (même comportement qu'aujourd'hui sur le canvas).

---

## 9. Non-décisions reportées

À creuser quand le besoin émerge :
- **Pack content LangSwitcher position** : reste dans le top bar pour V1 (controle le canvas). Pourrait migrer en tête de l'onglet Translations en V2 si l'utilisateur ne l'utilise que là.
- **Settings sidebar de sections : tabs vs liste** : à arbitrer au moment d'ajouter la 2ᵉ section. V1 = liste verticale fixée à gauche, 1 section visible.
- **Mobile UX** : V1 = le top bar et les tabs scroll horizontalement si overflow. Pas de design mobile-spécifique. À itérer.
