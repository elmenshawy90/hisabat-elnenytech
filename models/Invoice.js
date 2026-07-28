const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: [true, 'العميل مطلوب']
  },
  clientName: {
    type: String,
    required: true,
    trim: true
  },
  clientPhone: {
    type: String,
    default: '',
    trim: true
  },
  type: {
    type: String,
    enum: {
      values: ['purchase', 'payment'],
      message: 'نوع المعاملة يجب أن يكون شراء أو دفع'
    },
    required: [true, 'نوع المعاملة مطلوب']
  },
  amount: {
    type: Number,
    required: [true, 'المبلغ مطلوب'],
    min: [0.01, 'المبلغ يجب أن يكون أكبر من صفر']
  },
  details: {
    type: String,
    default: '-',
    trim: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'overdue'],
    default: 'pending'
  }
}, {
  timestamps: true
});

// Index for fast queries
invoiceSchema.index({ client: 1, date: -1 });
invoiceSchema.index({ date: -1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
