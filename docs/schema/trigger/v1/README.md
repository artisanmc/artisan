# Artisan — Trigger schema v1

Un **Trigger** (`triggers/<id>.yml`) associe un **Game event** à une Action chain : « quand un joueur
meurt, envoie-lui sa position ». Décision : ADR `triggers-and-variables`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `schema.json` | JSON Schema (Draft 2020-12), source de vérité |
| `examples/death-coordinates.json` | Contexte d'événement dans un message, effet `keep_level`, condition `not`. |
| `examples/spawn-protection.json` | `cancel_event` filtré par deux conditions, délai par joueur. |
| `examples/welcome.json` | `set_event` dans les deux branches d'un `if`, textes traduits, `{player.last_seen.ago()}`. |

## Modèle

```
Trigger
 ├── on                 ← nom d'un Game event déclaré (catalogue core ou module)
 ├── if : Condition[]   ← AND, évaluées avec {event.…}
 ├── cooldown_seconds   ← par joueur, gardé en base (survit au redémarrage)
 ├── enabled
 └── do : Step[]        ← chaîne exécutée en ligne pendant l'événement
```

Les Game events et leur contexte typé sont déclarés côté plugin (`api.getGameEvents()`) et annoncés
à la Presence (`declared_game_events`). Le catalogue core est aussi dans
`testdata/core-game-events.json`, généré depuis `CoreGameEvents.kt`.

## Effets

Deux actions n'ont de sens que dans la chaîne d'un Trigger :

- `cancel_event` annule l'événement, s'il est annulable. Rien ne le désannule.
- `set_event: { <effet>: valeur }` écrit un effet que l'événement déclare (`join_message`,
  `keep_inventory`, `damage`…), avec la valeur résolue par template et convertie au type déclaré.
  Un texte est un LText comme tout texte affiché au joueur (`{i18n:clé}` ou `{fr: …, en: …}`) :
  un message de connexion, de départ ou de mort est envoyé à chaque joueur dans sa langue.

Ailleurs (un menu, une commande), elles avertissent et ne font rien.
