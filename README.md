# Bot Discord — rôles et quotas d’activité

Le système précédent de gestion et de permissions est retiré. Ce bot propose uniquement `/activite panel`, `/activite progression` et `/activite guide`.

## Installation sur Fade Host

1. Utiliser Node.js 22 ou supérieur et la branche `main`.
2. Installer les dépendances avec `npm install`, puis démarrer avec `npm start`.
3. Définir `DISCORD_BOT_TOKEN` dans les variables sécurisées de l’hébergeur.
4. Activer **Server Members Intent** dans le portail développeur Discord. Message Content Intent n’est **pas** nécessaire : le bot ne lit pas le contenu des messages.
5. Inviter le bot avec les scopes `bot` et `applications.commands`. Permissions : **Gérer les rôles**, **Voir les salons**, **Envoyer des messages** et **Intégrer des liens**.
6. Placer le rôle du bot au-dessus des rôles d’activité. Ne pas utiliser de rôles avec des permissions de modération ou d’administration : le bot accepte uniquement des rôles sans permissions.
7. Conserver `DATA_DIR` sur un disque persistant (par défaut `./data`). La nouvelle base est `activity.sqlite`. L’ancienne base et les anciens rôles/salons ne sont pas effacés.

Au démarrage, le bot remplace les anciennes commandes du serveur. Les anciens niveaux de permissions du bot ne sont plus utilisés. Seuls le propriétaire et les membres avec la permission Discord **Administrateur** peuvent configurer le panneau. Les autres membres ont accès au guide et à leur progression.

## Panneau Discord

Lancer `/activite panel` :

1. Sélectionner un palier de 1 à 15.
2. Choisir son rôle Discord dans le sélecteur de rôles.
3. Cliquer **Modifier les quotas** pour fixer les quatre valeurs : messages et heures pour l’obtenir, puis messages et heures par jour pour le garder.
4. Utiliser **Désactiver sans retirer** pour arrêter le suivi de ce rôle sans le supprimer des membres.

Un palier sans rôle est inactif. Le même rôle ne peut pas être associé à plusieurs paliers. Les quotas se sauvegardent immédiatement et persistent après redémarrage. Les modifications s’appliquent aux prochaines vérifications, y compris la prochaine vérification quotidienne. Remplacer le rôle d’un palier laisse l’ancien rôle aux membres et arrête son suivi.

## Quotas proposés, tous modifiables

| Palier | Messages pour obtenir | Heures vocales pour obtenir | Messages quotidiens | Heures vocales quotidiennes |
| --- | ---: | ---: | ---: | ---: |
| 1 | 500 | 10 | 150 | 2 |
| 2 | 1 000 | 20 | 200 | 2,5 |
| 3 | 1 500 | 30 | 250 | 3 |
| 4 | 2 000 | 40 | 300 | 3,5 |
| 5 | 2 500 | 50 | 350 | 4 |
| 6 | 3 000 | 60 | 400 | 4,5 |
| 7 | 3 500 | 70 | 450 | 5 |
| 8 | 4 000 | 80 | 500 | 5,5 |
| 9 | 4 500 | 90 | 550 | 6 |
| 10 | 5 000 | 100 | 600 | 6,5 |
| 11 | 5 500 | 110 | 650 | 7 |
| 12 | 6 000 | 120 | 700 | 7,5 |
| 13 | 6 500 | 130 | 750 | 8 |
| 14 | 7 000 | 140 | 800 | 8,5 |
| 15 | 7 500 | 150 | 850 | 9 |

Dans les deux cas, c’est toujours **messages OU vocal**, jamais les deux obligatoires. Les rôles se cumulent : chaque palier atteint peut attribuer son rôle. Les valeurs élevées sont des suggestions, pas une obligation ; adapte-les à ta communauté.

## Obtention, maintien et reset

- Les messages et le vocal sont cumulés sur des périodes fixes de **14 jours**, ancrées au jour d’initialisation du serveur. La date du prochain reset apparaît dans le panneau et la progression.
- Le premier palier donne le rôle après **500 messages OU 10 h de vocal**.
- Le maintien commence **le lendemain de l’obtention**, sur une journée complète. Exemple : rôle obtenu lundi à 18 h → mardi, atteindre **150 messages OU 2 h de vocal** → contrôle mercredi à minuit.
- Si les deux compteurs sont sous leurs seuils, le rôle est retiré. Il ne pourra être regagné qu’à la période suivante, pour éviter une réattribution immédiate avec les anciens compteurs.
- Les journées vont de minuit à minuit en **Europe/Paris**, changements d’heure inclus.
- Le reset remet à zéro la progression affichée, mais ne retire pas les rôles à lui seul. Le maintien quotidien continue.
- Le contrôle a lieu environ toutes les minutes. Il peut prendre plus de temps selon le nombre de membres et les limites de l’API Discord.
- Un rôle déjà présent avant que le bot l’attribue reste manuel : le bot ne le retire pas. Retirer manuellement un rôle géré le bloque également jusqu’à la prochaine période.

## Comptage et pannes

- Un message maximum par membre toutes les **10 secondes**, tous salons confondus. Bots, webhooks et messages système exclus. Aucun contenu de message n’est conservé.
- Le vocal compte même seul ou muet, sauf dans le salon AFK configuré sur le serveur. Bots exclus. Les transitions entre salons ne doublent pas les heures.
- Le temps vocal est enregistré environ toutes les minutes et réparti entre les bonnes journées à minuit.
- Aucun temps n’est inventé pendant une panne. Une interruption détectée de plus de deux minutes exempte les journées affectées de retrait automatique pour ne pas sanctionner une activité non mesurée. Une déconnexion Discord détectée exempte également sa journée.
- Après redémarrage, le bot reprend le suivi des membres encore connectés, sans compter la durée d’arrêt. Jusqu’à une minute non enregistrée peut être perdue lors d’un arrêt brutal.
- En cas d’erreur Discord, l’action est signalée dans la console Fade Host et retentée lors d’une vérification suivante. Les rôles incompatibles ne sont jamais attribués.
- Les données d’activité sont conservées dans la base pour permettre les vérifications ; le reset de 14 jours est un changement de période de calcul, pas une suppression des données.

## Vérifications locales

`npm test` teste les seuils OU, les resets, les jours de maintien, les pannes, la persistance, le vocal et les éléments du panneau sans connexion à Discord.
