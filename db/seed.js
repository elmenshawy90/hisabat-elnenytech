const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

// Load env vars
dotenv.config();

const prisma = new PrismaClient();

const CLIENTS_JSON = path.join(__dirname, '../data/clients.json');
const INVOICES_JSON = path.join(__dirname, '../data/invoices.json');

async function seedData() {
  try {
    console.log('🗑️  Clearing existing data...');
    await prisma.invoice.deleteMany();
    await prisma.client.deleteMany();
    await prisma.user.deleteMany();
    // Assuming you have a Session model, you could clear it too, but not required here.

    // Create default admin
    const hashedPassword = await bcrypt.hash('password123', 10);
    const admin = await prisma.user.create({
      data: {
        username: 'admin',
        password: hashedPassword,
        displayName: 'المدير',
        role: 'admin'
      }
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

    // ID mapping between old string IDs and new integer IDs
    const idMap = {};

    // Seed Clients
    for (const c of clientsData) {
      const client = await prisma.client.create({
        data: {
          name: c.name,
          phone: c.phone || '-',
          balance: c.balance || 0,
          createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
          updatedAt: c.lastTransaction ? new Date(c.lastTransaction) : new Date(),
          notes: c.lastTransactionNote || ''
        }
      });
      idMap[c.id] = client.id;
    }
    console.log(`✅ Seeded ${clientsData.length} clients`);

    // Seed Invoices
    for (const inv of invoicesData) {
      const clientId = idMap[inv.clientId];
      if (!clientId) continue; // Skip orphan invoices

      await prisma.invoice.create({
        data: {
          clientId,
          clientName: inv.clientName || 'Unknown',
          clientPhone: inv.clientPhone || '-',
          type: inv.type || 'purchase',
          amount: parseFloat(inv.amount) || 0,
          details: inv.details || '-',
          address: inv.address || '-',
          date: inv.date ? new Date(inv.date) : new Date(),
          status: inv.status || 'pending',
          createdAt: inv.createdAt ? new Date(inv.createdAt) : new Date()
        }
      });
    }
    console.log(`✅ Seeded invoices`);

    console.log('🎉 Seeding complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
}

seedData();
