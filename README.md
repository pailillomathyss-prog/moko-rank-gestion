# Moko Rank

Bot Discord de progression par messages et temps passé en vocal. Le panneau de configuration est un message interactif dans Discord ; aucun site web n'est nécessaire.

## Paliers

Les deux seuils d'un palier doivent être atteints pendant le même cycle :

| Palier | Messages | Vocal |
| --- | ---: | ---: |
| 1 | 500 | 10 h |
| 2 | 1 500 | 20 h |
| 3 | 3 000 | 45 h |
| 4 | 6 000 | 65 h |
| 5 | 8 500 | 100 h |

Le bot attribue le rôle du palier le plus élevé configuré que le membre a atteint. Il retire seulement les autres rôles associés par ce bot. À chaque nouvelle période, les compteurs repartent à zéro et les rôles de rang configurés sont retirés.

Les périodes durent exactement 14 jours. Pour chaque serveur, la première période commence au premier démarrage du bot ; sa date de remise à zéro est conservée lors des redémarrages.

Le comptage commence lorsque le bot rejoint le serveur : Discord ne permet pas de reconstituer le temps vocal passé avant son installation. Les messages de bots et les commandes commençant par `+` ne sont pas comptés. Le vocal mesure le temps connecté à un salon vocal, sans exiger que le membre parle ; les bots et le salon AFK du serveur sont exclus.

## Commandes

- `+help` — affiche l'aide.
- `+stats` ou `+me` — affiche ta progression.
- `+stats @membre` — affiche la progression d'un membre.
- `+panel` — affiche les cinq menus pour choisir les rôles (permission **Gérer les rôles** requise).
- `+panel retirer 3` — retire l'association du palier indiqué.
- `+testpanel` ou `+test` — ouvre un panneau de test temporaire (permission **Gérer les rôles** requise).

Les rôles sont choisis dans les menus du panneau Discord. Le rôle du bot doit être placé au-dessus des rôles de rang dans les paramètres du serveur.

Dans le panneau de test, chaque message normal envoyé par la personne qui lance le test attribue le rôle du palier suivant, jusqu'au palier 5. Le test ignore le vocal et ne modifie pas les compteurs réels. Le bouton de fin restaure les rôles présents avant le test ; la restauration se fait aussi après 10 minutes d'inactivité ou si le bot redémarre.

## Configuration Discord

1. Crée une application dans le [portail développeur Discord](https://discord.com/developers/applications), ajoute un bot et copie son jeton dans les variables d'environnement du service Railway sous le nom `DISCORD_BOT_TOKEN`.
2. Dans **Bot**, active les intents privilégiés **Server Members Intent** et **Message Content Intent**.
3. Invite le bot dans le serveur avec les permissions **View Channels**, **Send Messages**, **Embed Links** et **Manage Roles**. Le bot doit aussi pouvoir voir les salons où les messages sont comptés.
4. Place le rôle du bot au-dessus des cinq rôles que tu veux attribuer.
5. Dans un salon du serveur, utilise `+panel`, puis sélectionne un rôle pour chaque palier.

Ne publie jamais le jeton Discord dans le dépôt ou dans un message. Pour un test local, copie `.env.example` vers `.env` et renseigne le jeton dans `.env`.

## Lancer en local

Prérequis : Node.js 22 ou supérieur et pnpm.

```sh
pnpm install
cp .env.example .env
pnpm start
```

Les données locales sont enregistrées dans `./data/moko-rank.sqlite`.

## Déployer sur Railway

Le dépôt contient `railway.json` avec les commandes d'installation et de démarrage. Crée un service Railway depuis ce dépôt, puis configure ces variables :

- `DISCORD_BOT_TOKEN` — jeton du bot Discord.
- `DATA_DIR=/data` — dossier persistant de la base.

Ajoute également un volume Railway monté sur `/data`. Sans volume persistant, les compteurs et les rôles choisis pourraient être perdus lors d'un redéploiement ou d'un redémarrage.

## Vérifications

```sh
pnpm test
```