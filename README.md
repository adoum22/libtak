# Bookstore POS System

A professional Point of Sale (POS) system for bookstores and stationery shops with real-time inventory management, barcode scanning, and multilingual support (French, English, Arabic with RTL).

## 🎯 Features

### Backend (Django 5 + DRF)
- ✅ **Authentication**: JWT-based auth with Admin/Cashier roles
- ✅ **Product Management**: Full CRUD with categories, barcodes, pricing (HT/TTC), and stock tracking
- ✅ **Sales & POS**: Transaction management with automatic stock decrement
- ✅ **Real-time Updates**: Django Channels + Redis for live stock updates
- ✅ **Reporting**: Daily reports, top products, low stock alerts
- ✅ **Task Scheduling**: Celery + Celery Beat for automated reports

### Frontend (React 18 + TypeScript)
- ✅ **POS Interface**: Barcode scanner integration, cart management
- ✅ **Inventory Management**: Product search, CRUD operations
- ✅ **Dashboard**: Sales statistics, revenue tracking
- ✅ **Multilingual**: i18next with FR/EN/AR support
- ✅ **Styling**: TailwindCSS 4 avec thème luxueux personnalisé

## 📋 Prerequisites

- Python 3.10+
- Node.js 20.19+ ou 22.12+
- PostgreSQL (optional, SQLite used for development)
- Redis (for Channels and Celery)

## 🚀 Installation locale Linux

Installez Node.js officiel 20.19+ ou 22.12+, puis lancez l’installateur depuis
le dossier du projet avec votre compte normal :

```bash
chmod 700 install.sh
./install.sh
./start_server.sh
```

Pour une installation Zorin/Ubuntu démarrée automatiquement par systemd :

```bash
chmod 700 install.sh deployment/install-zorin.sh
./deployment/install-zorin.sh
```

Les deux parcours exécutent migrations, bootstrap administrateur unique,
`npm ci`, build frontend et vérification d’une sauvegarde chiffrée. Le POS est
disponible sur **http://127.0.0.1:5173** et l’API ASGI sur
`http://127.0.0.1:8000/api/`. Consultez
[`GUIDE_ZORIN_OS.md`](GUIDE_ZORIN_OS.md) pour le mode terminal ou
[`deployment/GUIDE_INSTALLATION.md`](deployment/GUIDE_INSTALLATION.md) pour
systemd.

### Authentication
- `POST /api/auth/login/` - Login (returns JWT tokens)
- `POST /api/auth/refresh/` - Refresh token
- `GET /api/auth/me/` - Get current user

### Inventory
- `GET /api/inventory/products/` - List products (supports `?search=` and `?barcode=`)
- `POST /api/inventory/products/` - Create product
- `GET /api/inventory/categories/` - List categories

### Sales
- `GET /api/sales/sales/` - List sales
- `POST /api/sales/sales/` - Create sale (auto-decrements stock)

### Reporting
- `GET /api/reporting/daily/` - Daily sales report
- `GET /api/reporting/stats/` - Statistics (top products, low stock)

## 📊 Database Schema

### Core Models
- **User**: Custom user with role field (ADMIN/CASHIER)
- **Category**: Product categories
- **Product**: Products with barcode, pricing, stock levels
- **Sale**: Sales transactions with payment method
- **SaleItem**: Line items for each sale

## 🐳 Docker Setup (Optional)

```bash
# First create a private .env file containing strong, installation-specific
# SECRET_KEY, JWT_SIGNING_KEY, BACKUP_ENCRYPTION_KEY,
# POSTGRES_PASSWORD, REDIS_PASSWORD,
# BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD values.

# Build and start all services
docker compose up --build

# After the first healthy start, remove the BOOTSTRAP_ADMIN_* values from
# .env. Existing administrator accounts are preserved on later restarts.

# Backend API will be at http://127.0.0.1:8000/api/
# Run/build the frontend separately; docker-compose.yml contains backend services.
```

Le Compose fourni applique une séparation des secrets :
`BACKUP_ENCRYPTION_KEY` et les identifiants `BACKUP_S3_*` sont transmis
uniquement à `celery_worker`, qui possède aussi les volumes d'archives. Le
backend HTTP et `celery_beat` peuvent planifier le travail sans pouvoir lire la
clé de déchiffrement ni les identifiants hors site. En Docker, lancez donc
toujours les commandes de sauvegarde depuis ce service, avec un chemin visible
dans son volume. Cette séparation réduit l'exposition entre conteneurs ;
réservez néanmoins l'accès au daemon Docker aux seuls administrateurs, car il
permet d'inspecter l'environnement du worker :

Remplacez `libtak_backup_A_REMPLACER.ltbk` par le nom réel de l'archive.

```bash
docker compose exec celery_worker python manage.py backup_database
docker compose exec celery_worker python manage.py sync_offsite_backups
docker compose exec celery_worker python manage.py verify_backup \
  /home/libtak/.libtak/backups/libtak_backup_A_REMPLACER.ltbk
```

La restauration doit utiliser un conteneur worker isolé, jamais `exec` dans le
worker Celery actif. Arrêtez les trois services applicatifs, lancez la commande
ponctuelle sans redémarrer les dépendances, puis ne relancez les services
qu'après le message de succès :

```bash
docker compose stop backend celery_beat celery_worker
docker compose run --rm --no-deps celery_worker python manage.py restore_backup \
  /home/libtak/.libtak/backups/libtak_backup_A_REMPLACER.ltbk --confirm RESTORE
docker compose up -d backend celery_worker celery_beat
```

Une commande de sauvegarde lancée avec `docker compose exec backend` échouera
volontairement faute de secrets de sauvegarde.

`BACKUP_ENCRYPTION_KEY` doit être une clé base64 URL-safe encodant exactement
32 octets. Conservez-en une copie privée hors du serveur et hors du dépôt :
sa perte rend les sauvegardes `.ltbk` irrécupérables. La rotation ne doit être
faite qu'après avoir restauré ou ré-encrypté les archives encore nécessaires.
Le nettoyage est piloté par `BACKUP_RETENTION_DAYS` (30 jours par défaut).
Le Compose exige par défaut `BACKUP_MIN_FREE_BYTES=268435456`, soit 256 Mio
libres dans les espaces d'archives et temporaire avant de générer une nouvelle
archive. Vérifiez régulièrement une archive avec la commande `verify_backup`
adaptée au mode d'installation et testez une restauration sur une base isolée.

`BACKUP_OFFSITE_DIR` active une copie atomique de l'archive chiffrée vers un
second dossier monté. Docker fournit le volume distinct
`backup_offsite_data`, mais ce volume reste sur le même hôte Docker : il ne
protège donc pas contre la perte de la machine. Pour une vraie copie hors site,
utilisez le transport S3 compatible intégré (par exemple Backblaze B2) ou
montez `BACKUP_OFFSITE_DIR` depuis une infrastructure physiquement séparée.
Une panne de la destination est journalisée sans supprimer l'archive locale.

Le transport S3 est activé uniquement lorsque `BACKUP_S3_BUCKET` est défini :

```dotenv
BACKUP_S3_BUCKET=nom-du-bucket-prive
BACKUP_S3_PREFIX=libtak/backups
BACKUP_S3_ENDPOINT_URL=https://endpoint-s3-fourni-par-le-prestataire
BACKUP_S3_REGION=region-fournie-par-le-prestataire
BACKUP_S3_ACCESS_KEY_ID=identifiant-de-cle-limitee
BACKUP_S3_SECRET_ACCESS_KEY=secret-de-cle-limitee
# BACKUP_S3_SESSION_TOKEN=uniquement-pour-des-identifiants-temporaires
```

Configurez un bucket privé avec Object Lock/rétention côté fournisseur et une
clé dédiée limitée à la liste, la lecture et l'écriture, sans suppression ni
contournement de la rétention. Aucun secret ne doit être ajouté à Git. Les
archives non confirmées à distance restent locales et sont reprises aux
passages suivants ; l'application ne supprime jamais d'objet distant.

Avant de réserver l'espace d'une nouvelle archive, le worker tente d'abord la
synchronisation S3 des archives existantes. Il ne purge alors que les archives
expirées dont la copie distante vient d'être confirmée ; une archive en attente
reste locale. Si la réserve minimale n'est toujours pas disponible, la nouvelle
sauvegarde échoue proprement sans sacrifier les copies non confirmées. Les
commandes de synchronisation affichent le nombre d'archives `pending` et leur
volume total en octets pour faciliter le diagnostic de capacité.

Sur une installation native, hors Docker :

```bash
python manage.py sync_offsite_backups
python manage.py verify_backup /chemin/vers/une-archive.ltbk
```

La procédure complète pour Backblaze B2, AWS S3 et les tests de restauration
se trouve dans [`DEPLOY.md`](DEPLOY.md#sauvegarde-réellement-hors-machine-s3-compatible).

## 🔄 Real-time Features

The frontend establishes the authenticated stock WebSocket automatically from
its configured API origin (`ws://127.0.0.1:8000/ws/stock/` locally). JWT
authentication is carried by the negotiated WebSocket subprotocol; do not put
tokens in URLs or documentation.

## 📝 Development Notes

### Backend Structure
```
backend/
├── config/          # Django settings, URLs, ASGI/WSGI
├── core/            # Authentication, users, WebSocket consumers
├── inventory/       # Products, categories
├── sales/           # Sales, transactions
├── reporting/       # Statistics, reports
├── manage.py
├── requirements.txt
└── Dockerfile
```

### Frontend Structure
```
frontend/
├── src/
│   ├── api/         # Axios client
│   ├── components/  # Layout, reusable components
│   ├── pages/       # Login, POS, Inventory, Dashboard
│   ├── hooks/       # useBarcodeScanner
│   ├── i18n.ts      # Translations
│   └── App.tsx
├── package.json
└── vite.config.ts
```

## 🛠️ Tech Stack

**Backend:**
- Django 5.2
- Django REST Framework
- Django Channels (WebSockets)
- Celery + Redis
- PostgreSQL / SQLite

**Frontend:**
- React 18
- TypeScript
- Vite
- React Query
- React Router
- i18next
- Axios
- Lucide React (icons)

## 📄 License

This project is provided as-is for educational and commercial use.

## 🤝 Contributing

This is a custom POS system. For issues or enhancements, please contact the development team.

---

**Status**: Backend fully functional ✅ | Frontend fully functional ✅
