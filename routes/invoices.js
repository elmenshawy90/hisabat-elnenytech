const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const { requireAuth } = require('../middleware/auth');

// Apply auth middleware to all routes
router.use(requireAuth);

// GET /api/invoices - List invoices with pagination and filters
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    let query = {};
    
    // Filter by client ID if provided
    if (req.query.clientId) {
      query.client = req.query.clientId;
    }

    const total = await Invoice.countDocuments(query);
    const invoices = await Invoice.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      data: invoices,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في جلب الفواتير' });
  }
});

// POST /api/invoices - Create new invoice
router.post('/', async (req, res) => {
  try {
    // If client ID is provided, verify it exists and populate name/phone
    if (req.body.client) {
      const client = await Client.findById(req.body.client);
      if (!client) {
        return res.status(404).json({ error: 'العميل غير موجود' });
      }
      
      if (req.body.clientPhone && req.body.clientPhone.trim() !== '') {
        const newPhone = req.body.clientPhone.trim();
        const existingPhones = client.phone.split(' - ').map(p => p.trim());
        if (!existingPhones.includes(newPhone)) {
          client.phone = client.phone + ' - ' + newPhone;
          await client.save();
        }
      }

      req.body.clientName = client.name;
      req.body.clientPhone = client.phone;
    } else {
      // Find or create client based on name if no ID provided (legacy support)
      // This is less robust but keeps compatibility with the current frontend
      let client = await Client.findOne({ name: req.body.clientName });
      if (!client) {
        client = new Client({
          name: req.body.clientName,
          phone: req.body.clientPhone || '0000000000'
        });
        await client.save();
      }
      req.body.client = client._id;
    }

    const invoice = new Invoice(req.body);
    await invoice.save();

    // Update client balance
    const client = await Client.findById(invoice.client);
    if (client) {
      if (invoice.type === 'purchase') {
        client.balance += invoice.amount;
      } else if (invoice.type === 'payment') {
        client.balance -= invoice.amount;
      }
      
      // Update last transaction info
      client.notes = invoice.details || (invoice.type === 'purchase' ? 'عملية شراء' : 'دفعة');
      await client.save();
    }

    res.status(201).json(invoice);
  } catch (err) {
    console.error(err);
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    res.status(500).json({ error: 'فشل في إنشاء الفاتورة' });
  }
});

// DELETE /api/invoices/:id - Delete invoice
router.delete('/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    }

    // Revert client balance
    const client = await Client.findById(invoice.client);
    if (client) {
      if (invoice.type === 'purchase') {
        client.balance -= invoice.amount;
      } else if (invoice.type === 'payment') {
        client.balance += invoice.amount;
      }
      await client.save();
    }

    await Invoice.findByIdAndDelete(req.params.id);
    res.json({ message: 'تم حذف الفاتورة بنجاح' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في حذف الفاتورة' });
  }
});

module.exports = router;
