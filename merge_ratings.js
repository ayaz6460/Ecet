/**
 * merge_ratings.js
 * Reads collegedunia_ratings.json and colleges_data.json,
 * fuzzy-matches by college name, updates ratings where matched,
 * and reports missing colleges (in our DB but not in Collegedunia).
 * 
 * Run: node merge_ratings.js
 */

const fs   = require('fs');
const path = require('path');

// ─── Load files ──────────────────────────────────────────────────────────────
const ratingsPath  = path.join('C:\\Users\\Admin\\OneDrive\\Desktop\\mcc', 'collegedunia_ratings.json');
const collegesPath = path.join(__dirname, 'colleges_data.json');
const outputPath   = path.join(__dirname, 'colleges_data.json'); // overwrite in-place

const ratings  = JSON.parse(fs.readFileSync(ratingsPath,  'utf8'));
const colleges = JSON.parse(fs.readFileSync(collegesPath, 'utf8'));

// ─── Normalise a string for fuzzy comparison ─────────────────────────────────
function normalise(str) {
    return str
        .toLowerCase()
        // Remove content inside brackets like [VBIT], (Autonomous) etc.
        .replace(/\[.*?\]/g, '')
        .replace(/\(.*?\)/g, '')
        // Strip common noise words
        .replace(/\b(institute|institution|college|engineering|technology|science|and|of|for|the|autonomous|hyderabad|telangana|india|women|womens)\b/g, '')
        // Strip punctuation
        .replace(/[^a-z0-9\s]/g, '')
        // Collapse whitespace
        .replace(/\s+/g, ' ')
        .trim();
}

// ─── Build a searchable index from Collegedunia ratings ──────────────────────
// key → { rating, originalName }
const ratingsIndex = [];
for (const [key, val] of Object.entries(ratings)) {
    ratingsIndex.push({
        normKey:  normalise(key),
        normName: normalise(val.name || key),
        normShort: normalise(val.shortName || ''),
        rating:   val.rating,
        original: val.name || key
    });
}

// ─── Token Jaccard similarity ─────────────────────────────────────────────────
function jaccard(a, b) {
    const setA = new Set(a.split(' ').filter(Boolean));
    const setB = new Set(b.split(' ').filter(Boolean));
    if (setA.size === 0 && setB.size === 0) return 1;
    const intersection = [...setA].filter(t => setB.has(t)).length;
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : intersection / union;
}

function bestMatch(normTarget) {
    let best = null;
    let bestScore = 0;

    for (const entry of ratingsIndex) {
        const s1 = jaccard(normTarget, entry.normKey);
        const s2 = jaccard(normTarget, entry.normName);
        const s3 = jaccard(normTarget, entry.normShort);
        const score = Math.max(s1, s2, s3);

        if (score > bestScore) {
            bestScore = score;
            best = entry;
        }
    }
    return { match: best, score: bestScore };
}

// ─── Process each college in our DB ──────────────────────────────────────────
const MATCH_THRESHOLD = 0.45; // tighter threshold to reduce wrong matches

// Extra guard: if one is pharmacy and the other isn't, reject the match
function isMismatchType(dbName, ratingName) {
    const dbIsPharm   = /pharm|pharmacy/i.test(dbName);
    const rIsPharm    = /pharm|pharmacy/i.test(ratingName);
    return dbIsPharm !== rIsPharm; // one is pharmacy, the other isn't
}

const matched   = [];  // { code, name, oldRating, newRating, matchedTo, score }
const missing   = [];  // { code, name }  — in our DB, no match in Collegedunia

const updatedColleges = { ...colleges };

for (const [code, info] of Object.entries(colleges)) {
    const normName = normalise(info.name || code);
    const { match, score } = bestMatch(normName);

    if (match && score >= MATCH_THRESHOLD && !isMismatchType(info.name || code, match.original)) {
        const oldRating = info.rating;
        updatedColleges[code] = { ...info, rating: match.rating };
        matched.push({
            code,
            name: info.name,
            oldRating,
            newRating: match.rating,
            matchedTo: match.original,
            score: score.toFixed(2)
        });
    } else {
        missing.push({ code, name: info.name });
    }
}

// ─── Save updated colleges_data.json ─────────────────────────────────────────
fs.writeFileSync(outputPath, JSON.stringify(updatedColleges, null, 2), 'utf8');

// ─── Print report ─────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════');
console.log(' AllotIQ Rating Merge Report');
console.log('═══════════════════════════════════════════════════\n');

console.log(`✅ MATCHED & UPDATED: ${matched.length} colleges\n`);
matched.forEach(m => {
    const changed = m.oldRating !== m.newRating ? ' ← CHANGED' : ' (same)';
    console.log(`  [${m.code}] ${m.name.slice(0, 55).padEnd(55)}  ${String(m.oldRating).padStart(3)} → ${String(m.newRating).padStart(3)}  (score:${m.score})${changed}`);
    console.log(`        Matched to: "${m.matchedTo}"`);
});

console.log(`\n❌ NOT FOUND IN COLLEGEDUNIA (rating kept as-is): ${missing.length} colleges\n`);
missing.forEach(m => {
    console.log(`  [${m.code}] ${m.name}`);
});

console.log(`\n✔  colleges_data.json updated at: ${outputPath}`);
console.log('═══════════════════════════════════════════════════\n');
