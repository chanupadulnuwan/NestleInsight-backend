# NestleInsight - B2B Distribution & Sales Management Platform

NestleInsight is a B2B distribution and sales monitoring platform tailored for managing wholesale products, tracking field territory performance, fulfilling retailer orders, and forecasting demand.

The project is structured into three main components:
1. **`backend/`** — A robust NestJS REST API using TypeScript, PostgreSQL (TypeORM), and JWT security roles.
2. **`web/`** — A React admin portal built with Vite, Tailwind CSS (v4), and Material UI (MUI).
3. **`mobile/`** — A mobile application for retailers/shop owners developed in Flutter.

---

## 📂 Repository Structure

```
NestleInsight/
├── backend/                   # NestJS REST API (Server Application)
│   ├── src/
│   │   ├── auth/              # JWT Auth, OTP verification, Guards & Roles decorators
│   │   ├── products/          # Catalog management & public/private endpoints
│   │   ├── categories/        # Product categories & groupings
│   │   ├── database/          # PostgreSQL entity definitions & catalog seeds
│   │   └── uploads/           # Uploaded assets (e.g. product image files)
│   └── scripts/               # DB init and demographic seed scripts
├── web/                       # React & Vite Admin Portal (Web client)
│   ├── src/
│   │   ├── api/               # API clients (Axios connection helpers)
│   │   ├── components/        # Reusable components (Navbar, Footer, Modal)
│   │   ├── pages/             # Portal pages (AdminDashboard, PublicProductsPage, etc.)
│   │   └── index.css          # Global Tailwind CSS and Glassmorphic variables
│   └── public/                # Static assets (favicons, illustration images)
└── mobile/                    # Flutter Mobile App for Shop Owners
```

---

## 🎨 Styling Design System (`web/src/index.css`)

The web admin panel is designed with a premium, glassmorphic dark-and-light aesthetic. Key variables and design tokens defined in [index.css](file:///d:/NestleInsight/web/src/index.css) include:

### 1. Color Palette & Typography
* **Corporate Palette**:
  * Primary Sans Font: `Aptos`, `Segoe UI`, `Trebuchet MS`
  * Theme Colors:
    * `--color-insight-gold` (`#c97935`) - Amber/gold accents
    * `--color-insight-amber` (`#efb068`) - Warning/highlight tones
    * `--color-insight-sand` (`#f6e5d5`) - Warm container background
    * `--color-insight-950` (`#120704`) - Sleek, dark brown backgrounds
* **Hero Remake Overlay (`.hero-shell`)**:
  Combines linear gradients and the background art (`/images/hero-background.jpg`) with radial warm glowing filters (`.hero-ambient`).

### 2. Custom Keyframe Animations
* `riseFade`: Smooth upward entrance for cards and header texts.
* `floatDrift`: Slow, floating hover animation for background panels.
* `dustDrift`: Ambient dust particle simulator for rich depth.
* `headlineGlow`: Ambient glow effect for primary typographic headers.
* `missionLineDrift`: Flowing, colored graphic lines illustrating visual metrics.

---

## 🔌 Backend API & Authentication Routing

Every API endpoint is secure by default using a Passport JWT auth strategy combined with standard Role-Based Access Control (RBAC). 

### 🛡️ Guards & Roles
* **Authentication**: Enforced via `@UseGuards(JwtAuthGuard, RolesGuard)` at endpoint level.
* **Role Verification**: Enforced via the `@Roles(...)` metadata decorator. Roles include `ADMIN`, `REGIONAL_MANAGER`, `DISTRIBUTOR`, `SHOP_OWNER`, and `DEMAND_PLANNER`.

### 📦 Products API Reference (`backend/src/products/products.controller.ts`)

| HTTP Method | Route Endpoint | Required Roles | Description |
| :--- | :--- | :--- | :--- |
| **GET** | `/products/public` | *None (Public)* | Lists active catalog products for public browse (e.g. Milo, Nescafe, Maggi) with real database prices & images. |
| **GET** | `/products/catalog` | `ADMIN`, `SHOP_OWNER`, `SALES_REP`, `TERRITORY_DISTRIBUTOR` | Fetches active product list grouped by categories for logged-in operators. |
| **GET** | `/products` | `ADMIN`, `DEMAND_PLANNER` | Lists all products in the database including active and inactive items. |
| **GET** | `/products/sku-availability` | `ADMIN` | Verifies if a SKU code is available for a new product. |
| **POST** | `/products` | `ADMIN` | Creates a new product and uploads its image (saves to `uploads/products/`). |
| **PATCH** | `/products/:id` | `ADMIN` | Modifies product details and handles replacement/deletion of old image assets. |

---

## 🚀 Setup & Run Instructions

### 🖥️ Local Development (Running Concurrently)
1. Navigate to the `web/` directory:
   ```bash
   cd web
   ```
2. Start both the backend (watch mode) and frontend (Vite server) concurrently:
   ```bash
   npm run dev
   ```
   *(This starts the NestJS API on port 3000 and the React site on port 5173).*

### 🌐 Hosted Production Server Deployment
The application's backend is hosted on a DigitalOcean VM via **PM2**, and the frontend is hosted on **Vercel**.

1. **Backend Deployment (Ubuntu VM via SSH)**:
   * Pull the latest backend changes:
     ```bash
     cd ~/NestleInsight-backend
     git pull origin main
     ```
   * Compile the TypeScript source code:
     ```bash
     npm run build
     ```
   * Restart the PM2 daemon process to reload changes:
     ```bash
     pm2 restart nestle-backend --update-env
     ```
2. **Frontend Deployment (Vercel)**:
   * Merging/pushing commits to the `main` branch of the `NestleInsight-AdminWeb` repository triggers Vercel's automated CI/CD pipeline to compile, bundle, and deploy the updated React build instantly.
