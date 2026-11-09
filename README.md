# Devinettes — bot Discord Python

Bot complet en **Python 3.11+ / discord.py** : images locales, calculs générés,
réponses chronométrées, points persistants et configuration par serveur.
Il remplace l’ancien bot JavaScript de quotas ; aucune commande de rôles,
Jail ou gestion n’est conservée. Les anciennes bases et ressources Discord
ne sont pas supprimées.

## Démarrage rapide sur Replit

Dans ce projet, les dépendances et le workflow **Discord — Devinettes** sont
déjà configurés. Il reste à fournir le token et à inviter le bot.

1. Dans **Secrets**, ajouter `TOKEN` avec le token du bot. Ne jamais le coller
   dans un fichier versionné ou dans le chat. `DISCORD_BOT_TOKEN` reste accepté
   pour compatibilité si `TOKEN` n’existe pas.
2. Dans le portail Discord, activer **Message Content Intent** (voir ci-dessous).
3. Lancer le workflow **Discord — Devinettes** avec Run. Il exécute :
   `cd moko-rank-gestion && python main.py`.
4. Dans Discord, un administrateur lance `/config salon salon:#jeu`,
   puis `/config activer`.
5. Par défaut, au 15e message de membre dans ce salon, une image apparaît.
   Le premier qui répond juste en 20 secondes gagne un point.

Pour une nouvelle importation du dépôt à sa racine :

```sh
python -m pip install -r requirements.txt
python main.py --check
python main.py
```

**Run dans l’éditeur n’est pas une garantie de fonctionnement 24 h/24.**
Un bot Discord doit tourner comme processus permanent, pas comme site statique
ni comme serveur qui s’éteint sans requêtes. Replit propose des Reserved VM pour
les processus permanents, mais le disque des apps publiées n’est pas un stockage
SQLite durable garanti entre redémarrages/publications. Cette version conserve
SQLite conformément au cahier des charges : pour une utilisation permanente,
choisir un hébergeur avec volume persistant et définir `DATA_DIR` vers ce volume.
Ne pas republier sur un disque éphémère en supposant que les points survivront.
Une migration vers un stockage géré nécessiterait un changement explicite.

Documentation Replit :
- https://docs.replit.com/core-concepts/project-editor/app-setup/secrets
- https://docs.replit.com/features/publishing/deployment-types

### Si tu utilises encore Fade Host

**Ce dépôt est maintenant Python, plus Node.js.** Choisir un environnement
Python 3.11 ou supérieur dans le panneau :

- Installation / build : `python -m pip install -r requirements.txt`
- Démarrage : `python main.py`
- Secret : `TOKEN` (ou l’ancien `DISCORD_BOT_TOKEN`)
- Stockage : `DATA_DIR` sur le disque persistant de l’hébergeur.

Ne plus utiliser `npm start` : l’ancien `package.json` a été retiré. Une
publication de code ne change pas automatiquement les réglages Fade Host.

## Configuration dans Discord Developer Portal

1. Ouvrir https://discord.com/developers/applications et créer une application
   (ou utiliser celle de l’ancien bot).
2. Dans **Bot**, récupérer le token et le placer uniquement dans les secrets
   de l’hébergement. Régénérer le token s’il a déjà été exposé.
3. Dans **Privileged Gateway Intents**, activer **MESSAGE CONTENT INTENT**.
   Il permet de lire les tentatives de réponses. **Server Members Intent**
   et **Presence Intent** ne sont pas nécessaires.
4. Dans **OAuth2 → URL Generator**, choisir les scopes **bot** et
   **applications.commands**.
5. Permissions à accorder : **View Channels**, **Send Messages**,
   **Embed Links**, **Attach Files**, **Read Message History**.
   La permission **Administrator** n’est pas nécessaire pour le bot.
6. Ouvrir le lien généré et inviter le bot dans le serveur. Vérifier les
   permissions particulières du salon, qui peuvent annuler celles du rôle.
7. Au démarrage, le bot efface ses anciennes commandes **globales**, puis remplace
   toutes ses commandes dans chaque serveur par `/config`, `/points`,
   `/classement` et `/monrang`. Il conserve ses définitions locales pendant le
   nettoyage. Cela ne touche pas les commandes des autres bots.
   Si la synchronisation échoue, la console
   indique le serveur concerné ; corriger l’invitation puis redémarrer.

**Important : pousser sur GitHub ne modifie pas Discord tout seul.** Le nouveau
processus Python doit démarrer avec le token de la même application Discord.
Arrêter l’ancienne instance sur l’autre hébergeur, sinon elle peut réinscrire
les anciennes commandes. La console doit afficher « Anciennes commandes globales
supprimées » puis « anciennes commandes remplacées » pour le serveur. Discord
peut conserver le menu en cache un court moment ; fermer puis rouvrir le menu
des commandes après la synchronisation. Un token d’un autre bot ne permet pas
de supprimer les commandes de l’ancien.

Seuls les membres ayant **Administrateur** dans Discord utilisent `/config`.
Les contrôles sont effectués à chaque exécution, pas uniquement dans le menu.

## Commandes

| Commande | Fonction |
| --- | --- |
| `/points` | Mes points dans ce serveur |
| `/points membre:@Quelquun` | Points d’un autre membre |
| `/classement` | Top 10 avec pseudos, points et positions |
| `/monrang` | Ma position, ou indication que je ne suis pas encore classé |
| `/config salon salon:#jeu` | Choisir le salon textuel ; ne l’active pas implicitement |
| `/config frequence messages:15` | Fréquence de 1 à 1 000 messages |
| `/config temps secondes:20` | Chronomètre de 5 à 300 secondes |
| `/config activer` | Activer après vérification du salon et des permissions |
| `/config desactiver` | Mettre en pause sans effacer points ou compteur |
| `/config statut` | État, salon, fréquence, durée et compteur courant |

Les points et réglages sont **séparés par serveur**. Les égalités partagent le
même rang (1, 1, 3…). Les pseudos du classement sont ceux présents dans le cache
Discord ou, à défaut, ceux enregistrés lors de la dernière victoire.

## Règles du jeu

- **30 illustrations** d’animaux, fruits, aliments, objets et nature, associées
  explicitement à leurs réponses et synonymes.
- Environ une question sur cinq est un calcul : addition, soustraction ou
  multiplication, dessiné dans une image. Résultats entiers positifs ou nuls.
- Les dix dernières devinettes de chaque serveur sont évitées lors du tirage.
- Images attachées sous le nom neutre `devinette.png`, sans réponse dans
  le nom du fichier. Aucune API d’image ni clé payante nécessaire.
- Accents, casse, articles et pluriels simples acceptés. Une petite faute
  d’un caractère est tolérée pour les réponses d’au moins cinq caractères.
  Les résultats de calcul sont comparés exactement ; aucune expression reçue
  n’est exécutée.
- Un seul gagnant reçoit **+1 point**. La victoire affiche le pseudo, la réponse,
  le temps à deux décimales et le total. Le temps est calculé entre les
  horodatages Discord de l’image et de la réponse.
- À expiration, la réponse est révélée. La vérification tourne toutes les
  secondes : l’affichage peut avoir un léger délai, mais aucune réponse
  horodatée après l’échéance n’est acceptée.
- Le message de l’image est transformé en embed vert de victoire ou orange
  d’expiration. Modifier ce même message permet de réessayer l’annonce sans
  publier plusieurs félicitations ni attribuer plusieurs points.

## Compteur et redémarrages

- Tous les nouveaux messages ordinaires des membres dans le salon choisi
  comptent, **tentatives comprises**. Bots, webhooks, messages système et lignes
  commençant par `/` ou `!` sont exclus. Les slash commands ne sont pas des
  messages ordinaires.
- Une seule devinette est active par serveur. Les messages pendant la partie
  alimentent le compteur de la suivante ; le surplus est conservé.
- Le compteur est consommé seulement une fois l’image envoyée et le round
  activé en base. Un échec d’envoi conserve donc la progression et est retenté
  après 30 secondes.
- SQLite enregistre les points, la configuration, le compteur, les identifiants
  des messages traités, l’échéance et le résultat des parties.
- Un redémarrage reprend une partie active avec son échéance originale. Si
  l’échéance est dépassée, le bot révèle la réponse sans prolonger le temps.
- Les messages envoyés pendant l’arrêt du bot ne sont pas rejoués : il ne peut
  pas déterminer de façon fiable le premier gagnant d’une période hors ligne.
- Si l’arrêt survient exactement entre l’envoi HTTP de l’image et la sauvegarde
  de son identifiant, la partie incomplète est abandonnée sans point, le compteur
  reste intact et une nouvelle question est lancée. Une ancienne image peut
  alors rester visible : elle ne correspond plus à une partie active.
- Désactiver le jeu ou changer de salon interrompt la partie courante sans
  point ; le compteur restant est conservé. Fréquence et durée modifiées
  s’appliquent aux prochaines parties.
- L’enregistrement du gagnant et du point est une seule transaction. Un échec
  d’annonce ne supprime pas le point ; l’annonce est retentée.
- Utiliser **une seule instance** du bot pour ce fichier de données.

La base se trouve dans `DATA_DIR/quiz.sqlite` (par défaut `data/` à côté de
`main.py`). Pour une sauvegarde simple, arrêter proprement le bot puis copier
le dossier `data/`. Aucun token, contenu des conversations ou mot de passe
n’est enregistré en base ; seuls les IDs, pseudos de gagnants et données du jeu
le sont. Les anciennes bases `activity.sqlite` / `jail.sqlite` ne sont pas lues.

## Fichiers

```text
main.py                    Entrée du programme et validation hors ligne
requirements.txt           Dépendances Python épinglées
quiz/discord_bot.py        Commandes, événements et embeds Discord
quiz/engine.py             Déclenchement, réponses, temps et reprise
quiz/storage.py            SQLite asynchrone et transactions
quiz/questions.py          Choix, tolérance des réponses et rendu PNG
assets/questions.json     Banque avec réponses et synonymes
assets/*.png              30 images locales Twemoji
assets/checksums.json      Contrôle d’intégrité et des doublons
assets/ATTRIBUTION.md      Licence CC BY 4.0 et source des illustrations
scripts/download_images.py Réimportation facultative des images officielles
tests/                    Tests sans token ni serveur réel
```

## Vérification et dépannage

```sh
python main.py --check
python -m unittest discover -s tests -v
```

Les tests couvrent les commandes et leurs contrôles d’accès, les points et rangs,
les réponses simultanées, le seuil des 15 messages, les exclusions, la durée,
les pannes d’envoi, les redémarrages, la persistance et toutes les images.
Ils simulent Discord : une connexion réelle demande un token et un serveur
d’essai. `--check` ne prétend pas connecter le bot.

- **Token absent ou invalide** : vérifier les Secrets, jamais publier sa valeur.
- **PrivilegedIntentsRequired** : activer Message Content Intent.
- **Aucune question** : `/config statut`, vérifier le salon, l’activation,
  le compteur et les permissions du bot.
- **Réponses non reconnues** : vérifier Message Content Intent et les synonymes
  dans `assets/questions.json`.
- **Image absente** : conserver le dossier `assets/` et la permission Attach Files.
- **Erreur SQLite** : vérifier le chemin, le disque disponible et les droits
  d’écriture. Ne jamais supprimer la base pour « réparer » sans sauvegarde.
- Les avertissements `PyNaCl` / `davey` indiquent que l’audio vocal n’est pas
  installé ; ce jeu n’utilise pas le vocal et n’en a pas besoin.
