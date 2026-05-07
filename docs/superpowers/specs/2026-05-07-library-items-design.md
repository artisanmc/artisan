# Library Items — Design Spec

**Date:** 2026-05-07
**Status:** Approved

---

## Objectif

Afficher dans l'éditeur tous les items pouvant être placés dans un inventaire Minecraft, avec leur texture correspondante, dans un panneau latéral drag-and-drop. Phase 1 : items vanilla uniquement. Phase 2 (future) : items custom (Oraxen, Nexo, ItemAdder).

---

## Flux de données

```
Plugin (Kotlin)
  └─ hello { server_key, mc_version: "1.21.4", current_bundle_hash }
        │
        ▼
Backend (Bun/Hono)
  ├─ Stocke mc_version dans la connexion WS du plugin
  ├─ GET /api/items          → liste items vanilla pour la version active
  └─ GET /api/textures/:ver/* → proxy lazy vers mcasset.cloud
        │
        ▼
Editor (React)
  ├─ Charge la liste items au premier affichage du panneau Library
  └─ LibraryPanel (onglet droit, visible si menu sélectionné)
       ├─ Search (filtre client) + filter chips (catégories)
       ├─ Grille items avec textures lazy-loaded
       └─ Drag depuis la grille → drop sur slot Konva
              └─ appearance.material mis à jour dans le store
```

---

## Plugin

### Changement : hello message

Le champ `mc_version` est **requis**. Le backend ferme la connexion si absent.

```kotlin
val mcVersion = Bukkit.getServer().minecraftVersion  // ex: "1.21.4"
mapOf(
    "type" to "hello",
    "server_key" to cfg.serverKey,
    "mc_version" to mcVersion,
    "current_bundle_hash" to syncMetadata.syncedHash,
)
```

Source : `Bukkit.getServer().minecraftVersion` retourne la version Minecraft (pas Bukkit/Paper).

---

## Backend

### Données statiques — registre items

Fichiers commités dans le repo : `backend/data/items/{version}.json`

Générés une fois via le script `backend/scripts/gen-items.ts` :
1. Fetch `https://raw.githubusercontent.com/misode/mcmeta/summary/registries/item/data.json`
2. Mapping automatique label (title-case de l'ID) + catégorie (par convention de nommage)
3. Écriture vers `backend/data/items/{version}.json`

Structure d'un item :
```json
{
  "id": "diamond_sword",
  "label": "Diamond Sword",
  "category": "combat",
  "texture": "item/diamond_sword"
}
```

Catégories : `combat` | `tools` | `armor` | `food` | `blocks` | `potions` | `misc`

### Connexion serveur — ajout mc_version

```typescript
interface ServerConnection {
  serverKey: string
  mcVersion: string   // requis, reçu dans hello
  // ... champs existants
}
```

Si `mc_version` absent dans `hello` : fermer la connexion WS avec code 4400.

### Nouveau endpoint : GET /api/items

```
GET /api/items
Authorization: Bearer <editor-session-token>

→ 200 { version: "1.21.4", items: Item[] }
→ 404 si registre absent pour cette version
→ 503 si plugin non connecté (mc_version inconnue)
```

Résolution : le backend cherche la `mc_version` depuis la connexion WS associée au `server_key` de la session éditeur, charge `data/items/{version}.json`.

### Nouveau endpoint : GET /api/textures/:version/*

```
GET /api/textures/1.21.4/item/diamond_sword

→ Proxy vers https://mcasset.cloud/1.21.4/assets/minecraft/textures/item/diamond_sword.png
→ Cache-Control: public, max-age=86400
→ 502 si mcasset.cloud injoignable
```

Pas de stockage disque. Le cache HTTP du process Bun suffit pour la durée de session.

---

## Editor

### Layout

Le panneau droit reçoit deux onglets :

```
[ Properties ]  [ Library ]
```

L'onglet **Library** n'est affiché que lorsqu'un menu est sélectionné (pas sur la vue pack, commande, ou aucune sélection).

### Composant LibraryPanel

```
LibraryPanel
  ├─ useItems()
  │    └─ GET /api/items, résultat mis en cache (React Query ou useState)
  ├─ useState: searchQuery, activeCategory
  ├─ items filtrés (client-side, sur label et id)
  ├─ <input> search
  ├─ <FilterChips> (All + catégories présentes dans les données)
  └─ <ItemGrid> (grille virtualisée si >200 items)
       └─ <LibraryItem>
            ├─ <img src="/api/textures/{version}/item/{texture}" loading="lazy">
            ├─ title={item.label}   (tooltip natif)
            └─ draggable + onDragStart → dataTransfer.setData("library/itemId", item.id)
```

### Drag & Drop DOM → Konva

**Côté Library (DOM) :**
```typescript
onDragStart={e => {
  e.dataTransfer.setData("library/itemId", item.id)
  e.dataTransfer.effectAllowed = "copy"
}}
```

**Côté canvas (wrapper du Stage Konva) :**
```typescript
onDragOver={e => e.preventDefault()}
onDrop={e => {
  const itemId = e.dataTransfer.getData("library/itemId")
  if (!itemId) return
  const slot = hitTestSlot(stageRef.current, e.clientX, e.clientY)
  if (slot != null) setSlotMaterial(slot, itemId)  // action Zustand
}}
```

`hitTestSlot(stage, clientX, clientY)` :
1. Convertit coordonnées écran → coordonnées stage (offset + scale)
2. Cherche le slot Konva à cette position via `stage.getIntersection(point)`
3. Retourne l'index de slot ou `null`

`setSlotMaterial` met à jour `appearance.material` du slot ciblé dans le store Zustand (nouvelle action à ajouter).

### Gestion des erreurs côté éditeur

| Cas | Comportement |
|---|---|
| `/api/items` échoue | Onglet Library désactivé + message "Library unavailable" |
| Texture 502/404 | Placeholder gris (CSS `bg-zinc-700`), édition non bloquée |
| Plugin déconnecté | Même comportement que `/api/items` échoue |

---

## Gestion des erreurs backend

| Cas | Réponse |
|---|---|
| `mc_version` absent dans `hello` | Fermer WS 4400 |
| Registre items absent pour la version | 404 avec `{ error: "unknown_version" }` |
| Plugin non connecté à la session | 503 avec `{ error: "server_offline" }` |
| mcasset.cloud injoignable | 502 avec `{ error: "upstream_unavailable" }` |

---

## Tests

| Scope | Ce qui est testé |
|---|---|
| Backend unit | `gen-items.ts` produit le bon format ; `/api/items` retourne le registre correct ; `/api/textures` proxie et applique le bon header |
| Backend intégration | hello sans `mc_version` → connexion fermée ; hello valide → `/api/items` retourne version correcte |
| Editor unit (Vitest) | `LibraryPanel` filtre correctement par search/catégorie ; `hitTestSlot` retourne le bon slot |
| Manuel | Drag depuis Library → slot Konva reçoit le bon material |

---

## Phase 2 — Items custom (Oraxen, Nexo, ItemAdder)

Architecture extensible sans refonte :

```
GET /api/items
  → vanilla items (registre statique)     ← phase 1
  → + items du plugin (Oraxen/Nexo/etc.)  ← phase 2

GET /api/textures/:source/:version/:path
  → source=minecraft  → mcasset.cloud
  → source=plugin     → textures envoyées par le plugin via WS ← phase 2
```

Note : le segment `:source` s'ajoute en tête de l'URL (phase 1 : `/api/textures/:version/*`). La migration redirigera l'ancien pattern vers `source=minecraft` pour ne pas casser les sessions existantes.

En phase 2, le plugin envoie un message WS `custom_items` contenant sa liste d'items custom + URLs de textures (ou les textures en base64). Le backend les fusionne avec le registre vanilla. L'éditeur ne change pas d'architecture.

Les items custom peuvent occuper plusieurs slots (items multi-blocs) : champ `size: { width, height }` ajouté en phase 2 à la structure Item.
