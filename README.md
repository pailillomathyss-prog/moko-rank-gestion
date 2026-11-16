# Bot Discord de gestion

Bot Python à préfixe `+` : modération, avertissements, gestion des salons et
des rôles, rôles automatiques, niveaux, classements, giveaways interactifs et
menus d’aide. `+help` affiche les commandes et `+panel` ouvre le panneau
administrateur.

## Fade Host

Configurer le projet pour utiliser Python et lancer :

```sh
python -m pip install -r requirements.txt
python main.py
```

Dans les variables privées de Fade Host, définir `DISCORD_TOKEN` (ou `TOKEN`)
et, si nécessaire, `DATA_DIR` vers un volume persistant. Ne mets jamais le
jeton dans le dépôt ou dans le code. Active **Server Members Intent** et
**Message Content Intent** dans le portail Discord. Le bot a également besoin
des permissions correspondant aux commandes autorisées sur le serveur.

Au premier démarrage, les anciens avertissements, rangs, giveaways, réglages
et scores du bot précédent sont effacés une fois. Les données créées ensuite
sont conservées dans `DATA_DIR`. Le bot supprime aussi ses anciennes commandes
slash et utilise exclusivement le préfixe `+`.

## Commandes

| Catégorie | Commandes | Accès |
| --- | --- | --- |
| Aide / menu | `+help`, `+panel` | `+panel` : administrateur du serveur |
| Modération | `+clear`, `+kick`, `+ban`, `+unban`, `+mute`, `+unmute` | Permission Discord correspondante |
| Avertissements | `+warn`, `+unwarn`, `+warns`, `+clearwarns` | Gestion des messages ; purge : administrateur |
| Salons | `+lock`, `+unlock`, `+slowmode`, `+hide`, `+show`, `+nuke` | Gestion des salons ; recréation : administrateur |
| Rôles | `+addrole`, `+removerole`, `+autorole`, `+autoroleoff` | Gestion des rôles ; auto-rôle : administrateur |
| Giveaways | `+gstart`, `+gend`, `+greroll`, `+gpanel` | Administrateur |
| Niveaux | `+rank`, `+leaderboard`, `+lb`, `+setlevel`, `+resetrank` | Réglage des niveaux : administrateur |
| Propriétaires | `+own @membre` | Propriétaire actuel du bot uniquement |
| Informations | `+serverinfo`, `+userinfo`, `+botinfo`, `+ping` | Membres du serveur |

Les membres gagnent des XP sur les messages ordinaires, au maximum une fois par
minute. Les commandes et messages des bots ne donnent pas d’XP. Le panneau de
giveaway permet de créer un tirage et d’y participer par bouton ; les tirages
ouverts sont restaurés après un redémarrage.

Le propriétaire de l’application ou un propriétaire déjà ajouté peut utiliser
`+own @membre` pour ajouter un propriétaire de bot. Les administrateurs de serveur sont reconnus pour les
commandes d’administration ; les erreurs expliquent séparément si le bot
lui-même n’a pas les permissions ou la position de rôle requises.

## Vérification sans jeton

```sh
python main.py --check
python -m unittest discover -s tests -v
```

Ces commandes valident la configuration et les règles métier sans se connecter
à Discord. Il n’est pas nécessaire de communiquer le jeton à Replit.
