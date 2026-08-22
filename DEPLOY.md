# Déploiement Libtak — PythonAnywhere + Vercel

Architecture cible :

- **Backend Django** → PythonAnywhere (`https://votre-compte.pythonanywhere.com`)
- **Frontend React PWA** → Vercel (`https://libtak.vercel.app`)
- **POS local** → SQLite ; `sync_to_cloud.py` pousse les ventes vers PythonAnywhere.

Ne placez jamais de mot de passe, token ou clé réelle dans ce document, un
commit, une commande partagée ou une capture d'écran. Tout secret déjà publié
doit être considéré compromis et remplacé dans le service concerné.

---

## 1. Backend — PythonAnywhere

### 1.1 Créer le compte et cloner le projet

Créez votre compte PythonAnywhere, puis ouvrez une console Bash :

```bash
git clone https://github.com/adoum22/libtak.git
cd libtak
```

### 1.2 Créer le virtualenv

```bash
mkvirtualenv --python=python3.11 libtak
pip install -r backend/requirements-cloud.txt
```

Le plan gratuit n'offre pas Redis. Le management command
`send_scheduled_reports` fournit donc le planificateur de secours, sans worker
Celery ni broker.

### 1.3 Configurer la web app

Dashboard → **Web** → **Add a new web app** :

- choisissez **Manual configuration** → **Python 3.11** ;
- **Source code** : `/home/votre-compte/libtak/backend` ;
- **Working directory** : `/home/votre-compte/libtak/backend` ;
- remplacez le fichier WSGI par
  [`deployment/pythonanywhere_wsgi.py`](./deployment/pythonanywhere_wsgi.py) ;
- **Virtualenv** : `/home/votre-compte/.virtualenvs/libtak` ;
- static `/static/` → `/home/votre-compte/libtak/backend/staticfiles` ;
- media `/media/` → `/home/votre-compte/libtak/backend/media`.

### 1.4 Variables privées

Générez les valeurs sur la machine cible et ne les copiez pas dans Git :

```bash
python -c "import secrets; print(secrets.token_urlsafe(60))"  # SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(60))"  # JWT_SIGNING_KEY
python -c "import secrets; print(secrets.token_urlsafe(48))"  # SYNC_TOKEN
python -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"  # BACKUP_ENCRYPTION_KEY
```

Renseignez-les dans **Web → Environment variables** ou dans
`~/.libtak_env`, fichier privé hors du dépôt et lisible uniquement par votre
compte (`chmod 600 ~/.libtak_env`). La tâche planifiée charge elle aussi ce
fichier.

| Variable | Valeur attendue |
|---|---|
| `DEBUG` | `False` |
| `SECRET_KEY` | valeur aléatoire dédiée d'au moins 50 caractères |
| `JWT_SIGNING_KEY` | autre valeur aléatoire d'au moins 50 caractères |
| `BACKUP_ENCRYPTION_KEY` | base64 URL-safe encodant exactement 32 octets |
| `BACKUP_RETENTION_DAYS` | `30` (à adapter à votre politique) |
| `BACKUP_MIN_FREE_BYTES` | réserve exigée dans les espaces d'archives et temporaire ; Docker : `268435456` (256 Mio) |
| `BACKUP_OFFSITE_DIR` | dossier monté séparément ; vide pour désactiver |
| `BACKUP_S3_BUCKET` | nom exact du bucket privé ; vide pour désactiver S3 |
| `BACKUP_S3_PREFIX` | préfixe objet, par exemple `libtak/backups` |
| `BACKUP_S3_ENDPOINT_URL` | endpoint HTTPS S3 compatible, sans identifiants ni chemin ; vide pour AWS S3 |
| `BACKUP_S3_REGION` | région indiquée par le fournisseur |
| `BACKUP_S3_ACCESS_KEY_ID` | identifiant d'une clé dédiée et limitée |
| `BACKUP_S3_SECRET_ACCESS_KEY` | secret associé, toujours configuré avec l'identifiant |
| `BACKUP_S3_SESSION_TOKEN` | optionnel, uniquement pour des identifiants temporaires |
| `ALLOWED_HOSTS` | `votre-compte.pythonanywhere.com` |
| `CORS_ALLOWED_ORIGINS` | URL HTTPS Vercel finale |
| `CSRF_TRUSTED_ORIGINS` | URL HTTPS Vercel finale |
| `DATABASE_URL` | `sqlite:////home/votre-compte/libtak/backend/db.sqlite3` |
| `IS_CLOUD_SERVER` | `True` sur ce backend récepteur PythonAnywhere |
| `EMAIL_HOST` / `EMAIL_PORT` | `smtp.gmail.com` / `587` |
| `EMAIL_HOST_USER` | compte SMTP dédié |
| `EMAIL_HOST_PASSWORD` | mot de passe d'application, jamais le mot de passe principal |
| `DEFAULT_FROM_EMAIL` | expéditeur des rapports |
| `SYNC_TOKEN` | même secret aléatoire sur le cloud et le POS local |

Conservez une copie de récupération de `BACKUP_ENCRYPTION_KEY` dans un coffre
distinct. Sans cette clé, les sauvegardes `.ltbk` sont irrécupérables.
Si `BACKUP_OFFSITE_DIR` est configuré, l'application y copie atomiquement
l'archive déjà chiffrée. Montez ce dossier sur un stockage réellement séparé ;
une indisponibilité hors site n'efface pas la copie locale.

### Sauvegarde réellement hors machine (S3 compatible)

Un volume Docker nommé, y compris `backup_offsite_data`, reste normalement sur
le même hôte et n'est pas une sauvegarde hors machine. Le transport S3 intégré
est préférable pour une copie géographiquement séparée. Il fonctionne avec
AWS S3 et les services compatibles, notamment Backblaze B2.

Pour Backblaze B2 :

1. créez un bucket **privé** exclusivement réservé aux sauvegardes LibTak ;
2. activez **Object Lock** et une rétention par défaut adaptée à votre activité
   (par exemple 30 ou 90 jours) dans la console du fournisseur ;
3. créez une clé d'application, jamais la clé maître, limitée à ce bucket et au
   préfixe `libtak/backups`. Les capacités B2 utiles sont `listAllBucketNames`
   (compatibilité S3), `listFiles`, `readFiles` et `writeFiles`. Excluez
   `deleteFiles`, les droits de modification de rétention/Legal Hold et
   `bypassGovernance` ;
4. copiez l'endpoint S3 et la région affichés par B2 dans le fichier privé de
   l'environnement, jamais dans le dépôt.

Consultez les références Backblaze sur
[Object Lock et la rétention par défaut](https://www.backblaze.com/docs/cloud-storage-object-lock)
et sur les
[capacités des clés S3 compatibles](https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys).
Activer Object Lock sans définir de rétention par défaut ne protège pas les
nouveaux objets automatiquement.

Exemple à adapter avec les valeurs affichées par votre fournisseur :

```dotenv
BACKUP_S3_BUCKET=libtak-production-backups
BACKUP_S3_PREFIX=libtak/backups
BACKUP_S3_ENDPOINT_URL=https://s3.region-fournie.backblazeb2.com
BACKUP_S3_REGION=region-fournie
BACKUP_S3_ACCESS_KEY_ID=identifiant-de-la-cle-limitee
BACKUP_S3_SECRET_ACCESS_KEY=secret-de-la-cle-limitee
```

L'endpoint doit être une URL HTTPS racine : n'y ajoutez ni identifiants, ni nom
de bucket, ni chemin. Pour AWS S3, laissez `BACKUP_S3_ENDPOINT_URL` vide. Une
instance disposant d'un rôle IAM doit laisser les variables de clé vides : le
SDK récupère alors automatiquement des identifiants temporaires. Un rôle
d'instance ou d'exécution dédié est préférable à toute clé statique. Si une clé
statique est néanmoins utilisée, son identifiant et son secret doivent toujours
être présents ensemble. `BACKUP_S3_SESSION_TOKEN` ne sert qu'avec des
identifiants temporaires fournis explicitement.

Pour AWS, limitez les droits S3 du rôle dédié à la policy IAM suivante, en
remplaçant `VOTRE_BUCKET` et en gardant exactement le même préfixe que
`BACKUP_S3_PREFIX` :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListOnlyLibTakBackupPrefix",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::VOTRE_BUCKET",
      "Condition": {
        "StringLike": {
          "s3:prefix": [
            "libtak/backups",
            "libtak/backups/*"
          ]
        }
      }
    },
    {
      "Sid": "ReadAndWriteOnlyLibTakBackupObjects",
      "Effect": "Allow",
      "Action": [
        "s3:AbortMultipartUpload",
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::VOTRE_BUCKET/libtak/backups/*"
    }
  ]
}
```

Cette policy n'accorde aucun `s3:DeleteObject`, `s3:DeleteObjectVersion`,
`s3:PutObjectRetention` ou `s3:BypassGovernanceRetention`. Le rôle ne doit pas
recevoir une autre policy S3 plus permissive qui réintroduirait ces droits.
`s3:AbortMultipartUpload` autorise seulement boto3 à nettoyer les parties d'un
gros envoi interrompu ; il ne permet pas de supprimer un objet finalisé. La
restriction de `s3:ListBucket` par `s3:prefix` et la distinction entre ARN de
bucket et ARN d'objet suivent les
[recommandations IAM officielles d'Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/walkthrough1.html).
Consultez aussi les
[considérations AWS Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html)
avant de choisir le mode Governance ou Compliance.

Protégez `BACKUP_ENCRYPTION_KEY` séparément des identifiants S3 : la possession
du bucket ne permet pas de restaurer les archives sans cette clé. Placez tous
ces secrets dans les variables privées du service ou dans un fichier de mode
`600`, exclu de Git, et ne les collez jamais dans un ticket, un log ou une
capture d'écran.

Contrôle initial :

```bash
cd ~/libtak/backend
python manage.py backup_database
python manage.py sync_offsite_backups
python manage.py verify_backup /chemin/vers/une-archive-locale.ltbk
```

Ces commandes directes conviennent à PythonAnywhere ou à une installation
native. Avec le `docker-compose.yml` fourni, les secrets de sauvegarde et les
volumes d'archives sont volontairement accessibles au seul `celery_worker` :

Remplacez `libtak_backup_A_REMPLACER.ltbk` par le nom réel de l'archive.

```bash
docker compose exec celery_worker python manage.py backup_database
docker compose exec celery_worker python manage.py sync_offsite_backups
docker compose exec celery_worker python manage.py verify_backup \
  /home/libtak/.libtak/backups/libtak_backup_A_REMPLACER.ltbk
```

N'utilisez pas `docker compose exec backend` pour ces commandes : le backend
HTTP ne reçoit ni `BACKUP_ENCRYPTION_KEY` ni les identifiants S3.

Une restauration ne doit jamais être exécutée dans le worker Celery actif.
Arrêtez les services qui peuvent accéder aux données, exécutez un conteneur
worker ponctuel partageant les mêmes volumes et variables privées, puis ne
redémarrez qu'après le message de succès :

```bash
docker compose stop backend celery_beat celery_worker
docker compose run --rm --no-deps celery_worker python manage.py restore_backup \
  /home/libtak/.libtak/backups/libtak_backup_A_REMPLACER.ltbk --confirm RESTORE
docker compose up -d backend celery_worker celery_beat
```

`--no-deps` laisse PostgreSQL et Redis déjà démarrés sans lancer de second
worker permanent ; `--rm` détruit le conteneur ponctuel à sa sortie. Limitez
également l'accès au daemon Docker : un administrateur Docker peut inspecter
l'environnement privé du worker.

Lors du premier envoi, LibTak relit intégralement l'objet distant et compare sa
taille et son SHA-256. Les passages suivants contrôlent son marqueur local et
ses métadonnées distantes. Toute archive non confirmée est conservée localement
et retentée lors d'une prochaine sauvegarde/synchronisation, même si sa durée
de rétention locale est dépassée. Un objet distant existant mais différent
provoque un échec fermé : il n'est pas écrasé.

Avant de créer une nouvelle archive, une pré-synchronisation S3 tente de
confirmer les archives locales existantes. Les archives déjà expirées ne sont
supprimées localement que si leur contenu distant a été confirmé ; cette étape
peut libérer l'espace nécessaire sans perdre une copie en attente. LibTak exige
ensuite au moins `BACKUP_MIN_FREE_BYTES` libres dans chacun des espaces locaux
utilisés pour l'archive et les fichiers temporaires. Le Compose fourni utilise
`268435456` octets (256 Mio) par défaut. Si cette réserve reste indisponible, la
génération est refusée proprement et les archives non confirmées sont
préservées.

`sync_offsite_backups` et `local_backup_sync` affichent le nombre d'archives
`pending` ainsi que leur volume cumulé en octets. Une valeur non nulle indique
la capacité locale minimale à conserver jusqu'au rétablissement de S3.

LibTak ne supprime jamais les objets distants. La durée de conservation et
l'immuabilité doivent donc être appliquées par la politique de cycle de vie et
Object Lock du fournisseur. Après le contrôle initial, téléchargez
périodiquement une archive depuis le bucket vers une machine isolée, lancez
`verify_backup`, puis testez sa restauration sur une base non productive.

### 1.5 Migrations et premier administrateur

```bash
workon libtak
cd ~/libtak/backend
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py createsuperuser
```

Choisissez un identifiant unique et une phrase de passe longue. Ne documentez
jamais ce mot de passe. Rechargez ensuite la web app et vérifiez
`https://votre-compte.pythonanywhere.com/api/health/`.

### 1.6 Tâches quotidiennes sans Redis

Dans **Tasks → Daily task**, configurez par exemple 23:00 :

```text
workon libtak && cd /home/votre-compte/libtak/backend && python manage.py send_scheduled_reports --daily-slot
```

Cette commande envoie les rapports dus, effectue la sauvegarde chiffrée et
supprime les refresh tokens JWT expirés. Le calendrier conserve ses marqueurs
d'idempotence.

Tests manuels :

```bash
python manage.py send_scheduled_reports --dry-run --daily-slot
python manage.py verify_backup /chemin/vers/une-archive.ltbk
```

Testez périodiquement la restauration sur une copie isolée de l'environnement,
jamais directement sur la base de production.

---

## 2. Frontend — Vercel

1. Importez le dépôt GitHub dans Vercel.
2. Définissez **Root Directory** sur `frontend`.
3. Conservez le preset Vite ; `vercel.json` configure le build, le fallback SPA
   et les en-têtes de sécurité.
4. Ajoutez `VITE_API_URL=https://votre-compte.pythonanywhere.com/api` pour les
   environnements Production et Preview.
5. Déployez.

La CSP de `frontend/vercel.json` autorise l'origine API/WebSocket de production
actuelle. Si le domaine backend change, mettez à jour ses entrées `https://` et
`wss://` dans `connect-src` avant de redéployer.

Une fois l'URL Vercel finale connue, recopiez exactement son origine HTTPS dans
`CORS_ALLOWED_ORIGINS` et `CSRF_TRUSTED_ORIGINS`, puis rechargez Django.

---

## 3. Synchronisation POS local → cloud

Dans le fichier privé `backend/.env` du POS :

```dotenv
CLOUD_API_URL=https://votre-compte.pythonanywhere.com/api
SYNC_TOKEN=valeur-identique-au-secret-du-cloud
```

En production, toute URL cloud non loopback doit utiliser HTTPS. Le HTTP reste
accepté uniquement pour `localhost`, `127.0.0.0/8` et `::1` pendant une
intégration locale.

Sous Windows, créez une tâche toutes les 30 minutes :

- programme : `C:\chemin\vers\libtak\backend\.venv\Scripts\python.exe` ;
- arguments : `sync_to_cloud.py` ;
- démarrer dans : `C:\chemin\vers\libtak\backend`.

---

## 4. Smoke test final

1. `https://votre-compte.pythonanywhere.com/api/health/` répond 200.
2. Le frontend Vercel affiche l'écran de connexion sans erreur CSP.
3. Connectez-vous avec le compte administrateur créé interactivement.
4. Créez une vente de test locale puis lancez `python sync_to_cloud.py`.
5. Vérifiez la vente côté cloud et l'absence de données sensibles dans les logs.
6. Exécutez `python manage.py check --deploy` avec les variables de production.

---

## 5. Coûts indicatifs

| Service | Plan | Prix indicatif |
|---|---|---|
| PythonAnywhere | Beginner | 0 €/mois |
| Vercel | Hobby | 0 €/mois |
| Domaine custom | selon registrar | environ 10 €/an |

Les offres et quotas peuvent changer ; vérifiez les pages tarifaires des
fournisseurs avant le déploiement.
