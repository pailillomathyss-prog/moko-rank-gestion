# Bot de gestion Discord

Bot minimal avec trois fonctions : gestion du staff, modération et brigade jail. Les commandes se lancent avec `/`.

## Démarrage

1. Crée une application Discord et active **Server Members Intent**.
2. Invite le bot avec les scopes `bot` et `applications.commands`. Accorde-lui les permissions nécessaires pour gérer les rôles, expulser/bannir des membres, gérer les messages et les timeouts.
3. Renseigne `DISCORD_BOT_TOKEN` dans l’environnement. `DATA_DIR` est facultatif et vaut `./data`.
4. Lance `pnpm install`, puis `pnpm start`.

Les commandes slash sont enregistrées dans chaque serveur au démarrage. `/help` affiche le guide.

## Commandes

- Staff : `/staff role`, `/staff ajouter`, `/staff retirer`, `/staff liste`.
- Modération : `/mod kick`, `/mod ban`, `/mod unban`, `/mod timeout`, `/mod untimeout`, `/mod clear`, `/mod warn`, `/mod warnings`, `/mod effacer_warnings`.
- Brigade : `/brigade role` définit le rôle autorisé ; `/brigade jail` configure le rôle de jail et le salon ; `/brigade etat` affiche la configuration.
- Jail : `/jail` place un membre en jail et `/unjail` le libère.

Les réglages et avertissements sont conservés dans SQLite. Les commandes vérifient les permissions Discord et la hiérarchie des rôles.
