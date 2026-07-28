const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes('USER:PASS')) {
    console.error('⚠️  يرجى إعداد MONGODB_URI في ملف .env');
    console.error('   راجع .env.example للحصول على التعليمات');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح');
  } catch (err) {
    console.error('❌ فشل الاتصال بقاعدة البيانات:', err.message);
    process.exit(1);
  }

  mongoose.connection.on('error', (err) => {
    console.error('❌ خطأ في قاعدة البيانات:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('⚠️  تم قطع الاتصال بقاعدة البيانات');
  });
}

module.exports = connectDB;
