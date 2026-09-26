# API HTTP

Toutes les réponses sont en JSON (UTF-8). Si `server.auth` est configuré, toutes
les routes (sauf `/api/health` et `/api/ingest/*`) exigent l'authentification HTTP Basic.

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/health` | État du serveur (`ok`, `uptimeS`, `version`) |
| GET | `/api/config` | Titre, mode démonstration, seuils |
| GET | `/api/topology` | Topologie fusionnée complète : `entities`, `links`, `flows`, `alarms`, `collectors` |
| GET | `/api/events` | Flux temps réel (Server-Sent Events), voir ci-dessous |
| GET | `/api/entities/{id}` | Une entité + historique des métriques (≈ 1 h), enfants, liens, flux |
| GET | `/api/alarms` | Alarmes actives |
| POST / DELETE | `/api/alarms/{id}/ack` | Acquitter / réactiver une alarme |
| GET | `/api/collectors` | État des collecteurs |
| POST | `/api/ingest/{source}` | Pousser un snapshot (voir ci-dessous) |
| DELETE | `/api/ingest/{source}` | Retirer tout ce qu'une source a poussé |

## Temps réel : `/api/events`

- `event: snapshot` — envoyé à la connexion : la topologie complète.
- `event: delta` — à chaque changement :
  `{ version, entities: { set: [...], del: [ids] }, links: {...}, flows: {...}, alarms?: [...] }`.
  `version` augmente de 1 à chaque delta ; un client qui détecte un trou se reconnecte.
- `event: collectors` — état des collecteurs lorsqu'il change.

## Ingestion : `POST /api/ingest/{source}`

Permet à n'importe quel outil (script PowerShell, export d'un autre logiciel de
supervision, CMDB, sondes maison…) d'alimenter la vue. Le corps est un
**snapshot complet** de cette source, au format décrit dans
[COLLECTEURS.md](COLLECTEURS.md) : chaque envoi remplace le précédent de la même
source. La source apparaît sous le nom `ingest:{source}`.

Authentification : en-tête `Authorization: Bearer <jeton>` (ou `X-SNG-Token`)
si `server.ingestToken` est défini ; sinon seuls les envois depuis la machine
locale sont acceptés.

Champs optionnels du corps :

- `priority` (défaut 50) : priorité de la source lors de la fusion (inventaire = 100) ;
- `staleAfterSeconds` : délai au-delà duquel les données sont signalées obsolètes.

Exemple (PowerShell) : [`scripts/examples/push-ingest.ps1`](../scripts/examples/push-ingest.ps1).

```json
{
  "entities": [
    { "id": "app-paie", "type": "vm", "name": "PAIE-01", "keys": ["host:paie-01"],
      "status": "warning", "statusText": "File d'attente > 500 messages",
      "metrics": { "cpu": 42 } }
  ],
  "flows": [
    { "src": { "ip": "10.10.40.21" }, "dst": { "ip": "10.10.50.11" }, "proto": "tcp", "port": 1433, "bps": 25000000 }
  ],
  "staleAfterSeconds": 300
}
```

Ici, `keys: ["host:paie-01"]` suffit pour que cette entité soit fusionnée avec la
VM `PAIE-01` déjà vue par le vCenter ou Hyper-V.
