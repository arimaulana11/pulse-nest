# Pulse API — pulse-nest

NestJS backend untuk aplikasi personal finance SaaS **Pulse**. Menangani autentikasi, data pengguna, subscription, dan data keuangan (transaksi, anggaran, journey, goals) via Google Sheets.

---

## Stack

| Layer | Teknologi |
|---|---|
| Framework | NestJS 12 (ESM) |
| Database | PostgreSQL 16 (TypeORM) — identity & billing layer |
| Data keuangan | Google Sheets API v4 — transactions, budget, journey, goals |
| Auth | JWT (passport-jwt) + bcryptjs |
| Email | Nodemailer (SMTP Gmail) |
| Docs | Swagger UI (`/docs`) |
| Runtime | Node.js 22 |

---

## Arsitektur

```
PostgreSQL (identity & billing)
  users, subscriptions, plans, features,
  workspaces, workspace_members, workspace_invitations,
  reset_tokens, streaks, silent_modes, usage_quotas,
  journey_stages, journey_tasks, user_journey_progress

Google Sheets (data keuangan per user / workspace)
  transactions | budget_positions | journey_progress | goals
```

Data keuangan disimpan di Google Sheets agar user bisa buka dan edit langsung dari browser. PostgreSQL hanya menyimpan identity, billing, dan metadata.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Konfigurasi environment

Copy `.env.example` ke `.env` dan isi semua nilai:

```bash
cp .env.example .env
```

| Variable | Keterangan |
|---|---|
| `DB_HOST` | Host PostgreSQL (gunakan `postgres` di Docker) |
| `DB_PORT` | Port PostgreSQL (default `5432`) |
| `DB_USER` | Username database |
| `DB_PASS` | Password database |
| `DB_NAME` | Nama database |
| `JWT_SECRET` | Secret untuk signing access token |
| `JWT_EXPIRES_IN` | Expiry access token (contoh: `15m`) |
| `JWT_REFRESH_SECRET` | Secret untuk refresh token |
| `JWT_REFRESH_EXPIRES_IN` | Expiry refresh token (contoh: `7d`) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email service account Google Cloud |
| `GOOGLE_PRIVATE_KEY` | Private key service account (dengan `\n`) |
| `GOOGLE_SHEET_ID` | ID spreadsheet Google Sheets (personal/global) |
| `SHEET_TRANSACTIONS` | Nama tab transaksi (default: `transactions`) |
| `SHEET_BUDGET` | Nama tab anggaran (default: `budget_positions`) |
| `SHEET_JOURNEY` | Nama tab journey (default: `journey_progress`) |
| `SHEET_GOALS` | Nama tab goals (default: `goals`) |
| `MAIL_HOST` | SMTP host (default: `smtp.gmail.com`) |
| `MAIL_PORT` | SMTP port (default: `587`) |
| `MAIL_USER` | Email pengirim |
| `MAIL_PASS` | App Password Gmail |
| `MAIL_FROM` | Nama pengirim |
| `PORT` | Port server (default: `4000`) |
| `NODE_ENV` | `development` / `production` |
| `FRONTEND_URL` | URL frontend untuk CORS |

### 3. Setup database

```bash
# Jalankan schema utama
psql -U pulse_user -d pulse_db -f database/schema.sql

# Jalankan migrasi workspace (jika belum)
psql -U pulse_user -d pulse_db -f database/migrate-workspace.sql
```

### 4. Google Sheets

1. Buat project di [Google Cloud Console](https://console.cloud.google.com)
2. Enable **Google Sheets API**
3. Buat **Service Account** → download JSON key
4. Isi `GOOGLE_SERVICE_ACCOUNT_EMAIL` dan `GOOGLE_PRIVATE_KEY` dari JSON tersebut
5. Buat Google Spreadsheet baru → share ke email service account dengan role **Editor**
6. Copy ID spreadsheet (dari URL) ke `GOOGLE_SHEET_ID`

---

## Menjalankan

```bash
# Development (watch mode)
npm run start:dev

# Build production
npm run build

# Production
npm run start:prod
```

Server berjalan di `http://localhost:4000/api/v1`

---

## Docker

```bash
# Dari root project (bersama pulse-next)
docker compose up --build

# Build ulang hanya backend
docker compose build pulse-nest
docker compose up -d pulse-nest
```

Pastikan file `.env` di root project sudah diisi sebelum `docker compose up`.

---

## API Documentation

Swagger UI tersedia di:

```
http://localhost:4000/docs
```

OpenAPI JSON:

```
http://localhost:4000/docs-json
```

---

## Endpoint Summary

### Auth (`/api/v1/auth`)
| Method | Path | Auth | Keterangan |
|---|---|---|---|
| POST | `/register` | Public | Daftar akun baru |
| POST | `/login` | Public | Login email + password |
| POST | `/forgot-password` | Public | Kirim OTP ke email |
| POST | `/verify-otp` | Public | Validasi OTP |
| POST | `/reset-password` | Public | Reset password dengan OTP |
| POST | `/google-oauth` | Public | Upsert user via Google OAuth |
| GET | `/me` | Bearer | Profil user aktif |

### Transactions (`/api/v1/transactions`)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/` | List transaksi user |
| GET | `/summary` | Total income, expense, balance |
| GET | `/:id` | Detail transaksi |
| POST | `/` | Tambah transaksi |
| DELETE | `/:id` | Hapus transaksi (soft delete) |

Kirim header `X-Workspace-Id: <uuid>` untuk mode workspace.

### Budget (`/api/v1/budget`)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/?month=&year=` | List pos anggaran bulan ini |
| POST | `/` | Buat / update pos anggaran |
| DELETE | `/:id` | Hapus pos anggaran |

### Journey (`/api/v1/journey`)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/` | Seluruh journey state user |
| PATCH | `/task` | Update progress task |
| PATCH | `/stage` | Update status stage |

### Goals (`/api/v1/goals`)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/` | List goals |
| GET | `/:id` | Detail goal + milestones + deposits |
| POST | `/` | Buat goal |
| DELETE | `/:id` | Hapus goal |
| GET | `/:id/deposits` | Riwayat setoran |
| POST | `/deposit` | Tambah setoran |

### Subscription (`/api/v1/subscription`)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/` | Subscription aktif |
| GET | `/plan` | Kode plan (`free` / `normal_plus` / `vip`) |
| GET | `/features` | Daftar feature yang aktif |
| POST | `/upgrade` | Upgrade plan setelah pembayaran |
| DELETE | `/` | Cancel subscription |

### Workspaces (`/api/v1/workspaces`)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/` | List workspace user |
| POST | `/` | Buat workspace baru |
| GET | `/:id` | Detail + members + invitations |
| POST | `/:id/invite` | Undang member via email |
| DELETE | `/:id/invitations/:inviteId` | Batalkan undangan |
| POST | `/test-sheet` | Test koneksi Google Sheet |

---

## Workspace & Google Sheets per Workspace

Setiap workspace bisa punya Google Spreadsheet sendiri. Saat membuat workspace, isi:
- **Sheet ID** (dari URL spreadsheet)
- **Tab names** (opsional, default ke `transactions`, `budget_positions`, dll.)
- **Service Account Email** (share spreadsheet ke email ini dengan role Editor)

Saat request, kirim header:
```
X-Workspace-Id: <workspace-uuid>
```

Backend akan otomatis membaca/menulis ke spreadsheet workspace tersebut. Kalau header tidak ada atau `personal`, pakai spreadsheet global dari env.

---

## Struktur Modul

```
src/
├── auth/           JWT auth, register, login, forgot password, google-oauth
├── users/          User entity & service
├── subscriptions/  Plan, billing, feature access
├── sheets/         Google Sheets client (singleton + per-workspace)
│   ├── sheets.service.ts     — readAll, readRows, appendRow, dll + *WithId variants
│   └── sheet-context.ts      — SheetContext interface
├── transactions/   CRUD transaksi via Sheets
├── budget/         Pos anggaran via Sheets
├── journey/        Journey progress via Sheets
├── goals/          Financial goals & deposits via Sheets
├── workspaces/     Workspace CRUD, members, invitations
└── categories/     Category entity (sistem + custom)
```

---

## Database Schema

File: `database/schema.sql` — jalankan sekali saat setup awal.  
File: `database/migrate-workspace.sql` — jalankan setelah schema.sql untuk menambah kolom workspace.

Stored procedure `provision_new_user(uuid)` dipanggil otomatis setelah registrasi untuk menyiapkan:
- Free subscription
- Streak row
- Silent mode row
- Usage quota
- Initial journey progress (survival = completed, stability = active)
