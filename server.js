const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const INVOICES_FILE = path.join(DATA_DIR, 'invoices.json');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');

// ─── Data Helpers ────────────────────────────────────────────

async function ensureDir(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

async function ensureFile(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify([]));
  }
}

async function loadData(filePath) {
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

async function saveData(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function generateId() {
  return crypto.randomUUID().slice(0, 8);
}

// ─── CLIENT ENDPOINTS ────────────────────────────────────────

// GET /api/clients — List all clients
app.get('/api/clients', async (req, res) => {
  try {
    const clients = await loadData(CLIENTS_FILE);
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: 'فشل في قراءة بيانات العملاء' });
  }
});

// GET /api/clients/:id — Get single client with their invoices
app.get('/api/clients/:id', async (req, res) => {
  try {
    const clients = await loadData(CLIENTS_FILE);
    const client = clients.find(c => c.id === req.params.id);
    if (!client) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }
    // Get this client's invoices
    const invoices = await loadData(INVOICES_FILE);
    const clientInvoices = invoices.filter(inv => inv.clientId === client.id);
    res.json({ ...client, invoices: clientInvoices });
  } catch (err) {
    res.status(500).json({ error: 'فشل في قراءة بيانات العميل' });
  }
});

// POST /api/clients — Create a new client
app.post('/api/clients', async (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'الاسم ورقم الهاتف مطلوبان' });
  }
  try {
    const clients = await loadData(CLIENTS_FILE);
    const newClient = {
      id: generateId(),
      name,
      phone,
      balance: 0,
      lastTransaction: new Date().toISOString().split('T')[0],
      lastTransactionNote: 'عميل جديد',
      createdAt: new Date().toISOString().split('T')[0]
    };
    clients.push(newClient);
    await saveData(CLIENTS_FILE, clients);
    res.status(201).json(newClient);
  } catch (err) {
    res.status(500).json({ error: 'فشل في إضافة العميل' });
  }
});

// PUT /api/clients/:id — Update a client
app.put('/api/clients/:id', async (req, res) => {
  try {
    const clients = await loadData(CLIENTS_FILE);
    const index = clients.findIndex(c => c.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }
    clients[index] = { ...clients[index], ...req.body, id: clients[index].id };
    await saveData(CLIENTS_FILE, clients);
    res.json(clients[index]);
  } catch (err) {
    res.status(500).json({ error: 'فشل في تحديث بيانات العميل' });
  }
});

// DELETE /api/clients/:id — Delete a client
app.delete('/api/clients/:id', async (req, res) => {
  try {
    const clients = await loadData(CLIENTS_FILE);
    const index = clients.findIndex(c => c.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }
    const deleted = clients.splice(index, 1)[0];
    await saveData(CLIENTS_FILE, clients);
    // Also delete client's invoices
    const invoices = await loadData(INVOICES_FILE);
    const remaining = invoices.filter(inv => inv.clientId !== req.params.id);
    await saveData(INVOICES_FILE, remaining);
    res.json(deleted);
  } catch (err) {
    res.status(500).json({ error: 'فشل في حذف العميل' });
  }
});

// ─── INVOICE ENDPOINTS ───────────────────────────────────────

// GET /api/invoices — List all invoices (with optional ?limit=N&clientId=X)
app.get('/api/invoices', async (req, res) => {
  try {
    let invoices = await loadData(INVOICES_FILE);

    // Filter by clientId if provided
    if (req.query.clientId) {
      invoices = invoices.filter(inv => inv.clientId === req.query.clientId);
    }

    // Sort by date descending (newest first)
    invoices.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Limit results if requested
    if (req.query.limit) {
      invoices = invoices.slice(0, parseInt(req.query.limit));
    }

    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: 'فشل في قراءة الفواتير' });
  }
});

// POST /api/invoices — Create a new invoice
app.post('/api/invoices', async (req, res) => {
  const { clientName, clientPhone, date, amount, details, type, clientId } = req.body;
  if (!clientName || !amount) {
    return res.status(400).json({ error: 'اسم العميل والمبلغ مطلوبان' });
  }
  try {
    const invoices = await loadData(INVOICES_FILE);
    const newInvoice = {
      id: generateId(),
      clientId: clientId || null,
      clientName,
      clientPhone: clientPhone || '',
      date: date || new Date().toISOString().split('T')[0],
      amount: parseFloat(amount),
      type: type || 'purchase',
      details: details || '-',
      status: type === 'payment' ? 'paid' : 'pending',
      createdAt: new Date().toISOString()
    };
    invoices.push(newInvoice);
    await saveData(INVOICES_FILE, invoices);

    // Update client balance if clientId is provided
    if (clientId) {
      const clients = await loadData(CLIENTS_FILE);
      const clientIndex = clients.findIndex(c => c.id === clientId);
      if (clientIndex !== -1) {
        if (type === 'payment') {
          clients[clientIndex].balance -= parseFloat(amount);
        } else {
          clients[clientIndex].balance += parseFloat(amount);
        }
        clients[clientIndex].lastTransaction = newInvoice.date;
        clients[clientIndex].lastTransactionNote = details || newInvoice.type;
        await saveData(CLIENTS_FILE, clients);
      }
    }

    res.status(201).json(newInvoice);
  } catch (err) {
    res.status(500).json({ error: 'فشل في حفظ الفاتورة' });
  }
});

// DELETE /api/invoices/:id — Delete an invoice
app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const invoices = await loadData(INVOICES_FILE);
    const index = invoices.findIndex(inv => inv.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    }
    const deleted = invoices.splice(index, 1)[0];
    await saveData(INVOICES_FILE, invoices);
    res.json(deleted);
  } catch (err) {
    res.status(500).json({ error: 'فشل في حذف الفاتورة' });
  }
});

// ─── DASHBOARD STATS ─────────────────────────────────────────

// GET /api/dashboard — Aggregated dashboard statistics
app.get('/api/dashboard', async (req, res) => {
  try {
    const clients = await loadData(CLIENTS_FILE);
    const invoices = await loadData(INVOICES_FILE);

    const totalClients = clients.length;
    const outstandingBalance = clients.reduce((sum, c) => sum + (c.balance || 0), 0);
    const lateClients = clients.filter(c => c.balance > 10000).length;

    // Today's transactions
    const today = new Date().toISOString().split('T')[0];
    const todayTransactions = invoices.filter(inv => inv.date === today).length;

    // Top debtors (sorted by balance descending)
    const topDebtors = [...clients]
      .filter(c => c.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5);

    // Recent transactions (last 5)
    const recentTransactions = [...invoices]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);

    res.json({
      totalClients,
      outstandingBalance,
      lateClients,
      todayTransactions,
      topDebtors,
      recentTransactions
    });
  } catch (err) {
    res.status(500).json({ error: 'فشل في تحميل إحصائيات لوحة القيادة' });
  }
});

// ─── START SERVER ────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await ensureDir(DATA_DIR);
  await ensureFile(INVOICES_FILE);
  await ensureFile(CLIENTS_FILE);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📄 Dashboard:       http://localhost:${PORT}/dashboard.html`);
  console.log(`👥 Clients:         http://localhost:${PORT}/clients.html`);
  console.log(`🧾 New Invoice:     http://localhost:${PORT}/new-invoice.html`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  process.exit();
});