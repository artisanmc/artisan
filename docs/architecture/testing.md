# Tests — couverture par couche

Zones couvertes, pas liste de fichiers — `glob **/*Test.kt` / `**/*.test.*` donne la liste exacte.
Il n'y a plus de suite backend depuis la phase F (2026-10).

| Couche | Lancer | Zones couvertes |
|---|---|---|
| Plugin `core` | `cd plugin && ./gradlew :core:test` | Langage d'actions, expressions et templates, parseurs YAML, lecture des Projects, brouillons et journal de publication (`ProjectPublisherRecoveryTest`), empreinte d'instantané, vecteurs de conformance. |
| Plugin `hub` | `./gradlew :hub:test` | Serveur web (session par lien, permissions, même origine, port occupé), routes héritées du backend (`EditorApiTest`), `/ws/plugin` (secret, version de protocole, lien demandé par une feuille, serveur hors ligne), catalogue et textures vanilla. |
| Plugin `paper` | `./gradlew :paper:test` | Rendu des menus (MockBukkit), contrat des paquets (`MenuSlotsContractTest`), gestionnaires du protocole (`Project*ChannelTest`, `ConfigChannelTest`, fetch live), `LocalServerLink`, `WsClient` (MockWebServer), pack de ressources (manager, délégation), config et `environment.yml`, secret réseau, scheduler. |
| Plugin `api`, `database` | `./gradlew test` | Surface Java-friendly (`ApiSurfaceIsJavaFriendlyTest`), pools de connexions. |
| Éditeur | `cd editor && npm test` | Expr DSL, canvas + édition de Document, export (transform/validate/zip), i18n, title composer, pack de ressources dans le navigateur (`lib/pack/`), brouillons et conflits, routes. |
| E2E éditeur | `cd editor && npx playwright test` | `smoke.spec.ts` — canvas charge, sidebar visible. |

E2E éditeur → hub → serveur : **non automatisé**, test manuel sur `docker compose` (serveur seul)
ou `docker/network/compose.yml` (hub + feuille).

## Vecteurs de conformance

Ces vecteurs partagés verrouillent une égalité entre implémentations (Kotlin ↔ TS). Changer
l'algo = mettre à jour les deux côtés **et** régénérer le vecteur.

| Vecteur | Asservi par |
|---|---|
| `testdata/action-wire-conformance.json` | `ActionWireConformanceTest` (plugin, `KeyedStepParser` + liaison par `CoreActions`) + `lib/actions/actionWireConformance.test.ts` (éditeur, `structuredSteps.ts`) : le wire structuré keyed (ADR `structured-action-wire`). Chaque cas donne un `wire` (variante acceptée), sa forme `canonical` (ce que l'éditeur écrit) et les `names` des steps de tête ; les deux stacks doivent lire `wire` et `canonical` comme la même chaîne (liaison par `CoreActions.bind`, nombres comparés en double : `volume: 1` et le défaut `1.0` sont la même valeur pour un handler), l'éditeur doit réécrire `canonical` : la forme la plus courte (`domain/actionArgs.ts`, `canonicalActionValue`) — argument requis toujours écrit (défaut déclaré s'il manque), argument optionnel à son défaut omis, primaire seul nu, `{name: null}` pour une déclaration à arguments sans aucun de posé, nom nu sans argument déclaré. Les Actions de module y passent telles quelles (`quests:*`). |
| `docs/schema/menu/v1/schema.json` `$defs.Action` | `CoreActionSchemaConformanceTest` (core) : chaque action publiée a exactement un `ActionSchema` dans `CoreActions` (noms, arguments, requis, types, défauts), et aucun de plus ; `ActionRegistryDispatchTest` (paper) : les handlers core couvrent ce vocabulaire, une action de module est liée et exécutée par le registre (ADR `extensible-document-kinds` R1). |
| `testdata/action-dsl-conformance.json`, `action-dsl-eval-conformance.json` | `ActionDslConformanceTest`, `LeafEvalConformanceTest` (plugin) + `lib/actionDsl/*.test.ts` (éditeur) — le DSL legacy, lu mais plus écrit |
| `testdata/template-conformance.json` | `TemplateConformanceTest` (plugin) + `lib/expr/template/conformance.test.ts` (éditeur) |
| `testdata/lang-tree-conformance.json` | `LangFlattener` (plugin) + `langTree.ts` (éditeur) |
| `testdata/lore-wrap-conformance.json` | `LoreWrapConformanceTest` (plugin) + `loreWrap.test.ts` (éditeur) |
| `testdata/doc-ref-conformance.json` | `DocRefConformanceTest` (plugin) + `domain/docRef.test.ts` (éditeur) |
| `testdata/element-structural-keys.json` | `ElementStructuralKeysTest` (plugin) + `schema/elementStructuralKeys.test.ts` (éditeur) |
| `testdata/i18n-address-conformance.json` | `I18nAddressConformanceTest` (plugin) + `i18nAddressConformance.test.ts` (éditeur). Les cas `step_addresses` donnent une chaîne DSL legacy (`dsl`) ou des `steps` keyed (wire structuré, actions de module incluses) avec les `declared_actions` qu'ils utilisent : l'adressage des textes d'action est piloté par le schéma de chaque action (`assignI18nAddresses(steps, prefix, schemaOf)` côté plugin, `walkStepTextSlots` côté éditeur) — slot legacy par argument (`message`, `show_title`, `show_subtitle`), sinon `<prefix>.<action>.<arg>` numéroté par occurrence, listes de textes en `_2`, `_3`… |
| `testdata/core-actions.json` | `CoreActionsVectorTest` (core) : généré depuis `CoreActions.kt` (forme `declared_actions` + `i18n_slots`), régénéré par `ARTISAN_WRITE_VECTORS=1`. L'éditeur **importe** ce fichier comme table des actions core (`lib/actions/coreActions.ts`) : il n'en porte aucune copie écrite à la main. |
| `testdata/project-snapshot-hash-conformance.json` | `ProjectSnapshotHashConformanceTest` (plugin seul : l'éditeur ne recalcule pas l'empreinte) |
| `testdata/resource-pack-conformance.json` | `lib/pack/resourcePackConformance.test.ts` (éditeur) : zip octet pour octet. Le constructeur du pack de l'éditeur en est désormais propriétaire — le script backend qui le générait a disparu avec le backend ; un changement voulu du zip met à jour `entries`/`sha1` du vecteur dans le même commit. Le SHA-1 ne dépend pas du fuseau horaire de l'hôte : la date fixe des entrées du zip est construite en heure locale (`ZIP_MTIME`, `resourcePackBuilder.ts`), car fflate écrit l'horodatage DOS depuis les champs locaux de la `Date`. |

## Menus en paquets — checklist manuelle

Le contenu des menus n'existe que côté client (cf. `invariants.md`) : les tests plugin verrouillent
le contrat (`MenuSlotsContractTest`, faux `ClientSlotSink`) mais pas le comportement du client
Minecraft réel. Pas de bot client automatisé (Mineflayer écarté : coûteux, et indisponible à la
sortie d'une nouvelle version de Minecraft, précisément quand le risque est là).

**Déclencheurs** : mise à jour de Minecraft ou de PacketEvents, toute modification de
`PacketEventsMenuPackets.kt` / `MenuWindows.kt` / `MenuSlots.kt`. Aussi dans la checklist de release
(`versioning.md` §11.1).

Sur `./gradlew deploy`, avec un menu `player_inventory: hidden` qui pose de la pierre sur toutes les
positions (haut et bas) et un menu `visible` :

- [ ] Pierre partout en haut et en bas (`hidden`).
- [ ] Clic, shift-clic, double-clic, touche numérique, touche F : rien ne bouge, rien n'est récupéré.
- [ ] Ramasser un objet au sol menu ouvert : le bas reste celui du menu.
- [ ] Passer d'un menu A à un menu B (bouton `open_menu`) : B s'affiche entier, sans reste de A.
- [ ] Retour : `A → B → C` puis bouton `open_previous_menu` deux fois ramène à A (jamais de va-et-vient C↔B) ; sans historique, le placeholder `{has_previous_menu}` est faux et le retour ne fait rien.
- [ ] Fermeture : le vrai inventaire revient intact.
- [ ] `/data get entity @s Inventory` menu ouvert = le vrai inventaire (rien côté serveur).
- [ ] `visible` : le vrai inventaire s'affiche et n'est pas modifiable.
- [ ] `vanilla_texture: false` : fenêtre transparente (haut et bas), la glyph du menu s'affiche, les
  items restent au-dessus de la glyph.
- [ ] Même serveur : un vrai coffre, un tonneau, un ender chest et un double coffre gardent leur
  texture vanilla (réinjectée), titre à sa place ; idem juste après `/artisan reload`.
- [ ] Joueur qui refuse le pack : coffres vanilla normaux, aucun caractère manquant dans les titres.
- [ ] Menus entonnoir et dropper en `vanilla_texture: false` : fenêtres transparentes ; un vrai
  entonnoir, un distributeur et un dropper gardent leur texture (réinjectée), un vrai coffre n'est
  pas touché tant qu'aucun menu coffre n'est transparent.
- [ ] Avec le plugin PacketEvents installé à côté (copie relocalisée + plugin autonome) : démarrage
  sans erreur et tout ce qui précède tient.
