const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'اسم العميل مطلوب'],
    minlength: [2, 'اسم العميل يجب أن يكون حرفين على الأقل'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'رقم الهاتف مطلوب'],
    trim: true
  },
  address: {
    type: String,
    default: '',
    trim: true
  },
  notes: {
    type: String,
    default: '',
    trim: true
  },
  balance: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Virtual: get initials from name
clientSchema.virtual('initials').get(function () {
  return this.name.split(' ').slice(0, 2).map(w => w[0]).join(' ');
});

// Ensure virtuals are included in JSON output
clientSchema.set('toJSON', { virtuals: true });
clientSchema.set('toObject', { virtuals: true });

// Text index for search
clientSchema.index({ name: 'text', phone: 'text' });

module.exports = mongoose.model('Client', clientSchema);
