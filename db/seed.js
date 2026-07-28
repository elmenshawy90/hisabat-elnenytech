const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');

// Load env vars
dotenv.config();

const connectDB = require('./connection');
const Client = require('../models/Client');
const Invoice = require('../models/Invoice');
const User = require('../models/User');

const CLIENTS_JSON = path.join(__dirname, '../data/clients.json');
const INVOICES_JSON = path.join(__dirname, '../data/invoices.json');

async function seedData() {
  try {
    await connectDB();

    console.log('🗑️  Clearing existing data...');
    await Client.deleteMany();
    await Invoice.deleteMany();
    await User.deleteMany();

    // Create default admin
    const admin = await User.create({
      username: 'admin',
      password: 'password123',
      displayName: 'المدير',
      role: 'admin'
    });
    console.log('✅ Admin user created (admin / password123)');

    // Read JSON data
    let clientsData = [];
    let invoicesData = [];
    
    try {
      clientsData = JSON.parse(await fs.readFile(CLIENTS_JSON, 'utf8'));
      console.log(`📦 Found ${clientsData.length} clients in JSON`);
    } catch (e) {
      console.log('⚠️  No clients.json found or invalid JSON');
    }

    try {
      invoicesData = JSON.parse(await fs.readFile(INVOICES_JSON, 'utf8'));
      console.log(`📦 Found ${invoicesData.length} invoices in JSON`);
    } catch (e) {
      console.log('⚠️  No invoices.json found or invalid JSON');
    }

    // ID mapping between old string IDs and new ObjectIds
    const idMap = {};

    // Seed Clients
    for (const c of clientsData) {
      const client = await Client.create({
        name: c.name,
        phone: c.phone || '0000000000',
        balance: c.balance || 0,
        createdAt: c.createdAt || new Date(),
        updatedAt: c.lastTransaction || new Date(),
        notes: c.lastTransactionNote || ''
      });
      idMap[c.id] = client._id;
    }
    console.log(`✅ Seeded ${clientsData.length} clients`);

    // Seed Invoices
    for (const inv of invoicesData) {
      const clientId = idMap[inv.clientId];
      if (!clientId) continue; // Skip orphan invoices

      await Invoice.create({
        client: clientId,
        clientName: inv.clientName,
        clientPhone: inv.clientPhone,
        type: inv.type || 'purchase',
        amount: inv.amount,
        details: inv.details || '-',
        date: inv.date || new Date(),
        status: inv.status || 'pending',
        createdAt: inv.createdAt || new Date()
      });
    }
    console.log(`✅ Seeded invoices`);

    console.log('🎉 Seeding complete!');
    process.exit();
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
}

seedData();
