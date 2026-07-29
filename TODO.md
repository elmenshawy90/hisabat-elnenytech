# TODO — hisabat (حسابات)

> Project: Construction Materials Debt Management System
> Stack: Node.js / Express / MongoDB / EJS / Tailwind CSS
> Last reviewed: 2026-07-29

---

## 🐛 Bugs & Fixes

### Server & Routing
- [ ] **Fix catch-all route serving missing `index.html`** — `server.js:65` tries to serve `public/index.html`, but the project now uses EJS views. This route will 404 for any unmatched path. Fix: serve `dashboard` or a proper SPA fallback, or remove the route.
- [ ] **Remove stale `test_chart.js`** — This debug/test file is left in the project root (`hisabat/test_chart.js`). It should be deleted or moved to a proper test directory.
- [ ] **No input sanitization — XSS risk** — User input (client names, invoice details, etc.) is stored and rendered in EJS without escaping. EJS does auto-escape by default with `<%=`, but there are places using `<%-` (raw HTML) that could be vulnerable. Audit all views for unescaped output.
- [ ] **No rate limiting on API endpoints** — Login, registration, and data endpoints are exposed to brute-force and abuse with no rate limiting.
- [ ] **Fallback session secret in production** — `server.js:26` falls back to `'fallback-secret-for-dev'` if `SESSION_SECRET` is not set. In production, this should always be set and fail-fast if missing.
- [ ] **Missing `index.html` in `public/`** — The catch-all route references it but it doesn't exist. Remove the route or create the file.

### Auth
- [ ] **No password reset / forgot-password flow** — Users cannot recover access if they forget their password.
- [ ] **No session expiration/timeout** — Sessions last 7 days (`server.js:34`) with no inactivity timeout. Should add idle timeout for security.
- [ ] **`requireAdmin` middleware exists but is never used** — `middleware/auth.js:9` defines `requireAdmin` but no routes enforce admin-only access.
- [ ] **No user registration route** — Only login exists; there's no way to create new users (including admin).
- [ ] **No account lockout after failed login attempts** — Brute-force protection is missing.

### Invoices
- [ ] **No invoice edit/update (PUT) route** — `routes/invoices.js` only has GET (list) and DELETE. There's no way to edit an existing invoice without deleting and recreating it.
- [ ] **No update for invoice status** — The `Invoice` model has a `status` field (`pending`/`paid`/`overdue`), but no API endpoint exists to update it.
- [ ] **Address field is required but may not be collected** — `models/Invoice.js:39` marks `address` as required. Verify the frontend form collects and sends this field. If unused, make it optional.
- [ ] **Invoice creation auto-creates unnamed clients** — When no `client` ID is provided, `routes/invoices.js:69-76` creates a client with only name and a dummy phone (`0000000000`). This can lead to messy, untracked client records.
- [ ] **Client balance can go negative on payment** — `routes/invoices.js:89` subtracts payment from balance without checking if the result would be negative or exceeding the total owed. Should validate payment amounts.

### Clients
- [ ] **No frontend for editing clients** — `clients.js` has a PUT route but the client-details and clients views likely don't expose an edit UI.
- [ ] **No duplicate phone/name validation** — Creating a client with the same name or phone as an existing one is allowed silently.

### Export
- [ ] **No PDF export for invoices or clients** — `pdfkit` is a dependency but `export.js` only implements Excel exports. PDF export endpoints are missing.
- [ ] **No filtered/date-range export** — Export endpoints export all data with no query parameters for filtering by date range, client, or status.
- [ ] **No bulk export** — No option to export selected invoices or a specific subset.

### Dashboard
- [ ] **No date range filter on dashboard stats** — All stats are computed against the full dataset. Users should be able to filter by date range.
- [ ] **Late client threshold is hardcoded** — `routes/dashboard.js:24` uses `balance > 10000` as the "late" threshold. This should be configurable.
- [ ] **Dashboard chart uses weekly grouping with a flawed formula** — `week: { $ceil: { $divide: [{ $dayOfMonth: "$date"}, 7] } }` doesn't correctly compute ISO/weeks. Consider using `$isoWeek` or a proper week calculation.

---

## ✨ Features to Add

### Authentication & Access Control
- [ ] **User registration page and route** — Allow new users to sign up, with admin approval or self-registration.
- [ ] **Admin-only routes for user management** — Use the existing `requireAdmin` middleware to build a user management page (list, create, delete, promote).
- [ ] **Role-based UI restrictions** — Hide admin-only UI elements (e.g., user management, settings) from non-admin users.
- [ ] **Password reset via email** — Implement token-based password reset flow.
- [ ] **Activity logging** — Track user actions (who created/updated/deleted records) for audit purposes.

### Invoices
- [ ] **Invoice edit/update (PUT/PATCH) route** — Allow modifying invoice details after creation.
- [ ] **Invoice status update endpoint** — Allow marking invoices as `paid` or `overdue` with a proper API route (e.g., `PATCH /api/invoices/:id/status`).
- [ ] **Individual invoice PDF generation** — Generate a printable PDF for a single invoice using `pdfkit` (already a dependency).
- [ ] **Bulk invoice operations** — Bulk delete, bulk status change, bulk export.
- [ ] **Invoice categories/types** — Add product/material categories to invoices for better reporting.
- [ ] **Recurring invoices** — Support scheduled/recurring purchase invoices for regular suppliers.
- [ ] **Payment receipts** — Generate or display a payment receipt when marking an invoice as paid.

### Clients
- [ ] **Client edit UI** — Add an edit client modal/form in the clients dashboard and client-details page.
- [ ] **Duplicate detection on client creation** — Warn or prevent creating clients with the same name/phone.
- [ ] **Client document attachments** — Allow uploading contracts, receipts, or IDs per client.
- [ ] **Client merge/consolidation** — Merge duplicate client records.
- [ ] **Search by address** — Extend the client search to include the address field.

### Dashboard & Reporting
- [ ] **Date range filter on dashboard** — Allow users to select a custom date range for all dashboard stats and charts.
- [ ] **Configurable "late" threshold** — Let admins set the balance threshold that defines a "late" client.
- [ ] **Monthly profit/loss report** — Calculate net revenue (purchases minus payments) over time and display on dashboard.
- [ ] **Export dashboard/table data as PDF** — Add PDF export for current view.
- [ ] **Real-time updates** — Use WebSockets or polling to refresh dashboard data without page reload.
- [ ] **Top creditors section** — Show clients with the most negative balance (who have overpaid).
- [ ] **Transaction trend chart** — Add a line/area chart showing transaction volume over time.

### Export
- [ ] **PDF export for clients** — Generate a printable client directory.
- [ ] **PDF export for invoices** — Generate a printable invoice list/report.
- [ ] **Date-range filtered exports** — Allow filtering exports by start/end date, client, or status.
- [ ] **CSV export option** — In addition to Excel, offer CSV for simpler consumption.

### UI/UX
- [ ] **Dark mode toggle** — Add a light/dark theme switcher.
- [ ] **Loading skeletons** — Replace static "جاري التحميل..." text with skeleton loaders for better perceived performance.
- [ ] **Infinite scroll or better pagination** — Replace limit/offset pagination with infinite scroll or a more user-friendly pagination component.
- [ ] **Toast notifications for all actions** — Ensure every CRUD operation shows a toast confirmation (create, update, delete).
- [ ] **Keyboard shortcuts** — Add shortcuts for common actions (e.g., `Ctrl+N` for new invoice, `Ctrl+F` for search).
- [ ] **Accessibility improvements** — Add ARIA labels, focus management for modals, and ensure full keyboard navigation.
- [ ] **Empty state illustrations/messages** — Show friendly empty states when there are no clients, invoices, etc.
- [ ] **Responsive table cards on mobile** — On small screens, display table rows as cards for better readability.

### Data & Settings
- [ ] **Data import (Excel/CSV)** — Allow importing clients and invoices from Excel/CSV files, complementing the existing export feature.
- [ ] **Database backup/restore** — Add a backup endpoint that exports MongoDB data and a restore feature.
- [ ] **Settings page** — Allow admin to configure: company name, currency, late threshold, session timeout, etc.
- [ ] **Multi-currency support** — Allow invoices in different currencies with conversion rates.
- [ ] **Soft delete for clients and invoices** — Move deleted records to a "trash" instead of hard-deleting them, allowing recovery.
- [ ] **Data retention policy** — Auto-archive or auto-delete old records after a configurable period.

### Infrastructure
- [ ] **Add database indexes for frequently queried fields** — Review and add missing indexes based on query patterns (e.g., `Invoice.date`, `Invoice.status`).
- [ ] **Add unit and integration tests** — Set up a test framework (e.g., Jest or Mocha) with tests for routes, models, and middleware.
- [ ] **Add CI/CD pipeline** — Set up automated testing and deployment (GitHub Actions or similar).
- [ ] **Environment-specific configurations** — Separate configs for dev, staging, and production.
- [ ] **API versioning** — Prefix API routes with `/api/v1/` for future compatibility.
- [ ] **Health check endpoint** — Add `GET /api/health` for monitoring and uptime checks.
- [ ] **Request logging middleware** — Log all requests with method, path, status, and response time.
- [ ] **Dependency audit and updates** — Run `npm audit` regularly and keep dependencies up to date.
- [ ] **Dockerize the application** — Add a `Dockerfile` and `docker-compose.yml` for easy deployment.