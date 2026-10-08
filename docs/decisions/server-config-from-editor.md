# Config serveur modifiable depuis l'éditeur — `connection.yml` à part

**Status :** accepted (2026-10-08).

## Contexte

Les textures de remplacement des conteneurs (coffre, entonnoir, distributeur)
étaient des usages d'asset (`chest_texture`…) cochés sur une image de Project.
Or le réglage est **par serveur** : le pack est construit pour un serveur à partir
de tous ses Projects, une seule image par conteneur, « la première trouvée ».
Le porter sur un asset le rendait local en apparence, et le changer passait par
le brouillon du Project puis une publication.

Les autres réglages du plugin (`config.yml`) n'étaient modifiables qu'à la main.

## Décisions

1. **Le disque reste la vérité.** Les réglages serveur vivent dans des fichiers du
   plugin ; le plugin fonctionne sans éditeur.
2. **Deux fichiers, séparés par qui peut les écrire :**
   - `connection.yml` — `server_key` et `ws_url`, le lien plugin ↔ backend.
     Jamais écrit depuis l'éditeur (le backend pourrait sinon se rediriger ou se
     retirer l'accès).
   - `config.yml` — tout le reste, modifiable à la main **ou** depuis la page
     serveur de l'éditeur.
3. **Pas de liste d'exclusion « sécurité » au-delà de la connexion.** Un utilisateur
   de l'éditeur peut déjà lancer des commandes console depuis une action de menu :
   `delegate-reload-command` ou les réglages d'accès n'ajoutent rien. Seuls les
   **chemins** ajoutent un pouvoir (lire/écrire des fichiers) : le plugin refuse
   depuis l'éditeur tout chemin absolu ou contenant `..`.
4. **Textures des conteneurs** : `resource-pack.container-textures.{chest,hopper,dispenser}`
   = `projet:image` (vide = texture vanilla). Le backend les résout à la
   construction du pack. Les usages d'asset `*_texture` sont retirés (aucune
   migration : réglage marginal, re-choisi sur la page serveur).
5. **Protocole** : le plugin rapporte sa config éditable dans `hello`
   (`server_config`). L'éditeur écrit via `server_config_write` ; le plugin valide,
   réécrit `config.yml` (commentaires conservés), recharge, et renvoie la config.
6. **Migration** : au démarrage, `server_key`/`ws_url` présents dans `config.yml`
   sont déplacés vers `connection.yml`.

*Rejeté :* `settings.yml` à côté de `config.yml` (noms indiscernables pour un admin) ;
choix fermés (Nexo/Oraxen…) pour la délégation du pack (garde-fou sans objet vu le
point 3) ; stocker le réglage en base backend (le plugin doit fonctionner seul).
