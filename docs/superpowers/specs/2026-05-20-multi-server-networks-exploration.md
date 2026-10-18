# Multi-serveur, Networks & Branches — Exploration

**Status:** Exploration — pas d'engagement d'implémentation (à reprendre quand le moment est venu de planifier)
**Date:** 2026-05-20
**Scope:** backend (data model + auth + sync) + editor (login + UI bindings/branches) + plugin (config bindings + sémantique pull/push)

---

## TL;DR

Le pack passe d'**entité scoped au server_key** à **entité first-class** détenue par un **Network** (groupe de serveurs MC). Un serveur MC est représenté par une `server_key` qui s'**abonne** à un pack sur une branche donnée. Multi-serveur sync = N server_keys d'un même Network bindées au même `(pack, branche)`. Test→prod = bindings sur branches différentes.

L'idée initiale "stocker dans GitHub" a été explorée et écartée : GitHub n'aide pas sur le merge sémantique (qui est custom de toute façon), complique la sync multi-server (webhooks vs WS direct), et son seul vrai gain — sharing/fork public — a été dé-priorisé. On garde un backend custom, avec un système de comptes natif (Discord OAuth + email/password) puisqu'on n'utilise plus GitHub comme provider d'identité non plus.

Positionnement Artisan : **freemium SaaS**. Subscription scopée au Network. Stripe différé à une phase future ; Phase 1-3 sont account-aware sans billing.

Conflit de sync simplifié : **backend = source de vérité**. Local YAML = cache + resilience boot. `/artisan pushLocal` pour pousser explicitement les modifs FTP. Pas d'UI de résolution interactive (l'UI conflits récemment mergée est à retirer, hors deletion auto-resolve).

---

## 1. Contexte et motivation

L'archi actuelle lie un `Pack` à un seul `server_key`. Plusieurs cas d'usage le débordent :

- **Multi-serveur sync** : `survival + creative + lobby` partagent le même menu principal sans copier-coller la config.
- **Pipeline test → prod** : un serveur staging itère sur une version, on promeut vers prod quand validé, idéalement avec branches + merge à la git.
- **Future** : écosystème de packs publics (fork, marketplace) — dépriorisé mais à garder en tête.

L'idée déclencheuse a été : "et si on remplaçait le backend par GitHub ?" — explorée à fond, écartée. Voir §10.

---

## 2. Positionnement stratégique

- **Freemium SaaS** (pas d'OSS self-hostable, pas de paid-only)
- **Subscription scopée au Network** (pas au User). Un même user peut gérer plusieurs Networks avec des plans indépendants.
- **Stripe différé** : Phases 1-3 ajoutent les comptes et la notion de tier, mais sans intégration de paiement. Phase 4 (à part) intègre Stripe le moment venu.
- **Axe paywall non tranché** : on construit account-aware sans gating actif. Décision repoussée à Phase 4.

---

## 3. Modèle d'entités

```
User (identité humaine, 1 par personne)
  ├─ email, name, oauth_providers (Discord)
  └─ Membership → Networks (role: owner / admin)

Network (entité d'ownership + billing)
  ├─ id, name, tier="free", subscription_id?
  ├─ Members (user_id, role)
  ├─ Packs (N)
  └─ ServerKeys (N)

Pack (belongs to Network)
  ├─ id, name, description, visibility (private par défaut)
  ├─ Assets (scopés au pack, voir §6)
  └─ Branches (Phase 2+) avec head_commit_hash

ServerKey (credential — N instances physiques peuvent partager une clé)
  └─ PackBindings (server_key_id, pack_id, branch_name)
```

### Notes

- **Pack ne s'attache plus à un server_key** : c'est le `PackBinding` qui fait le lien, many-to-many.
- **Multi-serveur sync** est gratuit dans le data model : plusieurs server_keys d'un même Network bindées au même `(pack_id, branch)` → toutes reçoivent les mêmes `bundle_available`.
- **Membership** prépare le futur multi-collab (Phase 3+) sans complexifier la Phase 1.

---

## 4. Editor anonyme vs logged-in

`/artisan editor` continue à ouvrir une session **anonyme** via trust dance. Pas de login à taper pour les édits quotidiens. Le compte n'intervient qu'au **setup**.

| Action | Anonyme | Logged-in |
|---|---|---|
| Éditer les packs bindés à *ce* server_key | ✓ | ✓ |
| Voir / éditer d'autres packs du Network | ✗ | ✓ |
| Créer / supprimer un pack | ✗ | ✓ |
| Changer les bindings (`server_key → pack/branch`) | ✗ | ✓ |
| Gérer membres, billing | ✗ | ✓ (owner) |

Au quotidien, l'admin tape `/artisan editor`, est trust-confirmé, peut éditer les packs liés à son serveur — c'est le scénario actuel. Login débloque les opérations "structurelles" (création de pack, switch de binding, gestion réseau).

---

## 5. Sémantique de `server_key`

Un `server_key` est une **credential** représentant un slot de configuration logique. Trois patterns de déploiement tombent du même data model :

1. **Server unique** — 1 server_key, 1 instance MC. Cas standard.
2. **Clone-at-setup** — N server_keys distinctes, bindings copiés depuis une source au setup. Distinctes pour pouvoir individualiser plus tard (ex: switch une des trois sur la branche `dev`).
3. **Clé partagée (autoscale)** — N instances MC utilisent la *même* server_key. Cas typique infra auto-scalée : un secret bakedans l'image, N pods s'y connectent. Le DB ne fait pas la différence ; le hub accepte N connexions WS sur la même clé (cf. §11 — `connectionsByServer` doit gérer un `Set<WS>`).

Le pattern 3 présuppose des instances identiques (image-based, files immutables). En cas de divergence, "latest reporter wins" pour la conflict detection. Documenté comme "advanced".

---

## 6. Assets scopés au pack

Aujourd'hui : assets stockés à `data/assets/{server_key_id}/...` avec codepoint allocation par server_key.

Nouveau : `data/assets/{pack_id}/...`, codepoint allocation par pack. Les assets voyagent avec le pack lors d'un partage cross-server_key.

**Conséquence sur le resource pack zip** : aujourd'hui les assets d'un server_key sont mergés dans `assets/artisan/`. Avec pack-scope, plusieurs packs sur un même server_key peuvent vouloir coexister dans le RP. Solution : **merge à la volée avec ré-allocation de codepoints** au build du RP (le pack interne du zip reste `assets/artisan/`, mais l'allocateur tient compte des collisions entre packs). Plus complexe que la solution naïve "sub-namespaces par pack", mais évite de casser la résolution de codepoints dans les YAMLs existants.

Migration : Iban accepte un wipe complet (il n'a qu'un environnement de test). On reconstruit propre.

---

## 7. Modèle de conflit — backend = source de vérité

Les fichiers YAML sur le disque du serveur MC servent à **deux choses uniquement** :

1. **Resilience** : le serveur peut booter et fonctionner si le backend est down.
2. **Cache** : ce qui est servi aux joueurs jusqu'à la prochaine sync backend.

### Flux normal (boot ou /artisan reload)

```
plugin charge local → connecte WS → hello { current_bundle_hash: H_local }
  if H_local == H_backend → no-op
  if H_local != H_backend → backend → bundle_available
    plugin download + overwrite local
    (1 log WARN une ligne pour trace post-mortem ; pas de délai, pas de prompt)
```

### Backend injoignable

Plugin opère sur les fichiers locaux indéfiniment. Sync reprend quand backend revient.

### Push manuel (cas FTP)

```
admin tape : /artisan pushLocal <pack_id> | --all
  plugin lit les fichiers locaux
  plugin → WS local_push { pack_id, files, hash }
  backend accepte sans résolution → broadcast bundle_available aux autres instances
```

### Garanties de pushLocal

- Crée le pack côté backend s'il n'existait pas (ajout dir via FTP).
- Met à jour / crée les fichiers présents dans le push.
- **Ne supprime rien côté backend** (safe par défaut). Pour supprimer, passer par l'éditeur (DeletePackDialog).
- Si édition concurrente dans l'éditeur : last-write-wins, la WIP de l'éditeur est écrasée. Edge case rare.

### Conséquence : retrait de l'UI conflits récente

Le merge `sync-deletion` (commits `2e466927`, `d89dbe7b`, `05efa710`, `f50cb83e`) a introduit une UI de résolution de conflits éditeur ↔ disque. **Cette UI est invalidée** par ce modèle. À retirer :

- `ConflictResolutionModal`, `ConflictBanner`, `conflictsStore`
- Endpoints `/api/.../conflicts/*`
- Table `pack_conflicts`
- Messages WS `pack_conflict_detected` / `pack_conflict_resolved`
- Tests associés (`conflicts.test.ts`, `ConflictDetectionTest`, etc.)

**À garder** : auto-résolution sur DELETE pack (`pack_deleted` flow), déjà conforme au principe "éditeur autoritaire".

### Pas en conflit avec la merge sémantique Phase 3

La résolution qu'on supprime est entre `(local disk)` et `(backend)`. La merge sémantique Phase 3 est entre `(branche A)` et `(branche B)`, toutes deux dans le backend — autre problème, autre UI, on garde.

---

## 8. Phasage

### Phase 1 — Comptes + fondations (~2.5-3 sem)

- `User` (email, name, avatar, oauth_providers) — tier vit sur le Network, pas sur le User
- Auth : email+password + Discord OAuth, session/JWT
- Login/signup UI dans l'éditeur
- `Network` + ownership + `Membership`
- `Pack` first-class (belongs to Network)
- `Assets` re-scopés au pack + refactor codepoint allocator + ré-alloc à la volée au RP build
- `ServerKey` belongs to Network
- `PackBinding (server_key, pack)` — sans `branch_name` pour l'instant
- Setup flow : login → pick/create Network → pick/create Pack → clone-or-new server_key → trust dance
- Retrait de l'UI conflits (modèle backend-as-truth)
- **Valeur livrée :** multi-server sync marche. Compte natif. Le système est prêt pour le billing futur sans gating.

### Phase 2 — Branches + promotion (~1.5 sem)

- `pack_branches (pack_id, name, head_commit_hash)`
- `pack_commits (id, pack_id, parent_id, content_hash, author_user_id, message, createdAt)`
- `PackBinding` étendu avec `branch_name` (default `"main"`)
- Plugin config bind à une branche
- Promotion sens unique (UI "Promote dev → prod" — fast-forward sans conflit possible)
- History view dans l'éditeur
- **Valeur livrée :** pipeline test/prod. History native via commits.

### Phase 3 — Merge sémantique (~2-3 sem)

- IDs stables sur arrays (`Menu.title.layers`, slots, actions, dialog branches, ...) — migration data
- Moteur de diff field-level (compréhension du schéma)
- Moteur de merge field-level avec détection de conflit par champ
- UI résolution de conflit par champ (prend la valeur dev ou prod pour ce champ-là)
- **Valeur livrée :** workflow git-like complet, branches concurrentes réconciliables.

### Phase 4 — Billing (différé, ~1.5 sem au déclenchement)

- Intégration Stripe (Customer par Network, pas par User)
- `Network.tier` actionnable (free → paid)
- Feature gating selon tier
- Customer portal
- **Axe de paywall à trancher au moment d'attaquer cette phase.**

---

## 9. Décisions prises pendant le brainstorm

- **WIP vs commit** : séparés. Le "save" éditeur reste en cache backend (live preview via WS). "Commit & deploy" sera une action explicite (en Phase 2+, où le commit existe vraiment).
- **Assets per-pack** + refactor codepoint allocator avec merge à la volée au build RP.
- **Provider OAuth** : Discord en priorité (cible = admins MC). Email/password en fallback. GitHub écarté (n'avait de valeur que comme storage, qui est custom).
- **Migration data** : agressive. Iban a un seul environnement de test, accepte un wipe pour repartir propre.
- **Backend = source de vérité** pour les conflits sync. Local = cache + resilience. `/artisan pushLocal` pour les cas FTP.
- **`server_key` = credential** : autoscale supporté nativement (N instances, même clé). Pas d'UI dédiée pour ce cas, "advanced".

---

## 10. Alternatives considérées (et écartées)

### GitHub comme backend storage

Idée initiale. **Pour :** versioning gratuit, branches/merge natifs, sharing/fork public gratuit. **Contre (décisifs) :**

- Merge sémantique field-level est custom de toute façon ; `git merge` text-based ne nous aide pas (et risque de générer des conflits là où on n'en aurait pas avec un merge sémantique).
- Multi-server sync via webhook GitHub est plus compliqué que broadcast WS direct.
- Ajoute des modes d'erreur externes (rate limits API, OAuth révoqué, repo permissions, etc.).
- Le seul vrai gain — sharing/fork public — a été dé-priorisé par Iban (motivations principales = versioning + fork ; mais versioning se construit pareil dans les deux cas, donc seule la dimension sharing pesait pour GitHub).

**Verdict** : storage custom. GitHub OAuth-only un moment envisagé comme provider d'identité, abandonné quand Iban a opté pour des comptes natifs (Discord OAuth est meilleur fit).

### Promotion sens unique seulement (pas de merge)

Considéré comme simplification Phase 2. Écarté car Iban veut explicitement les vraies branches divergentes + merge pour les cas type "hotfix prod pendant qu'une refonte est en cours sur dev". Phase 2 garde tout de même une promotion sens unique (fast-forward) en livraison intermédiaire, et la merge sémantique vient en Phase 3.

### `server_key` strictement = 1 serveur MC

Considéré. Écarté à cause du cas autoscale : un gros network peut auto-déployer des instances MC depuis une image et veut baker une `server_key` dans N déploiements. Le data model supporte les deux (N:1 autoscale, 1:1 typique) sans complexité produit.

### Résolution interactive boot-time pour les conflits (délai 5s + prompt)

Considérée. Écartée — personne ne regarde la console du serveur MC au boot ; le délai serait du theater code. Cf. mémoire `feedback_no_theater_code`.

### Comptes au niveau User (pas Network)

Considéré implicitement. Écarté quand Iban a proposé `Network` comme l'unité de billing : permet à un même user de gérer plusieurs Networks avec des plans différents.

---

## 11. Points ouverts à trancher au moment du plan d'implémentation

- **Email verification** : obligatoire au signup ou différée ?
- **Discord OAuth scope** : identity-only ou email scope aussi (utile pour fallback si déconnexion Discord) ?
- **Limites du tier free** : un user peut-il avoir N Networks free ? Sinon, on impose 1 Network free par user et les autres sont paid ?
- **Mécanisme d'invitation de membres** (Phase 3+) : lien email, invite in-app par username, les deux ?
- **Setup flow premier serveur** : si le user crée son premier Network, pas de Pack encore → on guide vers "créer un premier pack vide" ou écran d'accueil avec templates ?
- **Trust dance UX avec server_key partagée (autoscale)** : quelle instance affiche le `trust_code` ? Probable réponse : aucune, l'admin génère un trust_code via un endpoint dédié quand il configure l'autoscale.
- **Dédup d'assets cross-pack au sein d'un Network** : aujourd'hui dédup par contentHash dans un server_key. Avec scope pack, deux packs uploadent la même image = deux blobs ? Ou dédup au niveau Network ?
- **WS hub multi-connexions par server_key** : aujourd'hui `Map<serverId, WS>` 1:1. À étendre en `Map<serverId, Set<WS>>` pour autoscale. Fix mineur mais à valider.
- **Plan de wipe data exact** : ordre de drop des tables, état initial à recréer pour les tests E2E manuels.

---

## 12. Hors scope de cette exploration

- Marketplace UI / découverte publique de packs.
- Implémentation détaillée du toggle de visibility public.
- UX de collaboration multi-membres (le data model porte `Membership` mais l'UI invites/permissions est repoussée).
- Détails Stripe (price points, plans, coupons, prorations).
- UI de résolution de conflit field-level par type de champ (à designer au moment de la Phase 3).

---

## Prochain pas

Quand Iban est prêt à passer en mode "on build" : lancer une session de planning sur la **Phase 1 uniquement**, qui produira `docs/superpowers/plans/YYYY-MM-DD-multi-server-networks-phase-1.md` avec schéma Drizzle, séquence de migration, endpoints, flows UI détaillés, et plan de tâches d'implémentation.
