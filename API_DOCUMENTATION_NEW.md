# API Documentation - New Endpoints (Option B)

## 1. Invoice Editing - PATCH /api/invoices/:id

### Purpose
Update an existing invoice with new information.

### Request
```bash
PATCH /api/invoices/123
Content-Type: application/json

{
  "type": "purchase",           // optional: 'purchase' or 'payment'
  "amount": 5000,               // optional: number
  "details": "مواد بناء",        // optional: string
  "address": "القاهرة",          // optional: string
  "date": "2026-08-18",         // optional: ISO date string
  "status": "paid",             // optional: 'pending', 'paid', 'overdue'
  "clientPhone": "01001234567"  // optional: updates client phone too
}
```

### Response (Success)
```json
{
  "id": 123,
  "clientId": 45,
  "clientName": "أحمد محمد",
  "clientPhone": "01001234567",
  "type": "purchase",
  "amount": 5000,
  "details": "مواد بناء",
  "address": "القاهرة",
  "date": "2026-08-18T00:00:00.000Z",
  "status": "paid",
  "updatedAt": "2026-08-18T15:30:00.000Z",
  "currentBalance": 0
}
```

### Error Cases
- 400: Invalid ID or no fields to update
- 404: Invoice not found
- 500: Server error

---

## 2. Invoice Status Update - PATCH /api/invoices/:id/status

### Purpose
Quick endpoint to change only the invoice status.

### Request
```bash
PATCH /api/invoices/123/status
Content-Type: application/json

{
  "status": "paid"  // required: 'pending', 'paid', or 'overdue'
}
```

### Response (Success)
```json
{
  "id": 123,
  "clientId": 45,
  "clientName": "أحمد محمد",
  "type": "purchase",
  "amount": 5000,
  "status": "paid",
  "message": "تم تحديث حالة الفاتورة بنجاح"
}
```

### Error Cases
- 400: Invalid status value
- 404: Invoice not found
- 500: Server error

---

## 3. Account Lockout Protection

### How It Works
- After **5 failed login attempts**, the account is **locked for 30 minutes**
- Each failed attempt decrements `attemptsRemaining` counter
- Successful login resets all counters
- Returns HTTP 429 (Too Many Requests) when locked

### Login Response - Failed Attempt
```json
{
  "error": "بيانات الدخول غير صحيحة",
  "attemptsRemaining": 3
}
```

### Login Response - Account Locked
```json
{
  "error": "محاولات دخول خاطئة متعددة. تم قفل الحساب لمدة 30 دقيقة"
}
HTTP Status: 429
```

### Login Response - Still Locked
```json
{
  "error": "الحساب مقفول. يرجى المحاولة بعد 25 دقيقة"
}
HTTP Status: 429
```

---

## Database Changes

New fields added to User model:
```prisma
failedLoginAttempts   Int      @default(0)
lockedUntil           DateTime?
```

### Migration
Migration file: `prisma/migrations/add_account_lockout/migration.sql`

Run when database is accessible:
```bash
npx prisma migrate deploy
```

---

## Example Usage - JavaScript/Fetch

### Update Invoice
```javascript
const updateInvoice = async (invoiceId, updates) => {
  const response = await fetch(`/api/invoices/${invoiceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return response.json();
};

// Usage
await updateInvoice(123, {
  amount: 6000,
  status: 'paid',
  details: 'مواد محدثة'
});
```

### Update Status Only
```javascript
const updateStatus = async (invoiceId, status) => {
  const response = await fetch(`/api/invoices/${invoiceId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  return response.json();
};

// Usage
await updateStatus(123, 'paid');
```

---

## Configuration

### Lockout Settings
Edit `routes/auth.js` to adjust:
- `MAX_LOGIN_ATTEMPTS`: Currently 5
- `LOCK_TIME_MINUTES`: Currently 30

Example:
```javascript
const MAX_LOGIN_ATTEMPTS = 5;        // Change to higher number for more lenient
const LOCK_TIME_MINUTES = 30;        // Change to longer/shorter lockout
```
