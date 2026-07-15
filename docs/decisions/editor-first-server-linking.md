# Editor-first server linking — un seul chemin `link`, `setup` supprimé

**Statut : accepted (2026-07-15).** Fait suite à l'accounts-only cutover (`accounts-only-editing.md`) qui avait déjà pointé « des server keys orphelins créés par `/artisan setup` relancé face à une UI incompréhensible ».

Le lien d'un Server à un Network passe désormais par **un seul flux, initié depuis l'éditeur** :

1. Dans l'éditeur, **« Ajouter un serveur »** crée un `server_key` *non-redeemé* (pas encore de secret, `hash` NULL) + un `link_code` court lié à cette clé, et affiche le **code**.
2. Sur le serveur Minecraft, **`/artisan link <code>`** échange le code contre le secret via `POST /api/v1/link/:code/redeem` (non-authentifié, le code = bearer). Le backend **génère le secret à ce moment-là**, pose le `hash`, marque le code consommé, et renvoie le secret **une seule fois**. Le plugin l'écrit dans `config.yml` (`ConfigWriter.writeServerKey`) puis se connecte.
3. **Re-link / rotation** = même chemin : « Régénérer un code » sur la carte serveur → nouveau code lié au **même** `server_key` → `/artisan link` = rotation du secret. Aucune nouvelle ligne n'est jamais créée.

`/artisan setup` (+ `SetupClient` WS pairing) et le flux web `claim` (`POST /link`, `POST /link/:code/claim`) sont **supprimés d'un coup** (projet pré-launch, pas de clients à migrer).

## Pourquoi

Il existait **deux** chemins de link, en directions opposées :

- **Pairing WS** (`/artisan setup`) : le plugin ouvre un WS, mint un code (`setup_request`), l'admin claim dans le web (`/link?code=`), le backend crée la clé et pousse le secret (`link_confirmed`).
- **Wizard éditeur** (`SetupWizard` Step2) : l'admin génère une clé dans le web, copie le `sk_…` brut, le colle à la main dans `config.yml`.

Deux modèles = double surface (routes, messages WS, UI) pour un même acte. Surtout, **chaque re-link mintait une nouvelle `server_key`** sans réutiliser ni nettoyer l'ancienne : un serveur re-linké N fois laissait N clés dans le Network (incident réel 2026-07-15 : 3 clés pour 1 serveur, projects éclatés sur deux d'entre elles). Le badge « serveurs liés » comptant toutes les clés, l'utilisateur voyait « 3 serveurs » pour une seule machine.

Le flux editor-first règle les deux : un seul modèle, et le re-link **rote** une clé existante au lieu d'en créer.

## Sémantique clé

- **Clé non-redeemée** : `server_keys.hash` devient **nullable**. `hash = NULL` ⇒ clé créée dans l'éditeur mais jamais redeemée ⇒ ne s'authentifie jamais (`validateServerKeyHeader` ne matche que des hash réels). Un Server peut donc exister « en attente de link » avant que le plugin ne se connecte.
- **Secret jamais stocké en clair** : généré uniquement dans la réponse `redeem` (comme l'ancien push WS). Le code porte les garanties : haute entropie, TTL 10 min, single-use atomique.
- **`/artisan link <code>` sur un serveur déjà lié** : **écrase** la clé en config (rotation ou bascule vers un autre Server de l'éditeur). Le code est explicite, donc pas de blocage — un WARN log pour le post-mortem.
- **`/artisan editor`** : lié → deep-link `server_url` ; pas lié → home éditeur (après login) pour créer un serveur. Ne lance plus de setup.

## Alternatives rejetées

- **Garder les deux chemins** : c'est exactement la dualité que l'accounts-only cutover a condamnée ailleurs — taxe structurelle permanente.
- **Réutiliser la clé côté `claim` web** (param `server_key_id`) : corrige les doublons mais garde le double chemin et le sens plugin-mint-code. Prototypé le 2026-07-15 puis reverté au profit de ce design.
- **Stocker le secret en clair côté serveur en attendant le redeem** : inutile — générer au redeem évite tout secret at rest.
- **Fichier de credential dédié** (hors `config.yml`) : `ConfigWriter.writeServerKey` écrit déjà dans `config.yml` ; pas de raison d'introduire un second fichier.

## Conséquences

- Migration DB forward-only : `server_keys.hash` nullable.
- Terme domaine : **`setup` → `link`** (cf. `CONTEXT.md`). `/artisan link <code>` remplace `/artisan setup [code]`.
- Le plugin dérive sa base HTTP du `ws_url` de config (`wss://host/ws/plugin` → `https://host`) pour appeler `redeem` avant d'être lié — pas de nouvelle clé de config.
- Surface retirée : WS `setup_request`/`setup_code`/`setup_claim`/`link_confirmed`, REST `POST /link` + `POST /link/:code/claim`, route éditeur `/link`, `SetupClient`.
