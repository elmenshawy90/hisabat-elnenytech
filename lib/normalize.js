/**
 * Helper to normalize Arabic text for robust search and duplicate detection.
 * Handles Alef variants (أ, إ, آ, ٱ, ا), Taa Marbuta / Haa (ة, ه), Yaa / Alef Maksura (ي, ى),
 * Hamzas (ء, ؤ, ئ), and strips Arabic tashkeel / harakat and tatweel / kashida.
 */
function normalize(str) {
  if (!str) return '';
  return str.toString().toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // remove tashkeel & tatweel
    .replace(/[أإآاٱ]/g, 'ا')
    .replace(/[ةه]/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ؤئء]/g, 'ء')
    .replace(/ـ/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  normalize,
  normalizeArabic: normalize
};
