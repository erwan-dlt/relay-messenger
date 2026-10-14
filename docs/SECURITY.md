# Sécurité et périmètre

## Protections mises en place

- Mots de passe hachés et salés avec `scrypt` (`node:crypto`). Aucune conservation de mot de passe en clair en base.
- Sessions aléatoires avec jetons cryptographiques ; seul le SHA-256 du jeton est sauvegardé. Expiration après 7 jours. Cookie `HttpOnly`, `SameSite=Strict`, `Secure` si `NODE_ENV=production`.
- Accès aux groupes et aux messages vérifié côté API, pour chaque lecture ou mutation. L'auteur d'un message est toujours déduit de la session.
- Requêtes SQLite paramétrées et intégrité référentielle activée. Suppression en cascade des adhésions et messages quand un groupe est supprimé.
- Origine vérifiée pour les requêtes mutantes, taille JSON limitée à 16 Ko, en-têtes de sécurité, limitation simple des tentatives de connexion.
- Les connexions Socket.IO utilisent les cookies de session HttpOnly déjà émis par l’API. Le serveur vérifie l’origine, refuse les sessions absentes/expirées et associe chaque socket uniquement à ses propres groupes. Le retrait d’un membre le désabonne immédiatement des messages du groupe, et la déconnexion invalide ses sockets.
- Les comptes, la base, les logs et les mots de passe locaux ne sont pas inclus dans Git.

## Ce qu'il faudrait renforcer avant un service public

1. Placer l'application derrière un proxy HTTPS et sécuriser configuration, sauvegardes et stockage persistant des données.
2. Migrer l'API SQLite expérimentale de Node 22 vers une version stable et introduire de vraies migrations de schéma.
3. Ajouter une protection anti-abus distribuée (IP / compte), de la journalisation structurée et un mécanisme de récupération de compte.
4. Ajouter des tests navigateur (Playwright) et un audit de dépendances après installation.
5. Prévoir un adaptateur partagé (Redis) pour Socket.IO en cas de déploiement avec plusieurs instances Node, et surveiller les connexions de longue durée.
6. Prévoir confidentialité, suppression de compte, rétention des messages et conformité réglementaire selon l'usage.
7. Ne pas laisser les identifiants des comptes de démo actifs sur un site accessible publiquement.

**Relay n'implémente pas de chiffrement de bout en bout.** Le backend et toute personne ayant un accès privilégié à la base peuvent techniquement lire les messages.
