# L'éditeur comme éditeur de YAML assisté — le schéma est une option, pas un péage

**Statut :** accepté (2026-07-27) — **implémenté (2026-07-28/29)** : hints
visibles + commentaires par clé (⑥⑨), Config typée par model déclaré, onglet
YAML sur les écrans de config **et** dans le panneau Données (⑦⑧), `@clé` dans
les actions de data source (④, plugin + contrat éditeur verrouillé par test).
Restent non faits : l'onglet YAML sur les documents du canvas (⑧, suite
annoncée) et les cercles ②③ (fichiers de plugins tiers). Révise `module-config-screens` §2, `bare-data-files` ⑦ et
`action-dsl` (texte des actions de data source) ; livre partiellement le
« code mode » déféré par `files-first-source-of-truth`.

## Contexte

Les Config screens ont été construits sur la prémisse « un écran édite une
Table/Config **à model déclaré** ». À l'usage immédiat, deux frictions :

- Un fichier de réglages sans model déclaré donnait un **formulaire vide** —
  et pire, une sauvegarde le **vidait** (le writer sérialise contre la liste de
  champs du model ; liste vide ⇒ `{}`). Incident réel le 2026-07-27,
  `shop_settings.yaml` réduit à `{}` ; même piège latent sur une table dont le
  model déclaré n'est pas encore livré par la Presence (rows réduites à `[{}]`).
- Le propriétaire veut pouvoir **commenter ses champs** et **basculer entre le
  YAML et le formulaire**, constatant que « c'est toujours plus intuitif de
  passer par de la config » — une config, elle, *montre* ses explications.

D'où le renversement d'accent proposé : ce qu'on édite, ce sont des **fichiers
YAML** ; le schéma n'est qu'une couche d'assistance posée dessus.

## Décisions

**① Le schéma est une amélioration progressive.** Le travail minimum d'un
développeur pour rendre sa config éditable est d'**exposer son fichier** ; il
peut ensuite déclarer un schéma pour gagner libellés, descriptions et
contraintes. Un fichier sans schéma est éditable, jamais une impasse : ses
clés apparaissent comme **champs littéraux** typés d'après les valeurs
stockées. *Révise `module-config-screens` §2* (« une Table/Config à model
déclaré » n'est plus un prérequis). *Rejeté :* exiger un model — c'est un péage
qui interdit précisément le cas d'entrée de gamme visé.

**② Sans schéma résoluble, les valeurs voyagent verbatim.** La sérialisation
pilotée par les champs ne s'applique que si des champs existent. C'est la
correction de l'incident ci-dessus, hissée au rang de règle : *les valeurs
sont la donnée de l'utilisateur, le schéma n'est qu'une lecture d'icelles.*

**③ La localisation du fichier décide de ses garanties.** Pas de réglage par
fichier : dans une racine de project ⇒ versionné, historique, éditable hors
ligne, divergence résolue ; hors project ⇒ live-only, sans filet. Le
développeur choisit **où poser son fichier**, les garanties suivent — et
`addon-owned-project-roots` lui permet de placer sa racine de project **chez
lui** (`plugins/Boutique/editor/`), donc sans arbitrer entre « mon dossier » et
« le dossier d'Artisan ». L'asymétrie est **affichée** dans l'écran : c'est une
propriété choisie, pas un détail d'implémentation.

**④ L'i18n suit le consommateur, pas le fichier.** Un contenu consommé par le
runtime d'Artisan (menus, dialogs, sources bindées) vit dans une racine de
project et se traduit via ses `lang/<code>.yaml`, au même endroit. Un fichier
consommé par son propre plugin (son `config.yml`) est du texte littéral pour
nous : sa traduction est l'affaire de son propriétaire, et nous n'écrivons
jamais de clés dans le dossier d'autrui. *Rejeté :* un scope de langue global
`plugins/Artisan/lang/` pour le contenu des autres — traductions et fichier
traduit se retrouveraient dans deux dossiers différents, incohérent et
lock-in.
> Corollaire qui **révise `action-dsl`** : une action de data source **peut**
> porter `@clé` (le mécanisme existe déjà de bout en bout —
> `DslText.Ref` → `{i18n:clé}` → `ActionExecutor.resolveText`), *parce que*
> ces sources sont consommées par Artisan. Manque uniquement le passage du
> `langMap` du project à `api.actions.execute`, qui construit aujourd'hui un
> `ExecutionContext` sans langue. La clé reste **explicite** (jamais dérivée
> d'une position dans la chaîne — la fragilité déjà refusée par `files-first` ④).

**⑤ Deux sortes de racines, comme une rampe.** Racine simple (« expose ton
yml, tu as un éditeur ») → racine de project (« adopte la structure, tu gagnes
historique et hors-ligne »). Le cercle ③ de `module-config-screens` (fichiers
de plugins tiers) n'est ouvert **qu'aux modules consentants** qui déclarent
leur fichier ; jamais sur un plugin non-consentant sans `reload_command`
déclaré.

**⑥ On ne se bat pas avec les commentaires — on les génère.** Les commentaires
utilisateur ne sont **pas** préservés ; les `label`/`description` du schéma
sont projetés en commentaires **au-dessus de chaque clé** (application de
`bare-data-files` ⑦ tel qu'écrit — le code les regroupait en bloc d'en-tête) et
régénérés à chaque écriture. L'en-tête généré **dit franchement** que les
commentaires écrits main sont écrasés. *Rejeté après examen :* l'écriture
préservante par patch chirurgical (CST) — le domaine ne retient pas la forme
écrite (`positionsSpec` réduit `[1,2,3]` et `"1-3"` à la même chaîne, un
`title:` string devient des layers, les templates sont résolus à l'import),
donc la préserver exigerait soit la provenance de chaque sucre dans le domaine
(la double représentation démolie par `files-first`), soit un appariement
d'identité par type de document. Écarté pour un bénéfice discutable : qui
commente un menu à la main ?

**⑦ Deux modes, une seule vérité par fichier.**
- Nos fichiers : formulaire **et** onglet YAML, les deux écrivant en
  **canonique** (canonicalisation immédiate, y compris depuis l'onglet YAML).
- Fichier étranger : onglet YAML **seul**, écriture **verbatim** (le texte vu
  est le texte envoyé) ; le formulaire, s'il existe grâce à un schéma déclaré,
  est en **lecture seule** et ne peut pas enregistrer — sinon la
  canonicalisation détruirait la config de son propriétaire.
- **YAML invalide** ⇒ l'onglet Formulaire devient indisponible (erreur + ligne),
  l'onglet Code reste éditable, et **l'enregistrement reste possible** : c'est
  ton fichier. Transposition du pattern déjà validé dans `ActionFieldEditor`
  (Visuel/Code sur la même chaîne, repli sur le texte si le parse échoue).
  *Rejeté :* bloquer l'enregistrement (l'éditeur se ferait gardien de ce qui ne
  lui appartient pas) et figer le formulaire sur la dernière version valide
  (afficher une donnée périmée à côté du texte réel — la dualité qui a produit
  l'incident du jour).

**⑧ Portée de l'onglet YAML** : écrans de config de module **et** panneau
Données du canvas — le même fichier édité par deux surfaces ne peut pas avoir
deux comportements. Les documents du canvas (menus, dialogs, commandes) sont
la suite naturelle, ouverte sur demande d'usage.

**⑨ Le libellé n'efface pas la clé.** Dans le formulaire, la description
devient **visible sous le champ** (fini l'infobulle), et le **nom technique
reste affiché** à côté du libellé : c'est la clé réelle du fichier, celle qu'on
cherche en SSH. Un seul vocabulaire entre l'écran et le disque.

## Conséquences

- L'incident « fichier vidé à `{}` » devient structurellement impossible : sans
  schéma, rien n'est filtré.
- Le cercle ② (formulaire read-only sur config tierce) et une forme utile du
  cercle ③ (édition verbatim par l'onglet YAML) deviennent atteignables **sans**
  écriture préservante — c'était le prérequis annoncé par
  `module-config-screens` ④, ici contourné plutôt que payé.
- Un menu écrit à la main perd ses commentaires à la première sauvegarde depuis
  le canvas. C'était déjà vrai ; ça devient une règle explicite.
- Question ouverte inchangée : « live-only généralisé au canvas » (le serveur
  comme seul store) reste à griller séparément.

## Alternatives rejetées à la racine

- **Le texte du fichier comme copie de travail permanente** (patch chirurgical
  partout) : envisagé et retenu en début de session, puis abandonné avec
  l'abandon des commentaires utilisateur — le coût n'avait plus de contrepartie.
- **Interdire l'édition hors project** : cohérent mais ferme la trajectoire
  « brancher Artisan sur l'existant », qui est la raison d'être du dispositif.
