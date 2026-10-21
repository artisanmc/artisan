# Vues de module chargées à l'exécution — le jar porte sa vue

**Statut :** accepté (2026-10-17). Lot L5 d'ArtisanQuests, partie Artisan (niveau 3 de
`auto-hebergement.md` §10).

## Contexte

Jusqu'ici la vue éditeur d'un module (`FrontendModule`) était compilée dans l'éditeur, donc
livrée par le jar du socle : une correction de la vue des quêtes demandait une release
d'Artisan, et un serveur dont le plugin de quêtes est plus récent ou plus ancien que
l'éditeur affichait une vue qui ne correspondait pas au plugin. Iban a tranché le
2026-10-16 : la vue des quêtes est livrée **dans le jar ArtisanQuests**.

## Décisions

1. **Le jar déclare son bundle.** `api.getEditorBundles().register(EditorBundleDeclaration
   .fromResource(loader, "artisan-editor/ui.js", sdk))` (`@Beta`, API 2.3.0) depuis
   `onEnable`. La Presence l'annonce dans `installed_modules[].editor_bundle`
   (`{sdk, hash, size}`) ; le hub le sert sur `GET /api/v1/servers/:server/modules/:module/ui.js`,
   relayé au serveur (`editor_bundle_fetch`, protocole 1.2), vérifié contre le SHA-256
   annoncé et gardé en mémoire par hash. Détail plugin : `modules.md` §4.6.
2. **SDK versionné.** `@artisan/editor-sdk` porte `SDK_VERSION` (1.2.0). Même discipline que
   l'API Java : majeure = un export change de sens ou disparaît, mineure = un ajout. Un bundle
   est chargé si sa majeure est celle de l'éditeur et sa mineure ≤ celle de l'éditeur ; sinon
   il est refusé avant téléchargement (`older-editor` : mettre à jour Artisan ;
   `older-bundle` : mettre à jour le module) et l'éditeur se rabat sur la copie intégrée
   s'il en a une.
3. **Pas d'import map, des modules partagés réécrits.** Un bundle est **un seul module ES**.
   Ses seuls imports autorisés sont `react`, `react-dom`, `react/jsx-runtime` et
   `@artisan/editor-sdk` (`distribution/sharedModules.ts`) : une seule instance de React et du
   SDK dans la page, sinon les hooks cassent et le module s'enregistre dans un registre que
   l'éditeur ne lit pas. Une import map ne peut plus être ajoutée une fois l'éditeur lancé,
   donc l'éditeur réécrit chaque spécifieur (`es-module-lexer`, build asm.js sans
   WebAssembly) vers un petit module qui réexporte sa propre instance, puis importe le
   bundle depuis une URL `blob:`. Tout autre import (chunk relatif, paquet non partagé) est
   refusé. *Rejeté :* import map dynamique (pas supportée partout), iframe isolée (le JS
   d'un module n'a pas plus de pouvoir que son jar, déjà installé par l'admin).
4. **Le SDK expose l'hôte, jamais ses internes.** Une vue lit et écrit par le SDK :
   `useProject`, `useContentLang`, `useUiLang`, `updateDocument` (Document + textes en un
   seul pas d'annulation), `newTextKey`, `textValue`, `fieldText`, `projectLangs`, `notify`, et depuis 1.1 deux
   widgets de l'éditeur, `ActionChainEditor` (chaîne d'actions au format du fichier) et
   `MaterialInput` (palette d'items), rendus par l'hôte (`EditorHost.components`,
   `distribution/hostComponents.tsx`).
   L'éditeur installe l'implémentation au démarrage (`lib/editorHost.ts`). Un module porte
   ses libellés (`createModuleI18n`, `labels` d'un kind par langue) et ses styles
   (`injectModuleStyles`, classes préfixées, couleurs par `var(--token)`) : un bundle n'a
   pas été scanné par le Tailwind de l'éditeur, il ne compte que sur les classes du design
   system (`.btn`, `.input`, `.select`, `.field-label`…).
5. **Le bundle prime.** `modulesStore.integrate` charge le bundle annoncé (il correspond
   exactement au plugin installé), sinon l'entrée de `modules.manifest.ts` s'il en existe une
   (un module compilé dans l'éditeur, comme la boutique) ; un module livré par son jar n'en a
   pas. L'échec d'un module ne coûte que sa vue. `origins` et `refused`
   disent d'où vient chaque vue et pourquoi un bundle a été écarté.
6. **Un kind enregistré après la lecture d'un Project ne perd rien.** La vue arrive avec la
   Presence, parfois après la lecture du Project : son dossier est alors gardé tel quel
   dans `moduleData[<dir>].__files` (réexporté à l'identique), puis `adoptLateDocuments`
   le lit par le codec du kind dès que les modules sont prêts.
7. **Construire un bundle.** `artisanModuleBundle({ entry })` (`@artisan/editor-sdk/bundle`)
   donne la config Vite : lib ES, partagés en externes, tout le reste inliné, et la version
   du SDK de build tamponnée sur l'export par défaut (`sdk`), vérifiée au chargement.

## Conséquences

- Artisan ne détient pas la vue d'un module livré par son jar : la vue des quêtes (kind
  `quest_group`, id de Presence `msquests`) vit dans le dépôt MSQuests (`editor/`), qui
  construit `ui.js` dans les ressources de son jar. Sans bundle servi, l'éditeur n'a pas de
  vue pour ce module. `modules.manifest.ts` ne garde que les modules compilés dans l'éditeur.
- Un module hors du dépôt dépend du SDK par son archive (`npm pack` de
  `editor/packages/editor-sdk`) tant que `@artisan/editor-sdk` n'est pas publié sur npm.
- Changer `SHARED_MODULES` ou le contrat de `EditorHost` est un changement du SDK : mineure
  pour un ajout, majeure sinon.
- Hors périmètre : nœud de groupe contenant ses quêtes sur la planche, compteur d'instances
  en cours (live), récompenses en chaînes Artisan (L3).
