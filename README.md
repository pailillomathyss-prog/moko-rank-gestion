# Bot Discord — gestion par niveaux

Bot Discord de gestion : 42 actions `/gestion`, 6 commandes `/acces` et une aide par niveau.

## Installation

1. Crée une application dans le portail développeur Discord et ajoute un bot.
2. Active **Server Members Intent**.
3. Invite le bot avec les scopes `bot` et `applications.commands`. Accorde uniquement les permissions utiles : Gérer les rôles/salons/messages/surnoms, Modérer/Expulser/Bannir des membres, Déplacer/Rendre muet/Mettre en sourdine des membres, Voir les salons, Lire l’historique, Envoyer des messages, Intégrer des liens et Se connecter en vocal. Il n’a pas besoin d’Administrateur.
4. Définis `DISCORD_BOT_TOKEN` dans les variables d’environnement de l’hébergeur. `DATA_DIR` est facultatif, sa valeur par défaut est `./data`.
5. Lance `pnpm install`, puis `pnpm start` (ou `npm install`, puis `npm start`).
6. Le propriétaire configure les niveaux avec `/acces role`.

Utilise un stockage persistant pour `DATA_DIR` chez l’hébergeur afin de conserver les réglages et la progression après un redémarrage.

## Retrait du système Jail

Les commandes Jail et la surveillance automatique ont été supprimées. Au démarrage, le bot remplace les commandes du serveur par `/gestion`, `/acces` et `/aide`, ce qui retire l’ancienne commande `/jail`.

Les données SQLite, anciens rôles, salons et restrictions ne sont pas effacés. Les membres déjà restreints ne sont pas libérés automatiquement : un responsable peut retirer manuellement le rôle Jail dans Discord. Le fichier `jail.sqlite` garde son nom pour préserver les réglages de gestion et l’historique existants.

## Niveaux de gestion

Les niveaux sont cumulatifs et enregistrés séparément pour chaque serveur :

| Niveau | Accès par défaut |
| --- | --- |
| 0 — Membre | Informations serveur/membre/rôle/salon, ping, aide |
| 1 — Assistant | Avertir, consulter les avertissements |
| 2 — Modérateur | Timeout/untimeout, expulsion, surnoms, historique, retrait d’avertissement, nettoyage/épingles, mode lent/verrouillage, gestion vocale |
| 3 — Administrateur | Bannir/débannir/lister les bans, annonces, création/modification/suppression des salons et rôles ordinaires |
| 4 — Propriétaire | Toutes les commandes et configuration des accès |

Seul le véritable propriétaire Discord obtient automatiquement le niveau 4.
**Migration de l’ancien bot :** aucun rôle existant ne reçoit automatiquement un niveau, même avec Administrateur ou Gérer le serveur. Le propriétaire doit les associer explicitement. Les rôles Jail et de progression ne peuvent pas devenir des rôles de gestion.

Exemples :

```text
/acces role role:@Assistants niveau:1
/acces role role:@Modérateurs niveau:2
/acces role role:@Administrateurs niveau:3
/acces logs salon:#logs-gestion
/acces commande commande:moderation.bannir niveau:4
/acces reinitialiser-commande commande:moderation.bannir
/acces voir
/aide
```

`niveau:0` retire une association. Un membre avec plusieurs rôles reçoit le niveau le plus élevé.
Un seuil peut être relevé, jamais abaissé sous le minimum de sécurité. Le nom exact des clés et leur niveau courant figurent dans `/aide`.

### Catalogue `/gestion`

- **info** : serveur, membre, role, salon, ping.
- **moderation** : avertir, avertissements, historique, retirer-avertissement, timeout, untimeout, expulser, bannir, debannir, bannissements, surnom, reset-surnom.
- **messages** : nettoyer, annoncer, epingler, desepingler.
- **salons** : creer-texte, creer-vocal, creer-categorie, renommer, sujet, ralentir, verrouiller, deverrouiller, deplacer, limite-vocale, supprimer.
- **roles** : creer, renommer, couleur, donner, retirer, supprimer.
- **vocal** : deplacer, deconnecter, muet, sourd.

Discord affiche les paramètres au moment de saisir la commande. Les commandes restent visibles dans le sélecteur Discord, mais chaque exécution est contrôlée côté bot.

### Protections et limites

- Impossible d’agir sur soi, le propriétaire, le bot, ou un membre de niveau/rôle égal ou supérieur (sauf le propriétaire pour la hiérarchie de l’acteur). Le bot doit toujours dépasser la cible.
- Les rôles gérés par intégration, les rôles d’accès et Jail, et **tous les rôles ayant des permissions** ne sont pas modifiables via les commandes de rôles. Leur administration reste manuelle dans Discord pour éviter les élévations de privilèges.
- Expulsion, bannissement, nettoyage et suppression nécessitent `confirmer:true`. Les suppressions sont irréversibles. Pas de destruction massive, de bannissement collectif, ni d’attribution automatique d’Administrateur.
- Les salons Jail et de logs sont protégés. Une catégorie doit être vide avant suppression.
- Le verrouillage sauvegarde les anciens droits `@everyone` puis les restaure. Les permissions explicites d’autres rôles et les administrateurs peuvent contourner ce verrouillage.
- Timeout : maximum 28 jours. Nettoyage : maximum 100 messages de moins de 14 jours. Historiques et bans : 15 entrées par affichage.
- Les avertissements et l’historique sont conservés en SQLite dans `DATA_DIR`, y compris après redémarrage. Les logs de gestion sont configurables.
- Ce bot ne couvre pas toutes les fonctions possibles de Discord : pas de tickets, musique, économie ou sauvegarde complète du serveur.
