# Bot Discord — système de jail

Bot Discord minimal consacré au jail, à la brigade et à la progression après libération.

## Installation

1. Crée une application dans le portail développeur Discord et ajoute un bot.
2. Active **Server Members Intent**.
3. Invite le bot avec les scopes `bot` et `applications.commands`. Il lui faut **Gérer les rôles** et **Gérer les salons**.
4. Définis `DISCORD_BOT_TOKEN` dans les variables d’environnement de l’hébergeur. `DATA_DIR` est facultatif, sa valeur par défaut est `./data`.
5. Lance `pnpm install`, puis `pnpm start` (ou `npm install`, puis `npm start`).
6. Dans ton serveur, un responsable lance `/jail setup`.

Utilise un stockage persistant pour `DATA_DIR` chez l’hébergeur afin de conserver les réglages et la progression après un redémarrage.

## Configuration du serveur

`/jail setup` crée ou actualise :

- La catégorie privée `JAIL`.
- `#cellule-jail`, visible par les membres jailés et la brigade.
- `#logs-jail`, réservé à la brigade.
- Les rôles `Brigade Jail`, `Jail` et `Jail Rang 1` à `Jail Rang 5`.

Après le setup, donne manuellement le rôle `Brigade Jail` aux agents. Vérifie que le rôle du bot est au-dessus de `Jail` et de tous les rôles de rang. Le setup applique des refus d’accès au rôle Jail dans les salons actuels et dans les salons créés ensuite. Les permissions d’autres rôles peuvent modifier l’accès effectif; vérifie la configuration de ton serveur.

## Commandes

- `/jail setup` — crée les rôles, salons et permissions du jail. Permission requise : **Gérer le serveur**.
- `/jail etat` — affiche le guide et la configuration.
- `/jail mettre membre:@Membre raison:Motif` — jail un membre et enregistre le motif.
- `/jail liberer membre:@Membre` — retire le rôle Jail et attribue le rang suivant.

Les commandes de mise en jail et de libération sont réservées au rôle `Brigade Jail` ou à une personne ayant **Gérer le serveur**. Le propriétaire et les administrateurs du serveur ne peuvent pas être jailés.

À chaque libération avec un dossier de jail enregistré, le bot ajoute une progression en base SQLite et attribue le rang suivant, jusqu’au rang 5. Les rôles peuvent être renommés dans Discord; évite de les supprimer. Les actions sont journalisées dans `#logs-jail`.

## Limite de détection inter-serveurs

Discord ne donne pas au bot la liste des membres d’un autre serveur simplement à partir de l’ID de ce serveur. Pour détecter automatiquement une appartenance, le bot doit avoir accès au serveur concerné et aux événements de membres appropriés. Sans cet accès, cette fonctionnalité ne peut pas être vérifiée ni automatisée. Le bot ne sonde pas les serveurs externes.
