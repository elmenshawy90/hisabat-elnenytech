const test = require('node:test');
const assert = require('node:assert');

// Extracted from public/js/shared-ui.js
function normalizeArabic(text) {
    if (!text) return '';
    return text.toString().toLowerCase()
        .replace(/[أإآا]/g, 'ا')
        .replace(/[ةه]/g, 'ه')
        .replace(/[ىي]/g, 'ي')
        .replace(/[ؤئ]/g, 'ء')
        .replace(/ـ/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function highlightArabic(text, query) {
    if (!query || !text) return text;
    const rawTerms = query.toString().trim().split(/\s+/).filter(Boolean);
    if (rawTerms.length === 0) return text;

    const patterns = rawTerms.map(term => {
        let escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return escaped
            .replace(/[اأإآ]/g, '[اأإآ]')
            .replace(/[هة]/g, '[هة]')
            .replace(/[يى]/g, '[يى]')
            .replace(/[ءؤئ]/g, '[ءؤئ]');
    });

    try {
        const regex = new RegExp(`(${patterns.join('|')})`, 'gi');
        return text.toString().replace(regex, '<span class="bg-[#fef08a] text-black px-1 rounded-sm">$1</span>');
    } catch(e) {
        return text;
    }
}

// Clients list search algorithm from views/clients.ejs
function searchClients(allClients, rawQuery) {
    const rawVal = rawQuery || '';
    const terms = [...new Set(rawVal.trim().split(/\s+/).filter(Boolean))];

    if (terms.length === 0) {
        return allClients;
    }

    const scoredClients = [];

    for (const client of allClients) {
        const normName = normalizeArabic(client.name || '');
        const phone = client.phone || '';
        let score = 0;

        for (const term of terms) {
            const normTerm = normalizeArabic(term);
            const nameMatches = normTerm && normName.includes(normTerm);
            const phoneMatches = phone && phone.includes(term);

            if (nameMatches || phoneMatches) {
                score++;
            }
        }

        if (score > 0) {
            scoredClients.push({ client, score });
        }
    }

    // Stable sort by score descending
    scoredClients.sort((a, b) => b.score - a.score);

    return scoredClients.map(item => item.client);
}

// Sample dataset from requirements
const dataset = [
    { id: 1, name: 'أحمد محمد', phone: '01011111111' },
    { id: 2, name: 'حسام إبراهيم', phone: '01022222222' },
    { id: 3, name: 'أحمد إبراهيم', phone: '01033333333' },
    { id: 4, name: 'محمد علي', phone: '01044444444' },
    { id: 5, name: 'خالد حسن', phone: '01055555555' },
    { id: 6, name: 'إبراهيم محمود', phone: '01066666666' },
    { id: 7, name: 'يوسف سالم', phone: '01077777777' }
];

test('Validation Case 1: Query "أحمد" returns "أحمد محمد", "أحمد إبراهيم"', () => {
    const results = searchClients(dataset, 'أحمد');
    const names = results.map(c => c.name);
    assert.deepStrictEqual(names, ['أحمد محمد', 'أحمد إبراهيم']);
});

test('Validation Case 2: Query "إبراهيم" returns "حسام إبراهيم", "أحمد إبراهيم", "إبراهيم محمود"', () => {
    const results = searchClients(dataset, 'إبراهيم');
    const names = results.map(c => c.name);
    assert.deepStrictEqual(names, ['حسام إبراهيم', 'أحمد إبراهيم', 'إبراهيم محمود']);
});

test('Validation Case 3: Query "أحمد إبراهيم" returns "أحمد إبراهيم" at top, followed by 1-match clients in original order', () => {
    const results = searchClients(dataset, 'أحمد إبراهيم');
    const names = results.map(c => c.name);
    assert.deepStrictEqual(names, [
        'أحمد إبراهيم', // score = 2
        'أحمد محمد',     // score = 1
        'حسام إبراهيم',   // score = 1
        'إبراهيم محمود'   // score = 1
    ]);
});

test('Validation Case 4: Query "  أحمد   إبراهيم  " (extra spaces) behaves identically', () => {
    const results = searchClients(dataset, '  أحمد   إبراهيم  ');
    const names = results.map(c => c.name);
    assert.deepStrictEqual(names, [
        'أحمد إبراهيم',
        'أحمد محمد',
        'حسام إبراهيم',
        'إبراهيم محمود'
    ]);
});

test('Validation Case 5: Query "   " (whitespace only) returns full list', () => {
    const results = searchClients(dataset, '   ');
    assert.deepStrictEqual(results, dataset);
});

test('Deduplication: Query "أحمد أحمد إبراهيم" dedupes identical terms and ranks correctly', () => {
    const results = searchClients(dataset, 'أحمد أحمد إبراهيم');
    const names = results.map(c => c.name);
    assert.deepStrictEqual(names, [
        'أحمد إبراهيم',
        'أحمد محمد',
        'حسام إبراهيم',
        'إبراهيم محمود'
    ]);
});

test('Phone search works individually and in multi-term OR search', () => {
    // Single phone search
    const phoneResult = searchClients(dataset, '01044444444');
    assert.deepStrictEqual(phoneResult.map(c => c.name), ['محمد علي']);

    // Multi-term: phone and name
    const mixedResult = searchClients(dataset, 'خالد 01077777777');
    assert.deepStrictEqual(mixedResult.map(c => c.name), ['خالد حسن', 'يوسف سالم']);
});

test('Arabic normalization matches variations (e.g. احمد without hamza vs أحمد with hamza)', () => {
    const results = searchClients(dataset, 'احمد ابراهيم');
    const names = results.map(c => c.name);
    assert.deepStrictEqual(names, [
        'أحمد إبراهيم',
        'أحمد محمد',
        'حسام إبراهيم',
        'إبراهيم محمود'
    ]);
});

test('highlightArabic highlights all matching terms in multi-term query', () => {
    const highlighted = highlightArabic('أحمد إبراهيم', 'أحمد إبراهيم');
    assert.ok(highlighted.includes('bg-[#fef08a]'));
    
    // Single term matching in a different client name
    const singleHighlight = highlightArabic('أحمد محمد', 'أحمد إبراهيم');
    assert.strictEqual(singleHighlight, '<span class="bg-[#fef08a] text-black px-1 rounded-sm">أحمد</span> محمد');
});
