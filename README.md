# Bot Discord — gestion par niveaux et jail

Bot Discord de gestion : 42 actions `/gestion`, 6 commandes `/acces`, une aide par niveau et le système Jail restauré.

## Installation

1. Crée une application dans le portail développeur Discord et ajoute un bot.
2. Active **Server Members Intent**.
3. Invite le bot avec les scopes `bot` et `applications.commands`. Accorde uniquement les permissions utiles : Gérer les rôles/salons/messages/surnoms, Modérer/Expulser/Bannir des membres, Déplacer/Rendre muet/Mettre en sourdine des membres, Voir les salons, Lire l’historique, Envoyer des messages, Intégrer des liens et Se connecter en vocal. Il n’a pas besoin d’Administrateur.
4. Définis `DISCORD_BOT_TOKEN` dans les variables d’environnement de l’hébergeur. `DATA_DIR` est facultatif, sa valeur par défaut est `./data`.
5. Lance `pnpm install`, puis `pnpm start` (ou `npm install`, puis `npm start`).
6. Le propriétaire configure les niveaux avec `/acces role`, puis lance `/jail setup`.

Utilise un stockage persistant pour `DATA_DIR` chez l’hébergeur afin de conserver les réglages et la progression après un redémarrage.

## Configuration du serveur

`/jail setup` crée ou actualise :

- La catégorie privée `JAIL`.
- `#cellule-jail`, visible par les membres jailés et la brigade.
- `#logs-jail`, réservé à la brigade.
- Les rôles `Brigade Jail`, `Jail` et `Jail Rang 1` à `Jail Rang 5`.
- Un embed permanent dans `#cellule-jail` expliquant le motif, le contact de la brigade et la libération. Relancer `/jail setup` met à jour ce message.

Après le setup, le propriétaire lance `/acces role role:@Brigade Jail niveau:1`, puis donne manuellement le rôle Brigade aux agents. Vérifie que le rôle du bot est au-dessus des membres gérés, de `Jail` et de tous les rôles de rang. Le setup applique des refus d’accès au rôle Jail dans les salons actuels et dans les salons créés ensuite. Les permissions d’autres rôles peuvent modifier l’accès effectif.

## Niveaux de gestion

Les niveaux sont cumulatifs et enregistrés séparément pour chaque serveur :

| Niveau | Accès par défaut |
| --- | --- |
| 0 — Membre | Informations serveur/membre/rôle/salon, ping, aide, état Jail |
| 1 — Assistant | Avertir, consulter les avertissements, jail et libération |
| 2 — Modérateur | Timeout/untimeout, expulsion, surnoms, historique, retrait d’avertissement, nettoyage/épingles, mode lent/verrouillage, gestion vocale |
| 3 — Administrateur | Bannir/débannir/lister les bans, annonces, création/modification/suppression des salons et rôles ordinaires, configuration Jail et surveillance |
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
- Les avertissements et l’historique sont conservés en SQLite dans `DATA_DIR`, y compris après redémarrage. Les logs de gestion sont configurables ; ceux du jail restent dans `#logs-jail`.
- La détection automatique Jail ignore les membres ayant un niveau de gestion.
- Ce bot ne couvre pas toutes les fonctions possibles de Discord : pas de tickets, musique, économie ou sauvegarde complète du serveur.

## Commandes

- `/jail setup` — crée les rôles, salons et permissions du jail. Niveau requis : **Administrateur (3)**.
- `/jail etat` — affiche le guide et la configuration.
- `/jail mettre membre:@Membre raison:Motif` — jail un membre et enregistre le motif.
- `/jail liberer membre:@Membre` — retire le rôle Jail et attribue le rang suivant.
- `/jail surveillance activer:true` — dans un serveur surveillé, un responsable peut autoriser l’usage des événements d’arrivée par les communautés qui le configurent. `false` révoque immédiatement cet accord.
- `/jail serveurs ajouter id:...` — ajoute un serveur autorisé, scanne immédiatement les membres actuels et jail les correspondances; les nouvelles arrivées sont ensuite suivies.
- `/jail serveurs retirer id:...` et `/jail serveurs liste` — gère les serveurs surveillés.

Les commandes de mise en jail et de libération demandent au minimum le niveau Assistant (1). Le propriétaire et les membres ayant la permission Discord Administrateur ne peuvent pas être jailés.

À chaque libération avec un dossier de jail enregistré, le bot ajoute une progression en base SQLite et attribue le rang suivant, jusqu’au rang 5. Les rôles peuvent être renommés dans Discord; évite de les supprimer. Les actions sont journalisées dans `#logs-jail`.

## Détection inter-serveurs avec accord

Le bot ne peut pas vérifier un serveur à partir de son ID seul. L’équipe dirigeante de chaque serveur surveillé doit installer le bot et lancer `/jail surveillance activer:true`. Ensuite, un responsable de ton serveur l’ajoute avec `/jail serveurs ajouter`.

À l’ajout d’un ID autorisé, le bot récupère les listes de membres des deux serveurs, compare les IDs et jail les membres communs qui ne sont pas administrateurs. Le scan peut prendre du temps sur un grand serveur; son bilan apparaît dans `#logs-jail`. Ensuite, les arrivées dans ton serveur ou dans un serveur surveillé déclenchent une vérification individuelle. Le bot ne lance pas de scans périodiques. Les dossiers restent jusqu’à une libération manuelle par la brigade. Indique clairement cette surveillance aux membres selon les règles de chaque serveur. Active **Server Members Intent** dans le portail développeur Discord.
