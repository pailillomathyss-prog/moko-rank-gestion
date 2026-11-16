# Supreme Bot — Discord

Bot de gestion Discord en **Node.js et discord.js**. Les commandes préfixées
par `+` couvrent la modération, les avertissements, les salons, les rôles,
les niveaux, les informations et les giveaways. `+help` affiche l’aide ;
`+panel` ouvre le menu interactif pour les administrateurs.

## Démarrage sur Fade Host

Le dépôt contient maintenant un `package.json` à sa racine :

- Installation : `npm install`
- Démarrage : `npm start`
- Variable d’environnement : `DISCORD_TOKEN` ou `TOKEN`
- Stockage persistant : `DATA_DIR` (par défaut `./data`)

Le token n’est jamais inscrit dans le code. Ajoute-le seulement aux variables
d’environnement privées de l’hébergeur. Active **Server Members Intent** et
**Message Content Intent** dans le portail Discord. Invite le bot avec le
scopes `bot` et `applications.commands` ainsi que les permissions dont les
commandes ont besoin.

Le bot doit conserver l’accès à son dossier `DATA_DIR` entre ses redémarrages.
Les avertissements, giveaways, niveaux et rôles automatiques y sont enregistrés
en JSON. N’exécute pas plusieurs copies du bot sur le même dossier.

## Remise à zéro effectuée au premier démarrage

Le premier lancement crée les fichiers de données vides et retire les données
du jeu précédent (`quiz.sqlite`) ainsi que les anciens avertissements, rangs,
giveaways et rôles automatiques présents dans `DATA_DIR`. Un marqueur empêche
de refaire cette remise à zéro aux redémarrages suivants.

Quand Discord se connecte, le bot retire les anciennes commandes slash globales
et propres aux serveurs. Ce nouveau bot utilise le préfixe `+`.

## Commandes principales

| Catégorie | Commandes | Permission |
| --- | --- | --- |
| Aide et panneau | `+help`, `+panel` | `+panel` : administrateur |
| Modération | `+clear`, `+kick`, `+ban`, `+unban`, `+mute`, `+unmute` | Selon la permission Discord correspondante |
| Avertissements | `+warn`, `+unwarn`, `+warns`, `+clearwarns` | Gestion des messages ; purge : administrateur |
| Salons | `+lock`, `+unlock`, `+slowmode`, `+hide`, `+show`, `+nuke` | Gestion des salons ; recréation : administrateur |
| Rôles | `+addrole`, `+removerole`, `+autorole`, `+autoroleoff` | Gestion des rôles ; rôle automatique : administrateur |
| Giveaways | `+gstart`, `+gend`, `+greroll`, `+gpanel` | Administrateur |
| Niveaux | `+rank`, `+leaderboard`, `+setlevel`, `+resetrank` | Réglages de rang : administrateur |
| Informations | `+serverinfo`, `+userinfo`, `+botinfo`, `+ping` | Membres du serveur |

Les membres gagnent de l’XP sur les messages ordinaires, au maximum une fois
par minute. Les commandes et les messages de bots ne donnent pas d’XP. Le
giveaway interactif permet de créer un tirage et de participer avec un bouton.

## Vérifications locales

```sh
node --check index.js
npm test
```

Ces vérifications ne connectent pas le bot à Discord et n’ont pas besoin du
token.
