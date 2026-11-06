# Bot de gestion Discord

Bot minimal avec trois fonctions : gestion du staff, modération et brigade jail. Les commandes se lancent avec `/`.

## Démarrage

1. Crée une application Discord et active **Server Members Intent**.
2. Invite le bot avec les scopes `bot` et `applications.commands`. Accorde-lui les permissions nécessaires pour gérer les rôles, expulser/bannir des membres, gérer les messages et les timeouts.
3. Renseigne `DISCORD_BOT_TOKEN` dans l’environnement. `DATA_DIR` est facultatif et vaut `./data`.
4. Lance `pnpm install`, puis `pnpm start`.

Les commandes slash sont enregistrées dans chaque serveur au démarrage. `/help` affiche quatre embeds privés : gestion du staff, modération, permissions de la brigade et étapes du jail.

## Commandes

- Staff : `/staff role`, `/staff ajouter`, `/staff retirer`, `/staff liste`.
- Modération : `/mod kick`, `/mod ban`, `/mod unban`, `/mod timeout`, `/mod untimeout`, `/mod clear`, `/mod warn`, `/mod warnings`, `/mod effacer_warnings`.
- Brigade : `/brigade role` définit le rôle autorisé ; `/brigade jail` configure le rôle de jail et le salon ; `/brigade etat` affiche la configuration.
- Jail : `/jail` place un membre en jail et `/unjail` le libère.

Les réglages et avertissements sont conservés dans SQLite. Les commandes vérifient les permissions Discord et la hiérarchie des rôles.

## Configuration du jail

1. Crée un rôle `Brigade`, un rôle `Jail` et un salon textuel réservé aux membres jailés.
2. Donne au rôle `Brigade` uniquement aux agents autorisés.
3. Avec la permission **Gérer le serveur**, lance `/brigade role role:@Brigade`.
4. Lance `/brigade jail role:@Jail salon:#jail`, puis vérifie avec `/brigade etat`.
5. Le bot applique les restrictions au rôle Jail dans les salons existants, en laissant l’accès au salon configuré. Il lui faut **Gérer les rôles** et son rôle doit être au-dessus du rôle Jail.
6. Un membre de la brigade ou un responsable lance `/jail membre:@Membre raison:Motif` pour jailer, puis `/unjail membre:@Membre` pour libérer.

Le jail est local à ce serveur : le bot ne consulte pas les autres serveurs d’un membre. Les autorisations accordées par d’autres rôles peuvent changer l’accès effectif aux salons. Après la création de nouveaux salons, relance `/brigade jail` afin d’y appliquer les restrictions.
