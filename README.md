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

- Python 3.11+
- Node.js 18+
- PostgreSQL (optional, SQLite used for development)
- Redis (for Channels and Celery)

## 🚀 Quick Start

### Backend Setup

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Run migrations
python manage.py migrate

# Create demo users (admin/admin123, cashier/cashier123)
python create_users.py

# Seed demo products
python seed_products.py

# Run development server
python manage.py runserver
```

**Backend will be available at:** `http://localhost:8000`
**API Documentation:** `http://localhost:8000/api/docs/`

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
# Build and start all services
docker-compose up --build

# Backend will be at http://localhost:8000
# Frontend will be at http://localhost:5173 (if build issues are resolved)
```

## 🔄 Real-time Features

The system uses Django Channels for real-time stock updates:

```javascript
// Frontend WebSocket connection (example)
const ws = new WebSocket('ws://localhost:8000/ws/stock/');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Handle stock update: data.message.product_id, data.message.new_stock
};
```

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
