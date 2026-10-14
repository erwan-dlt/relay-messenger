# API REST — Relay

Toutes les routes commencent par `/api`. Les requêtes mutantes acceptent `Content-Type: application/json`, renvoient une réponse JSON et exigent une origine autorisée. Après connexion, le navigateur envoie automatiquement le cookie `relay_session` (HttpOnly, SameSite=Strict). Le cookie est stocké dans la base sous forme de hash ; la valeur brute n'est pas conservée.

| Méthode | Route | Authentification | Rôle | Objet |
| --- | --- | --- | --- | --- |
| GET | `/health` | Non | — | Test de disponibilité |
| POST | `/auth/register` | Non | — | Créer un compte et ouvrir une session |
| POST | `/auth/login` | Non | — | Ouvrir une session |
| GET | `/auth/me` | Oui | Utilisateur | Identité courante |
| POST | `/auth/logout` | Oui | Utilisateur | Fermer la session |
| GET | `/groups` | Oui | Utilisateur | Mes groupes et leurs derniers messages |
| POST | `/groups` | Oui | Utilisateur | Créer un groupe et devenir propriétaire |
| GET | `/groups/:id` | Oui | Membre | Informations du groupe et membres |
| DELETE | `/groups/:id` | Oui | Propriétaire | Supprimer groupe, membres et messages |
| POST | `/groups/:id/members` | Oui | Propriétaire | Ajouter par adresse e-mail exacte |
| DELETE | `/groups/:id/members/:userId` | Oui | Propriétaire ou soi-même | Exclure un membre ou quitter (hors propriétaire) |
| GET | `/groups/:id/messages` | Oui | Membre | Lire les 50 messages les plus récents |
| POST | `/groups/:id/messages` | Oui | Membre | Envoyer un message |

## Exemples

Créer un compte :

```json
{ "name": "Alice Martin", "email": "alice@example.test", "password": "SuperSecret123!" }
```

Créer un groupe :

```http
POST /api/groups
Content-Type: application/json
```

```json
{ "name": "Équipe projet" }
```

Ajouter un membre (qui possède déjà un compte) :

```http
POST /api/groups/1/members
Content-Type: application/json
```

```json
{ "email": "bob@example.test" }
```

Envoyer un message :

```http
POST /api/groups/1/messages
Content-Type: application/json
```

```json
{ "body": "Bonjour 👋" }
```

Lire les messages :

```http
GET /api/groups/1/messages
GET /api/groups/1/messages?before=51
```

Réponse simplifiée :

```json
{
  "messages": [
    { "id": 24, "body": "Bonjour 👋", "createdAt": "2026-10-13T13:00:00.000Z", "authorId": 1, "authorName": "Alice Martin" }
  ],
  "hasMore": false,
  "nextBefore": null
}
```

`before` est un ID exclusif : la page suivante contient uniquement des messages dont l'ID est inférieur. Les messages sont retournés du plus ancien au plus récent au sein de la page. Chaque envoi est limité à **2 000 caractères** après suppression des espaces de début et de fin.

## Codes HTTP

- `200` : opération réussie, `201` : ressource créée.
- `400` : paramètre manquant ou invalide, `401` : session absente/expirée.
- `403` : droits insuffisants, `404` : ressource introuvable.
- `409` : conflit (e-mail déjà utilisé ou membre déjà présent).
- `413` : corps JSON trop volumineux, `415` : type non JSON.
- `429` : trop de tentatives d'authentification, `500` : erreur interne.

Les erreurs suivent le format `{ "error": "Description" }`.

## Événements temps réel (Socket.IO)

Le client charge `/socket.io/socket.io.js` depuis le backend puis se connecte à `/socket.io` **sur la même origine**. La session est automatiquement transmise par le cookie `relay_session` (HttpOnly). Aucune identification d'utilisateur ou de salon n'est acceptée dans les paramètres envoyés par le navigateur. Une session manquante ou expirée entraîne un refus de connexion.

| Événement émis par le serveur | Contenu | Comportement côté frontend |
| --- | --- | --- |
| `message:new` | `{ groupId, message }` | Ajoute immédiatement le message si le groupe est ouvert et déduplique par `message.id` |
| `groups:changed` | Aucun | Recharge la liste des groupes et des derniers messages |
| `group:members-changed` | `{ groupId }` | Recharge les membres du groupe courant |
| `group:removed` | `{ groupId }` | Ferme le groupe supprimé ou auquel l’utilisateur n’appartient plus |

Un client **n'envoie pas ses messages par socket** : `POST /api/groups/:id/messages` effectue la validation et l'insertion en base, et seul le backend publie ensuite `message:new`. Le propriétaire peut ajouter ou retirer les membres via l'API REST ; les salles Socket.IO sont mises à jour côté serveur, sans événement `join` côté client.

Les connexions se rétablissent automatiquement après une coupure. Le frontend relit la liste des groupes et les 50 messages récents du groupe courant pour récupérer les messages manqués.
