const express = require('express');
const router = express.Router();
const Client = require('../models/Client');
const Invoice = require('../models/Invoice');
const { requireAuth } = require('../middleware/auth');

// Apply auth middleware to all routes
router.use(requireAuth);

// GET /api/clients - List clients with pagination and search
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search;

    let query = {};
    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const total = await Client.countDocuments(query);
    const clients = await Client.find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      data: clients,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في جلب بيانات العملاء' });
  }
});

// GET /api/clients/:id - Get single client with their invoices
router.get('/:id', async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }

    const invoices = await Invoice.find({ client: client._id }).sort({ date: -1 });
    
    // Return client object with invoices attached (similar to previous API structure)
    const clientData = client.toJSON();
    clientData.invoices = invoices;
    
    res.json(clientData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في جلب بيانات العميل' });
  }
});

// POST /api/clients - Create new client
router.post('/', async (req, res) => {
  try {
    const client = new Client(req.body);
    await client.save();
    res.status(201).json(client);
  } catch (err) {
    console.error(err);
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    res.status(500).json({ error: 'فشل في إنشاء العميل' });
  }
});

// PUT /api/clients/:id - Update client
router.put('/:id', async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(
      req.params.id, 
      req.body, 
      { new: true, runValidators: true }
    );
    if (!client) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }
    res.json(client);
  } catch (err) {
    console.error(err);
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    res.status(500).json({ error: 'فشل في تحديث العميل' });
  }
});

// DELETE /api/clients/:id - Delete client and their invoices
router.delete('/:id', async (req, res) => {
  try {
    const client = await Client.findByIdAndDelete(req.params.id);
    if (!client) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }
    
    // Delete associated invoices
    await Invoice.deleteMany({ client: client._id });
    
    res.json({ message: 'تم حذف العميل بنجاح' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في حذف العميل' });
  }
});

module.exports = router;
