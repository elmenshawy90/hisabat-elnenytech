const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { normalize } = require('../lib/normalize');
const { getClientBalance } = require('../lib/balance');
const { checkStockAvailability, deductStock, reverseStock } = require('../lib/stock');

const MAX_INVOICE_EDIT_DAYS = 30;

// Apply auth middleware to all routes
router.use(requireAuth);

// GET /api/invoices - List invoices with pagination and filters
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    let where = {};
    
    // Filter by client ID if provided
    if (req.query.clientId) {
      where.clientId = parseInt(req.query.clientId);
    }

    const total = await prisma.invoice.count({ where });
    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        endClient: true,
        items: {
          include: {
            item: true,
            itemUnit: true
          }
        }
      },
      orderBy: [
        { date: 'desc' },
        { createdAt: 'desc' }
      ],
      skip,
      take: limit
    });

    res.json({
      data: invoices.map(inv => ({
        ...inv,
        _id: inv.id,
        client: inv.clientId // For frontend compatibility
      })),
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

// GET /api/invoices/:id - Get single invoice with items
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'معرف غير صالح' });

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        endClient: true,
        items: {
          include: {
            item: true,
            itemUnit: true
          }
        }
      }
    });

    if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });

    res.json({
      ...invoice,
      _id: invoice.id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في جلب الفاتورة' });
  }
});

// POST /api/invoices - Create new invoice
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    let clientId;
    let clientName;
    let clientPhone;

    // If client ID is provided, verify it exists
    if (data.client) {
      clientId = parseInt(data.client);
      let client = await prisma.client.findUnique({ where: { id: clientId } });
      
      if (!client) {
        return res.status(404).json({ error: 'العميل غير موجود' });
      }
      
      clientName = client.name;
      clientPhone = client.phone && client.phone !== '0000000000' ? client.phone : '-';

      if (data.clientPhone && data.clientPhone.trim() !== '' && data.clientPhone.trim() !== '-') {
        const newPhone = data.clientPhone.trim();
        if (!client.phone || client.phone === '-' || client.phone === '0000000000') {
          clientPhone = newPhone;
          await prisma.client.update({
            where: { id: clientId },
            data: { phone: clientPhone }
          });
        } else {
          const existingPhones = client.phone.split(' - ').map(p => p.trim());
          if (!existingPhones.includes(newPhone)) {
            clientPhone = client.phone + ' - ' + newPhone;
            await prisma.client.update({
              where: { id: clientId },
              data: { phone: clientPhone }
            });
          }
        }
      }
    } else {
      // Find or create client based on name if no ID provided (legacy support)
      const allClients = await prisma.client.findMany();
      const normInputName = normalize(data.clientName);
      let client = allClients.find(c => normalize(c.name) === normInputName);

      if (!client) {
        client = await prisma.client.create({
          data: {
            name: data.clientName,
            phone: (data.clientPhone && data.clientPhone.trim() && data.clientPhone.trim() !== '-') ? data.clientPhone.trim() : '-'
          }
        });
      }
      clientId = client.id;
      clientName = client.name;
      clientPhone = client.phone && client.phone !== '0000000000' ? client.phone : '-';
    }

    // EndClient logic
    let endClientId = null;
    let endClientName = null;

    if (data.endClientId) {
      endClientId = parseInt(data.endClientId);
      const endClient = await prisma.endClient.findUnique({ where: { id: endClientId } });
      if (!endClient) {
        return res.status(404).json({ error: 'العميل النهائي غير موجود' });
      }
      endClientName = endClient.name;
    } else if (data.endClientName && data.endClientName.trim() !== '') {
      const trimmedEndName = data.endClientName.trim();
      const allEndClients = await prisma.endClient.findMany();
      const normInputEndName = normalize(trimmedEndName);
      let endClient = allEndClients.find(ec => normalize(ec.name) === normInputEndName);

      if (!endClient) {
        endClient = await prisma.endClient.create({
          data: {
            name: trimmedEndName,
            phone: '-'
          }
        });
      }
      endClientId = endClient.id;
      endClientName = endClient.name;
    }

    // Process Line Items for purchase invoices
    const hasItems = data.type === 'purchase' && Array.isArray(data.items) && data.items.length > 0;
    let finalAmount = 0;
    let processedItems = [];
    let stockWarnings = [];
    let discountAmount = 0;

    if (hasItems) {
      for (let i = 0; i < data.items.length; i++) {
        const itemInput = data.items[i];
        const itemId = Number(itemInput.itemId);
        const itemUnitId = Number(itemInput.itemUnitId);
        const quantity = Number(itemInput.quantity);
        const unitPrice = Number(itemInput.unitPrice);

        if (isNaN(itemId) || isNaN(itemUnitId) || isNaN(quantity) || quantity <= 0 || isNaN(unitPrice) || unitPrice < 0) {
          return res.status(400).json({ error: `بيانات البند ${i + 1} غير صالحة` });
        }

        const unit = await prisma.itemUnit.findUnique({
          where: { id: itemUnitId },
          include: { item: true }
        });

        if (!unit || unit.itemId !== itemId) {
          return res.status(400).json({ error: `وحدة القياس للصنف في البند ${i + 1} غير موجودة` });
        }

        const quantityBase = quantity * Number(unit.conversionRate);
        const lineTotal = Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
        finalAmount += lineTotal;

        // Stock availability warning check
        const stockAvail = await checkStockAvailability(prisma, itemId, quantityBase);
        if (!stockAvail.sufficient) {
          stockWarnings.push({
            itemId,
            itemName: unit.item.name,
            requestedBase: quantityBase,
            availableBase: stockAvail.available,
            unitName: unit.name
          });
        }

        processedItems.push({
          itemId,
          itemUnitId,
          quantity,
          quantityBase,
          unitPrice,
          lineTotal
        });
      }

      finalAmount = Math.round((finalAmount + Number.EPSILON) * 100) / 100;

      // Calculate discount amount if provided
      const discountType = data.discountType; // 'percentage' or 'fixed'
      const discountVal = Number(data.discountValue);
      if (!isNaN(discountVal) && discountVal > 0) {
        if (discountType === 'percentage') {
          const pct = Math.min(Math.max(discountVal, 0), 100);
          discountAmount = Math.round((finalAmount * (pct / 100) + Number.EPSILON) * 100) / 100;
        } else if (discountType === 'fixed') {
          discountAmount = Math.round((discountVal + Number.EPSILON) * 100) / 100;
        }
      }
      discountAmount = Math.min(discountAmount, finalAmount);
      finalAmount = Math.round((finalAmount - discountAmount + Number.EPSILON) * 100) / 100;
    } else {
      const rawAmount = isNaN(parseFloat(data.amount)) ? 0 : parseFloat(data.amount);
      let baseAmount = Math.round((rawAmount + Number.EPSILON) * 100) / 100;
      if (baseAmount < 0) {
        return res.status(400).json({ error: 'المبلغ لا يمكن أن يكون سالباً' });
      }

      if (data.type === 'adjustment') {
        const reason = data.details ? String(data.details).trim() : '';
        if (!reason) {
          return res.status(400).json({ error: 'سبب التسوية إجباري، لا يمكن إجراء تسوية رصيد بدون توثيق السبب' });
        }
        if (baseAmount <= 0) {
          return res.status(400).json({ error: 'مبلغ التسوية يجب أن يكون أكبر من الصفر' });
        }
        discountAmount = 0;
        finalAmount = baseAmount;
      } else if (data.type === 'payment') {
        const discountType = data.discountType; // 'percentage' or 'fixed'
        const discountVal = Number(data.discountValue);
        if (!isNaN(discountVal) && discountVal > 0) {
          if (discountType === 'percentage') {
            const pct = Math.min(Math.max(discountVal, 0), 100);
            discountAmount = Math.round((baseAmount * (pct / 100) + Number.EPSILON) * 100) / 100;
          } else if (discountType === 'fixed') {
            discountAmount = Math.round((discountVal + Number.EPSILON) * 100) / 100;
          }
        }
        discountAmount = Math.min(discountAmount, baseAmount);
        finalAmount = Math.round((baseAmount - discountAmount + Number.EPSILON) * 100) / 100;
      } else {
        finalAmount = baseAmount;
      }
    }

    const paidAmount = data.paidAmount !== undefined && data.paidAmount !== null && !isNaN(parseFloat(data.paidAmount)) 
      ? Math.round((parseFloat(data.paidAmount) + Number.EPSILON) * 100) / 100 
      : 0;
    const paymentMethod = data.paymentMethod === 'transfer' ? 'transfer' : 'cash';
    const invoiceNotes = data.notes ? String(data.notes).trim() : '';

    const d = data.date ? new Date(data.date) : new Date();
    const targetDate = isNaN(d.getTime()) ? new Date() : d;
    const yy = String(targetDate.getFullYear()).slice(-2);
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const yearMonth = `${yy}${mm}`;
    const counterId = `invoice-${yearMonth}`;

    const newNotes = data.details || (data.type === 'purchase' ? 'عملية شراء' : (data.type === 'adjustment' ? 'تسوية رصيد' : 'دفعة'));

    // Use transaction to increment monthly counter, create invoice with invoiceCode, items, stock logs, auto-payment and update client notes
    const { invoice, autoPaymentInvoice, updatedClient } = await prisma.$transaction(async (tx) => {
      const counter = await tx.counter.upsert({
        where: { id: counterId },
        create: { id: counterId, value: 1 },
        update: { value: { increment: 1 } }
      });
      const invoiceCode = `${yearMonth}-${counter.value}`;

      const balanceEffect = data.balanceEffect === 'decrease' ? 'decrease' : (data.type === 'payment' ? 'decrease' : 'increase');

      const createdInvoice = await tx.invoice.create({
        data: {
          invoiceCode,
          clientId,
          clientName,
          clientPhone: clientPhone || '-',
          endClientId: endClientId || null,
          endClientName: endClientName || '',
          type: data.type,
          balanceEffect,
          amount: finalAmount,
          discountAmount: discountAmount || 0,
          paidAmount: paidAmount,
          paymentMethod: paymentMethod,
          notes: invoiceNotes,
          details: data.details || '-',
          address: data.address || '-',
          status: data.status || 'pending',
          date: targetDate,
          items: hasItems ? {
            create: processedItems.map(pi => ({
              itemId: pi.itemId,
              itemUnitId: pi.itemUnitId,
              quantity: pi.quantity,
              quantityBase: pi.quantityBase,
              unitPrice: pi.unitPrice,
              lineTotal: pi.lineTotal
            }))
          } : undefined
        },
        include: {
          endClient: true,
          items: {
            include: {
              item: true,
              itemUnit: true
            }
          }
        }
      });

      // Deduct stock for each item if present
      if (hasItems) {
        for (const pi of processedItems) {
          await deductStock(tx, pi.itemId, pi.quantityBase, createdInvoice.id, `فاتورة شراء ${invoiceCode}`);
        }
      }

      // If this is a purchase invoice and paidAmount > 0, create an automatic payment invoice
      let createdAutoPayment = null;
      if (data.type === 'purchase' && paidAmount > 0) {
        const payCounter = await tx.counter.upsert({
          where: { id: counterId },
          create: { id: counterId, value: 1 },
          update: { value: { increment: 1 } }
        });
        const payInvoiceCode = `${yearMonth}-${payCounter.value}`;

        createdAutoPayment = await tx.invoice.create({
          data: {
            invoiceCode: payInvoiceCode,
            clientId,
            clientName,
            clientPhone: clientPhone || '-',
            endClientId: endClientId || null,
            endClientName: endClientName || '',
            type: 'payment',
            balanceEffect: 'decrease',
            amount: paidAmount,
            discountAmount: 0,
            paidAmount: paidAmount,
            paymentMethod: paymentMethod,
            details: `دفعة مسجلة مع فاتورة رقم ${invoiceCode}`,
            notes: invoiceNotes || `سداد تلقائي مرتبط بالفاتورة ${invoiceCode}`,
            address: data.address || '-',
            status: 'paid',
            date: targetDate
          }
        });
      }

      const updated = await tx.client.update({
        where: { id: clientId },
        data: {
          notes: newNotes
        }
      });

      return { invoice: createdInvoice, autoPaymentInvoice: createdAutoPayment, updatedClient: updated };
    }, {
      timeout: 20000,
      maxWait: 10000
    });

    // Compute live balance
    const currentBalance = await getClientBalance(prisma, clientId);

    res.status(201).json({
      ...invoice,
      _id: invoice.id,
      invoiceCode: invoice.invoiceCode,
      client: invoice.clientId,
      endClientId: invoice.endClientId,
      endClientName: invoice.endClientName,
      currentBalance,
      stockWarnings: stockWarnings.length > 0 ? stockWarnings : undefined,
      autoPaymentInvoice: autoPaymentInvoice ? {
        ...autoPaymentInvoice,
        _id: autoPaymentInvoice.id
      } : undefined
    });
  } catch (err) {
    console.error('Error creating invoice:', err);
    res.status(500).json({ error: err.message || 'فشل في إنشاء الفاتورة' });
  }
});

// DELETE /api/invoices/:id - Delete invoice
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'معرف غير صالح' });

    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) {
      return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    }

    await prisma.invoice.delete({ where: { id } });

    res.json({ message: 'تم حذف الفاتورة بنجاح' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في حذف الفاتورة' });
  }
});

// PUT /api/invoices/:id - Edit an existing purchase invoice
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || !Number.isInteger(id)) {
      return res.status(400).json({ error: 'معرف الفاتورة غير صالح' });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        client: true
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    }

    // 1. Only purchase invoices can be edited with items
    if (invoice.type !== 'purchase') {
      return res.status(400).json({ error: 'تعديل الفواتير متاح فقط لفواتير الشراء التي تحتوي على بنود' });
    }

    // 2. Security constraint: invoice must not be older than MAX_INVOICE_EDIT_DAYS (30 days)
    const invoiceDate = new Date(invoice.date || invoice.createdAt);
    const diffMs = Date.now() - invoiceDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays > MAX_INVOICE_EDIT_DAYS) {
      return res.status(400).json({
        error: `لا يمكن تعديل فاتورة مضى عليها أكثر من ${MAX_INVOICE_EDIT_DAYS} يومًا لحماية السجل المحاسبي`
      });
    }

    const data = req.body;
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      return res.status(400).json({ error: 'يجب إدخال بند واحد على الأقل بفاتورة الشراء' });
    }

    // Verify endClient if provided
    let endClientId = invoice.endClientId;
    let endClientName = invoice.endClientName;
    if (data.endClientId !== undefined) {
      if (data.endClientId) {
        const ecId = parseInt(data.endClientId);
        const ec = await prisma.endClient.findUnique({ where: { id: ecId } });
        if (ec) {
          endClientId = ec.id;
          endClientName = ec.name;
        }
      } else if (data.endClientName && data.endClientName.trim()) {
        const trimmed = data.endClientName.trim();
        const existingEc = await prisma.endClient.findFirst({
          where: { name: { equals: trimmed, mode: 'insensitive' } }
        });
        if (existingEc) {
          endClientId = existingEc.id;
          endClientName = existingEc.name;
        } else {
          const newEc = await prisma.endClient.create({
            data: { name: trimmed }
          });
          endClientId = newEc.id;
          endClientName = newEc.name;
        }
      } else {
        endClientId = null;
        endClientName = '';
      }
    }

    // Fetch and validate items and units
    const itemIds = [...new Set(data.items.map(it => parseInt(it.itemId)).filter(Boolean))];
    const unitIds = [...new Set(data.items.map(it => parseInt(it.itemUnitId)).filter(Boolean))];

    const [dbItems, dbUnits] = await Promise.all([
      prisma.item.findMany({ where: { id: { in: itemIds } } }),
      prisma.itemUnit.findMany({ where: { id: { in: unitIds } } })
    ]);

    const itemMap = new Map(dbItems.map(i => [i.id, i]));
    const unitMap = new Map(dbUnits.map(u => [u.id, u]));

    let calculatedSubtotal = 0;
    const newPreparedItems = [];

    for (const rawItem of data.items) {
      const iId = parseInt(rawItem.itemId);
      const uId = parseInt(rawItem.itemUnitId);
      const qty = parseFloat(rawItem.quantity);
      const uPrice = parseFloat(rawItem.unitPrice);

      if (!iId || !uId || isNaN(qty) || qty <= 0 || isNaN(uPrice) || uPrice < 0) {
        return res.status(400).json({ error: 'بيانات بنود الفاتورة غير صالحة' });
      }

      const dbItem = itemMap.get(iId);
      const dbUnit = unitMap.get(uId);
      if (!dbItem || !dbUnit || dbUnit.itemId !== iId) {
        return res.status(400).json({ error: 'الصنف أو وحدة القياس المحددة غير صالحة' });
      }

      const conversionRate = Number(dbUnit.conversionRate) || 1.0;
      const quantityBase = Math.round((qty * conversionRate + Number.EPSILON) * 10000) / 10000;
      const lineTotal = Math.round((qty * uPrice + Number.EPSILON) * 100) / 100;
      calculatedSubtotal += lineTotal;

      newPreparedItems.push({
        itemId: iId,
        itemUnitId: uId,
        quantity: qty,
        quantityBase,
        unitPrice: uPrice,
        lineTotal,
        itemName: dbItem.name
      });
    }

    calculatedSubtotal = Math.round((calculatedSubtotal + Number.EPSILON) * 100) / 100;

    // Calculate discount
    let discountAmount = 0;
    const discountType = data.discountType;
    const discountVal = Number(data.discountValue);
    if (!isNaN(discountVal) && discountVal > 0) {
      if (discountType === 'percentage') {
        const pct = Math.min(Math.max(discountVal, 0), 100);
        discountAmount = Math.round((calculatedSubtotal * (pct / 100) + Number.EPSILON) * 100) / 100;
      } else if (discountType === 'fixed') {
        discountAmount = Math.round((discountVal + Number.EPSILON) * 100) / 100;
      }
    }
    discountAmount = Math.min(discountAmount, calculatedSubtotal);
    const finalAmount = Math.round((calculatedSubtotal - discountAmount + Number.EPSILON) * 100) / 100;

    const paidAmount = data.paidAmount !== undefined && data.paidAmount !== null && !isNaN(parseFloat(data.paidAmount))
      ? Math.round((parseFloat(data.paidAmount) + Number.EPSILON) * 100) / 100
      : 0;
    const paymentMethod = data.paymentMethod === 'transfer' ? 'transfer' : 'cash';

    const targetDate = data.date ? new Date(data.date) : invoice.date;
    const validDate = isNaN(targetDate.getTime()) ? invoice.date : targetDate;
    const invoiceNotes = data.notes !== undefined ? String(data.notes).trim() : invoice.notes;
    const deliveryAddress = data.address !== undefined ? String(data.address).trim() : invoice.address;
    const invoiceDetails = data.details !== undefined ? String(data.details).trim() : invoice.details;

    const stockWarnings = [];

    // Atomic transaction for all steps (a, b, c, d, e, f)
    const result = await prisma.$transaction(async (tx) => {
      // a. For each old item: reverse old stock deduction using corrective StockLog
      for (const oldItem of invoice.items) {
        await reverseStock(
          tx,
          oldItem.itemId,
          oldItem.quantityBase,
          invoice.id,
          `عكس تعديل فاتورة ${invoice.invoiceCode || invoice.id}`
        );
      }

      // b. Delete old InvoiceItems
      await tx.invoiceItem.deleteMany({
        where: { invoiceId: invoice.id }
      });

      // c. Create new InvoiceItems
      await tx.invoiceItem.createMany({
        data: newPreparedItems.map(it => ({
          invoiceId: invoice.id,
          itemId: it.itemId,
          itemUnitId: it.itemUnitId,
          quantity: it.quantity,
          quantityBase: it.quantityBase,
          unitPrice: it.unitPrice,
          lineTotal: it.lineTotal
        }))
      });

      // d. For each new item: check stock availability and deduct stock
      for (const newItem of newPreparedItems) {
        const avail = await checkStockAvailability(tx, newItem.itemId, newItem.quantityBase);
        if (!avail.sufficient) {
          stockWarnings.push({
            itemName: newItem.itemName,
            requested: newItem.quantityBase,
            available: avail.available
          });
        }
        await deductStock(
          tx,
          newItem.itemId,
          newItem.quantityBase,
          invoice.id,
          `خصم بيع (تعديل فاتورة ${invoice.invoiceCode || invoice.id})`
        );
      }

      // e. Update Invoice record (preserving invoiceCode)
      const updatedInv = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          endClientId,
          endClientName,
          amount: finalAmount,
          discountAmount,
          paidAmount,
          paymentMethod,
          address: deliveryAddress,
          details: invoiceDetails || 'عملية شراء',
          notes: invoiceNotes,
          date: validDate
        },
        include: {
          items: {
            include: {
              item: true,
              itemUnit: true
            }
          },
          endClient: true
        }
      });

      // f. Handle auto-payment invoice
      const existingAutoPayment = await tx.invoice.findFirst({
        where: {
          clientId: invoice.clientId,
          type: 'payment',
          OR: [
            { details: { contains: invoice.invoiceCode } },
            { notes: { contains: invoice.invoiceCode } }
          ]
        }
      });

      if (paidAmount > 0) {
        if (existingAutoPayment) {
          await tx.invoice.update({
            where: { id: existingAutoPayment.id },
            data: {
              amount: paidAmount,
              paidAmount,
              paymentMethod,
              date: validDate,
              address: deliveryAddress || '-',
              endClientId,
              endClientName
            }
          });
        } else {
          // Create new auto-payment
          const yy = String(validDate.getFullYear()).slice(-2);
          const mm = String(validDate.getMonth() + 1).padStart(2, '0');
          const yearMonth = `${yy}${mm}`;
          const counterId = `invoice-${yearMonth}`;
          const payCounter = await tx.counter.upsert({
            where: { id: counterId },
            create: { id: counterId, value: 1 },
            update: { value: { increment: 1 } }
          });
          const payInvoiceCode = `${yearMonth}-${payCounter.value}`;

          await tx.invoice.create({
            data: {
              invoiceCode: payInvoiceCode,
              clientId: invoice.clientId,
              clientName: invoice.clientName,
              clientPhone: invoice.clientPhone,
              endClientId,
              endClientName,
              type: 'payment',
              balanceEffect: 'decrease',
              amount: paidAmount,
              discountAmount: 0,
              paidAmount,
              paymentMethod,
              details: `دفعة مسجلة مع فاتورة رقم ${invoice.invoiceCode}`,
              notes: invoiceNotes || `سداد تلقائي مرتبط بالفاتورة ${invoice.invoiceCode}`,
              address: deliveryAddress || '-',
              status: 'paid',
              date: validDate
            }
          });
        }
      } else {
        // paidAmount is 0: if auto-payment existed, remove it
        if (existingAutoPayment) {
          await tx.invoice.delete({
            where: { id: existingAutoPayment.id }
          });
        }
      }

      return updatedInv;
    }, {
      timeout: 25000,
      maxWait: 10000
    });

    const currentBalance = await getClientBalance(prisma, invoice.clientId);

    res.json({
      ...result,
      _id: result.id,
      currentBalance,
      stockWarnings: stockWarnings.length > 0 ? stockWarnings : undefined
    });
  } catch (err) {
    console.error('Error updating invoice:', err);
    res.status(500).json({ error: err.message || 'فشل في تعديل الفاتورة' });
  }
});

// PATCH /api/invoices/:id - Update invoice
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'معرف غير صالح' });

    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) {
      return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    }

    const data = req.body;
    const updateData = {};

    // Validate and prepare updatable fields
    if (data.type && ['purchase', 'payment', 'adjustment'].includes(data.type)) {
      updateData.type = data.type;
    }

    if (data.balanceEffect && ['increase', 'decrease'].includes(data.balanceEffect)) {
      updateData.balanceEffect = data.balanceEffect;
    }

    if (data.amount !== undefined) {
      const rawAmount = parseFloat(data.amount);
      if (isNaN(rawAmount) || rawAmount < 0) {
        return res.status(400).json({ error: 'المبلغ لا يمكن أن يكون سالباً' });
      }
      updateData.amount = Math.round((rawAmount + Number.EPSILON) * 100) / 100;
    }

    if (data.details !== undefined) {
      updateData.details = data.details || '-';
    }

    if (data.address !== undefined) {
      updateData.address = data.address || '-';
    }

    if (data.date !== undefined) {
      updateData.date = new Date(data.date);
    }

    if (data.status && ['pending', 'paid', 'overdue'].includes(data.status)) {
      updateData.status = data.status;
    }

    // Handle clientPhone update if provided
    if (data.clientPhone !== undefined) {
      updateData.clientPhone = data.clientPhone || '-';
      
      // Also update in client record if it's a new phone
      if (data.clientPhone && data.clientPhone.trim() !== '' && data.clientPhone.trim() !== '-') {
        const newPhone = data.clientPhone.trim();
        const client = await prisma.client.findUnique({ where: { id: invoice.clientId } });
        
        if (client) {
          const existingPhones = client.phone ? client.phone.split(' - ').map(p => p.trim()) : [];
          if (!existingPhones.includes(newPhone)) {
            const updatedPhone = client.phone ? client.phone + ' - ' + newPhone : newPhone;
            await prisma.client.update({
              where: { id: invoice.clientId },
              data: { phone: updatedPhone }
            });
          }
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: updateData
    });

    const currentBalance = await getClientBalance(prisma, invoice.clientId);

    res.json({
      ...updatedInvoice,
      _id: updatedInvoice.id,
      client: updatedInvoice.clientId,
      currentBalance
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في تحديث الفاتورة' });
  }
});

// PATCH /api/invoices/:id/status - Update invoice status only
router.patch('/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'معرف غير صالح' });

    const { status } = req.body;
    if (!status || !['pending', 'paid', 'overdue'].includes(status)) {
      return res.status(400).json({ error: 'حالة غير صالحة. استخدم: pending, paid, أو overdue' });
    }

    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) {
      return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: { status }
    });

    res.json({
      ...updatedInvoice,
      _id: updatedInvoice.id,
      message: 'تم تحديث حالة الفاتورة بنجاح'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في تحديث حالة الفاتورة' });
  }
});

module.exports = router;
