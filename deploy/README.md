# Déploiement Artisan (backend + éditeur) — VPS OVH + Coolify

Cible : **fiable + pas cher**. Le backend (Bun + WebSockets + disque) et l'éditeur
(SPA statique) tournent sur **ton VPS OVH** via **Coolify** (PaaS open-source). Ton
serveur dédié MC reste **intouché** — les plugins se connectent en *sortie* au backend,
ils n'ouvrent aucun nouveau port entrant côté MC.

```
joueurs + plugins ──HTTPS/WSS──┐
navigateur (éditeur) ──HTTPS──┐ │
                              ▼ ▼
        app.artisanmc.net   api.artisanmc.net
          (éditeur nginx)     (backend Bun) ── volume /app/data (icônes + data runtime)
                  └──── VPS OVH (Coolify, anti-DDoS OVH) ────┘ ── Postgres (Coolify)
```

DDoS : l'**anti-DDoS OVH (VAC)** couvre le VPS gratuitement. Cloudflare en façade =
option (voir § *Cloudflare*), avec une réserve sur le cap 100 Mo.

---

## Pré-requis

- VPS OVH **réinstallé propre en Ubuntu 24.04 LTS** (2 vCore / 4 Go suffisent).
- Accès **DNS** de `artisanmc.net`.
- Le repo GitHub `artisanmc/artisan` (déjà en place) avec **`main` poussée à jour**
  (Coolify déploie depuis une branche).

---

## 1. Installer Coolify sur le VPS

En SSH sur le VPS :

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Puis ouvre `http://<IP_DU_VPS>:8000`, crée le compte admin. (Coolify s'occupe de
Docker, Traefik/TLS, etc. — rien d'autre à installer.)

## 2. DNS

Chez OVH (ou Cloudflare si tu l'utilises), crée deux **enregistrements A** vers l'IP du VPS :

| Nom | Type | Valeur |
|---|---|---|
| `api.artisanmc.net` | A | `<IP_DU_VPS>` |
| `app.artisanmc.net` | A | `<IP_DU_VPS>` |

(Coolify générera les certificats Let's Encrypt automatiquement une fois les domaines posés.)

## 3. Connecter GitHub

Coolify → **Sources** → GitHub → installe l'app GitHub sur l'org `artisanmc`, autorise le repo `artisan`.

## 4. Base de données Postgres

Coolify → **Databases** → **PostgreSQL 16** → crée-la dans un projet « artisan ».
- Note la **connection string interne** (réseau Coolify) → ce sera `DATABASE_URL`.
- Active les **Scheduled Backups** (ex. quotidien).

## 5. Déployer le backend

Coolify → **New Resource** → ton repo GitHub `artisan` → branche `main`.
- **Build Pack** : `Dockerfile`
- **Base Directory** : `/`   ← important (le build a besoin de `docs/`)
- **Dockerfile** : `backend/Dockerfile`
- **Domaine** : `https://api.artisanmc.net`  · **Port exposé** : `3001`
- **Health check path** : `/health`
- **Environment** : colle les variables de [`deploy/.env.production.example`](.env.production.example)
  (mets le vrai `DATABASE_URL` interne, génère `CONFIG_ENC_KEY` via `openssl rand -hex 32`,
  ton email dans `ADMIN_BOOTSTRAP_EMAILS`).
- **Storages** → ajoute un **Persistent Storage** monté sur `/app/data`.
- **Deploy**. (Au boot : `db:migrate` puis `start` ; le migrate retente si la DB n'est pas encore prête.)

## 6. Seed du volume data (les 2,2 Go d'icônes)

Une fois le volume `/app/data` créé, peuple-le **une fois** depuis ton poste (repo root) :

```bash
VPS_HOST=root@<IP_DU_VPS> \
VOLUME_PATH=<chemin hôte du volume /app/data, vu dans Coolify → Storages> \
./deploy/seed-data.sh
```

Puis **redéploie/redémarre** le backend. (Sans ça, les icônes 3D manquent ; le backend
re-télécharge les assets MC bruts depuis Mojang à la volée, mais pas les icônes pré-rendues.)

## 7. Déployer l'éditeur

Coolify → **New Resource** → même repo → branche `main`.
- **Build Pack** : `Dockerfile` · **Base Directory** : `/` · **Dockerfile** : `editor/Dockerfile`
- **Build args** (cruciaux — `VITE_*` sont bakés au build) :
  - `VITE_API_URL=https://api.artisanmc.net`
  - `VITE_PLUGIN_WS_URL=wss://api.artisanmc.net/ws/plugin`
- **Domaine** : `https://app.artisanmc.net` · **Port** : `80`
- **Deploy**.

## 8. Vérifier

- `https://api.artisanmc.net/health` → `{"ok":true}`
- `https://app.artisanmc.net` → l'éditeur charge, et la console réseau tape `api.artisanmc.net`
  (REST + `wss://api.artisanmc.net/ws/editor`), pas `localhost`.

## 9. Brancher les plugins

Dans la config du plugin Artisan (serveurs MC), pointe le WS sur
`wss://api.artisanmc.net/ws/plugin` (ou utilise l'assistant de setup de l'éditeur, dont
le défaut affiché vient de `VITE_PLUGIN_WS_URL`). Les plugins se connectent **en sortie** —
aucun port à ouvrir côté dédié MC.

---

## Mises à jour

`git push` sur `main` → Coolify rebuild + redéploie (active l'auto-deploy sur webhook).
Migrations DB : appliquées automatiquement au boot du backend (idempotent).

## Sauvegardes / ops

- **Postgres** : backups planifiés Coolify (§4). Teste une restauration au moins une fois.
- **Volume `/app/data`** : surtout `custom-items/` et `resource-packs/` (data runtime par
  serveur). `mc-assets/` est re-seedable. Pense à un backup périodique du volume (snapshot
  OVH ou `tar` cron → stockage externe).
- Coolify se met à jour depuis son dashboard ; garde l'OS du VPS patché.

## Cloudflare (optionnel — protection L7 + IP d'origine cachée)

L'anti-DDoS OVH suffit pour démarrer. Si tu ajoutes Cloudflare :
- Mets `api.artisanmc.net` et `app.artisanmc.net` en **proxy (nuage orange)** → cache l'IP,
  absorbe le L7. WebSockets supportés en plan gratuit.
- **Piège** : CF gratuit limite chaque requête à **100 Mo**. Les **uploads de bundles /
  custom-items** (plugin → backend) et le **téléchargement du resource pack** (joueurs)
  peuvent dépasser. Mitigation : crée `bundles.artisanmc.net` en **DNS only (nuage gris)**
  vers le VPS, et bascule côté backend :
  - `BUNDLE_BASE_URL=https://bundles.artisanmc.net`
  - `RESOURCE_PACK_BASE_URL=https://bundles.artisanmc.net`
  - et le WS plugin sur `wss://bundles.artisanmc.net/ws/plugin` (custom-items passent par le WS).
  Ce sous-domaine reste couvert par l'anti-DDoS OVH.
- Firewall le VPS pour n'accepter le 80/443 que depuis les [IPs Cloudflare](https://www.cloudflare.com/ips/)
  (sauf le port du sous-domaine gris si tu veux l'exposer largement).
