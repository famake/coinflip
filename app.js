// Ancient Coin Collection App
// Import Three.js dynamically if available
let THREE, GLTFLoader, OBJLoader, OrbitControls, DRACOLoader;
let jsPDFLib = null, html2canvasLib = null;
let threeJsAvailable = false;

// Constants
const PLACEHOLDER_IMAGE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"%3E%3Crect fill="%23f0f0f0" width="400" height="400"/%3E%3Ctext fill="%23999" font-family="sans-serif" font-size="40" x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle"%3ENo Image%3C/text%3E%3C/svg%3E';
const VIEWER_INIT_DELAY = 100; // Delay needed for DOM element to be fully rendered

// Minimal embedded fallback index for common Roman authorities (last-resort when SPARQL is blocked)
// Only include broadly used slugs; candidates will be verified via JSON-LD before shown.
const AUTHORITY_FALLBACK = [
    { label: 'Augustus', slug: 'augustus', aliases: ['octavian'] },
    { label: 'Tiberius', slug: 'tiberius' },
    { label: 'Caligula', slug: 'caligula', aliases: ['gaius'] },
    { label: 'Claudius', slug: 'claudius' },
    { label: 'Nero', slug: 'nero' },
    { label: 'Galba', slug: 'galba' },
    { label: 'Otho', slug: 'otho' },
    { label: 'Vitellius', slug: 'vitellius' },
    { label: 'Vespasian', slug: 'vespasian' },
    { label: 'Titus', slug: 'titus' },
    { label: 'Domitian', slug: 'domitian' },
    { label: 'Nerva', slug: 'nerva' },
    { label: 'Trajan', slug: 'trajan' },
    { label: 'Hadrian', slug: 'hadrian' },
    { label: 'Antoninus Pius', slug: 'antoninus_pius' },
    { label: 'Marcus Aurelius', slug: 'marcus_aurelius' },
    { label: 'Lucius Verus', slug: 'lucius_verus' },
    { label: 'Commodus', slug: 'commodus' },
    { label: 'Pertinax', slug: 'pertinax' },
    { label: 'Didius Julianus', slug: 'didius_julianus' },
    { label: 'Septimius Severus', slug: 'septimius_severus' },
    { label: 'Caracalla', slug: 'caracalla' },
    { label: 'Geta', slug: 'geta' },
    { label: 'Macrinus', slug: 'macrinus' },
    { label: 'Elagabalus', slug: 'elagabalus' },
    { label: 'Severus Alexander', slug: 'severus_alexander' },
    { label: 'Maximinus I Thrax', slug: 'maximinus_i_thrax', aliases: ['maximinus thrax', 'maximinus i'] },
    { label: 'Gordian I', slug: 'gordian_i' },
    { label: 'Gordian II', slug: 'gordian_ii' },
    { label: 'Gordian III', slug: 'gordian_iii' },
    { label: 'Philip I', slug: 'philip_i', aliases: ['philip the arab'] },
    { label: 'Philip II', slug: 'philip_ii' },
    { label: 'Trajan Decius', slug: 'trajan_decius', aliases: ['decius'] },
    { label: 'Trebonianus Gallus', slug: 'trebonianus_gallus' },
    { label: 'Aemilian', slug: 'aemilian' },
    { label: 'Valerian I', slug: 'valerian_i' },
    { label: 'Gallienus', slug: 'gallienus' },
    { label: 'Claudius II Gothicus', slug: 'claudius_ii_gothicus' },
    { label: 'Quintillus', slug: 'quintillus' },
    { label: 'Aurelian', slug: 'aurelian' },
    { label: 'Tacitus', slug: 'tacitus' },
    { label: 'Florianus', slug: 'florianus' },
    { label: 'Probus', slug: 'probus' },
    { label: 'Carus', slug: 'carus' },
    { label: 'Carinus', slug: 'carinus' },
    { label: 'Numerian', slug: 'numerian' },
    { label: 'Diocletian', slug: 'diocletian' },
    { label: 'Maximian', slug: 'maximian' },
    { label: 'Constantius I', slug: 'constantius_i', aliases: ['constantius chlorus'] },
    { label: 'Galerius', slug: 'galerius' },
    { label: 'Constantine I', slug: 'constantine_i' }
];

// Curated broad period/dynasty fallback (approximate ranges, era = CE/BCE) for user-friendly period selection
// Slugs are optional; if present will be verified against Nomisma; otherwise label-only suggestions.
const PERIOD_FALLBACK = [
    { label: 'Roman Republic', from: { year: 509, era: 'BCE' }, to: { year: 27, era: 'BCE' }, slug: 'roman_republic' },
    { label: 'Early Roman Empire', from: { year: 27, era: 'BCE' }, to: { year: 96, era: 'CE' }, slug: 'early_roman_empire' },
    { label: 'Roman Empire', from: { year: 27, era: 'BCE' }, to: { year: 476, era: 'CE' }, slug: 'roman_empire' },
    { label: 'Julio-Claudian Dynasty', from: { year: 27, era: 'BCE' }, to: { year: 68, era: 'CE' } },
    { label: 'Flavian Dynasty', from: { year: 69, era: 'CE' }, to: { year: 96, era: 'CE' } },
    { label: 'Nerva–Antonine Dynasty', from: { year: 96, era: 'CE' }, to: { year: 192, era: 'CE' } },
    { label: 'Severan Dynasty', from: { year: 193, era: 'CE' }, to: { year: 235, era: 'CE' }, slug: 'severan_dynasty' },
    { label: 'Crisis of the Third Century', from: { year: 235, era: 'CE' }, to: { year: 284, era: 'CE' }, slug: 'crisis_of_the_third_century' },
    { label: 'Tetrarchy', from: { year: 284, era: 'CE' }, to: { year: 313, era: 'CE' }, slug: 'tetrarchy' },
    { label: 'Constantinian Period', from: { year: 306, era: 'CE' }, to: { year: 363, era: 'CE' } },
    { label: 'Late Roman Empire', from: { year: 284, era: 'CE' }, to: { year: 476, era: 'CE' }, slug: 'late_roman_empire' }
];

// Lightweight IndexedDB asset storage for large files (e.g., 3D models)
class AssetStorage {
    constructor() {
        this.db = null;
        this.DB_NAME = 'CoinflipDB';
        this.STORE = 'assets';
        this.VERSION = 1;
    }

    async init() {
        if (this.db) return this.db;
        this.db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(this.STORE)) {
                    const store = db.createObjectStore(this.STORE, { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt');
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return this.db;
    }

    _txn(mode = 'readonly') {
        if (!this.db) throw new Error('AssetStorage not initialized');
        return this.db.transaction(this.STORE, mode).objectStore(this.STORE);
    }

    _uuid() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    }

    async add(fileOrBlob, meta = {}) {
        await this.init();
        const id = this._uuid();
        const record = {
            id,
            blob: fileOrBlob,
            filename: meta.filename || fileOrBlob.name || 'asset.bin',
            type: meta.type || fileOrBlob.type || 'application/octet-stream',
            size: meta.size || fileOrBlob.size || 0,
            createdAt: Date.now()
        };
        await new Promise((resolve, reject) => {
            const req = this._txn('readwrite').add(record);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
        return id;
    }

    async get(id) {
        await this.init();
        return await new Promise((resolve, reject) => {
            const req = this._txn('readonly').get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async delete(id) {
        await this.init();
        return await new Promise((resolve, reject) => {
            const req = this._txn('readwrite').delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
}

const assetStorage = new AssetStorage();

// Try to load Three.js modules
async function loadThreeJS() {
    try {
        const threeModule = await import('three');
        THREE = threeModule;
        
        const { OrbitControls: OC } = await import('three/addons/controls/OrbitControls.js');
        OrbitControls = OC;
        
        const { GLTFLoader: GL } = await import('three/addons/loaders/GLTFLoader.js');
        GLTFLoader = GL;
        
        const { OBJLoader: OL } = await import('three/addons/loaders/OBJLoader.js');
        OBJLoader = OL;
    const { DRACOLoader: DL } = await import('three/addons/loaders/DRACOLoader.js');
    DRACOLoader = DL;
        
        threeJsAvailable = true;
    } catch (error) {
        console.warn('Three.js not available, 3D viewer will use fallback mode');
        threeJsAvailable = false;
    }
}

// Lazy-load PDF export libs (UMD builds via script tags for wide compatibility)
async function loadPdfLibs() {
    if (jsPDFLib && html2canvasLib) return;
    const loadScript = (src) => new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load ' + src));
        document.head.appendChild(s);
    });
    // Use widely cached UMD builds
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    jsPDFLib = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || null);
    html2canvasLib = window.html2canvas || null;
    if (!jsPDFLib || !html2canvasLib) throw new Error('PDF libraries not available');
}

class CoinCollection {
    constructor() {
        this.coins = this.loadCoins();
        this.currentViewer = null;
    this.selectedForPrint = new Set(JSON.parse(localStorage.getItem('selectedForPrint') || '[]'));
        this.editingCoinId = null; // when set, form updates existing coin
        // Simple in-memory cache for enrichment fetches (resets on reload)
        this._enrichCache = new Map();
        this.initEventListeners();
        this.renderCoins();
    }

    // Load coins from localStorage
    loadCoins() {
        const saved = localStorage.getItem('coinCollection');
        return saved ? JSON.parse(saved) : [];
    }

    // ---------- Enrichment Helpers ----------
    // Try to discover a Nomisma ID/URL from free text
    _extractNomismaFromText(text) {
        if (!text) return null;
        const m = String(text).match(/https?:\/\/nomisma\.org\/id\/([a-z0-9\-]+)/i);
        return m ? `https://nomisma.org/id/${m[1].toLowerCase()}` : null;
    }
    // Build contextual search URLs (no network) for quick external lookups
    buildSearchLinks(coin) {
        const nameParts = [coin.name, coin.ruler, coin.origin].filter(Boolean).join(' ');
        const q = encodeURIComponent(nameParts.trim() || coin.name || '');
        const links = {
            nomisma: coin.external_ids?.nomisma ? this._normalizeNomismaUrl(coin.external_ids.nomisma) : (q ? `https://nomisma.org/search/?q=${q}` : null),
            wikidata: coin.external_ids?.wikidata ? this._normalizeWikidataUrl(coin.external_ids.wikidata) : (q ? `https://www.wikidata.org/w/index.php?search=${q}` : null)
        };
        return links;
    }

    _normalizeNomismaUrl(id) {
        if (!id) return null;
        const s = String(id).trim();
        if (/^https?:/i.test(s)) {
            // Normalize to HTTPS to avoid mixed-content in secure contexts
            const noFrag = s.split('#')[0].replace(/\.(json|jsonld)$/i, '');
            return noFrag.replace(/^http:/i, 'https:');
        }
        const base = s.replace(/\.(json|jsonld)$/i, '');
        return `https://nomisma.org/id/${base}`;
    }
    _normalizeWikidataUrl(id) {
        if (!id) return null;
        if (/^https?:/i.test(id)) return id;
        return `https://www.wikidata.org/wiki/${id}`;
    }
    // Removed Pleiades/OCRE normalization (simplified scope)

    // Enrich coin: currently builds search URLs and optionally derives basic snapshot facts
    async enrichCoin(id, { force = false, linksOnly = false } = {}) {
        const coin = this.coins.find(c => c.id === id);
        if (!coin) return;
        coin.external_ids = coin.external_ids || { nomisma: null, wikidata: null, searchUrls: null };
        // Auto-detect Nomisma from references/description if not set
        if (!coin.external_ids.nomisma) {
            const fromRefs = this._extractNomismaFromText(coin.references);
            const fromDesc = this._extractNomismaFromText(coin.description);
            coin.external_ids.nomisma = fromRefs || fromDesc || null;
        }
        // Build basic search links for optional usage; not shown in simplified UI
        const cacheKey = `links:${id}:${coin.name}:${coin.ruler}:${coin.origin}`;
        if (force || !this._enrichCache.has(cacheKey)) {
            const links = this.buildSearchLinks(coin);
            coin.external_ids.searchUrls = links;
            this._enrichCache.set(cacheKey, links);
        }
        if (!linksOnly) {
            // Perform external lookups (Nomisma via ID or search, Wikidata via search + entity fetch + Wikipedia summary)
            try {
                const snapshot = await this._fetchExternalEnrichment(coin);
                if (snapshot) {
                    coin.facts_snapshot = snapshot;
                    coin.enrichment_status = 'snapshot';
                    coin.enrichment_fetched_at = new Date().toISOString();
                }
            } catch (e) {
                console.warn('Enrichment fetch failed:', e);
                coin.enrichment_status = 'error';
            }
        }
        this.saveCoins();
    }

    // Period fallback: overlap match between user year(s) and curated ranges. If user types label text, also fuzzy match.
    async periodFallbackSuggestions(term, limit = 6) {
        const raw = String(term || '').trim();
        const lc = raw.toLowerCase();
        // Parse inline year(s) like "239-240", "240AD", "240 CE"
        const yearTokens = lc.replace(/ad|ce|bce|\s+/gi,' ').trim();
        let hintYears = [];
        const rangeMatch = yearTokens.match(/(\d{1,4})\s*[-–]\s*(\d{1,4})/);
        if (rangeMatch) {
            hintYears = [parseInt(rangeMatch[1],10), parseInt(rangeMatch[2],10)];
        } else {
            const singleMatch = yearTokens.match(/(\d{1,4})/);
            if (singleMatch) hintYears = [parseInt(singleMatch[1],10)];
        }
        // Derive start/end from explicit date range fields if present
        const sy = document.getElementById('dateStartYear');
        const se = document.getElementById('dateStartEra');
        const ey = document.getElementById('dateEndYear');
        const ee = document.getElementById('dateEndEra');
        const startVal = sy && sy.value ? parseInt(sy.value,10) : null;
        const endVal = ey && ey.value ? parseInt(ey.value,10) : null;
        const startEra = se ? se.value : 'CE';
        const endEra = ee ? ee.value : 'CE';
        const yearsFromRange = [];
        if (startVal) yearsFromRange.push(startEra === 'BCE' ? -startVal : startVal);
        if (endVal) yearsFromRange.push(endEra === 'BCE' ? -endVal : endVal);
        // Normalize hint years (BCE negative if token includes bce)
        const bceFlag = /bce/.test(lc);
        hintYears = hintYears.map(y => bceFlag ? -y : y);
        if (yearsFromRange.length) {
            hintYears = yearsFromRange;
        }
        const yearStart = hintYears[0];
        const yearEnd = hintYears[1] || hintYears[0];
        const overlaps = (entry) => {
            const from = entry.from ? (entry.from.era === 'BCE' ? -entry.from.year : entry.from.year) : null;
            const to = entry.to ? (entry.to.era === 'BCE' ? -entry.to.year : entry.to.year) : null;
            if (from==null || to==null || yearStart==null) return false;
            return (yearStart <= to) && (yearEnd >= from);
        };
        const scored = [];
        for (const p of PERIOD_FALLBACK) {
            let score = 0;
            if (yearStart != null && overlaps(p)) score += 100;
            if (lc && p.label.toLowerCase().includes(lc)) score += 40;
            // Slight boost for macro umbrella periods to appear alongside dynasties
            if (/roman empire|principate/.test(p.label.toLowerCase())) score += 10;
            scored.push({ p, score });
        }
        scored.sort((a,b)=> b.score - a.score);
        // Always try to include top macro umbrella if overlapped
        const overlapped = scored.filter(x=> x.score>0);
        let picks = overlapped.slice(0, limit);
        const macro = overlapped.find(x=> /roman empire/.test(x.p.label.toLowerCase()));
        if (macro && !picks.includes(macro)) {
            picks = [macro, ...picks.filter(x=> x!==macro)].slice(0, limit);
        }
        const out = [];
        for (const {p} of picks) {
            if (p.slug) {
                try {
                    const info = await this._enrichNomisma(`https://nomisma.org/id/${p.slug}`);
                    if (info) {
                        out.push({ id: info.uri, label: info.label || p.label, qid: info.wikidata || null });
                        continue;
                    }
                } catch(_){}
            }
            out.push({ id: p.label, label: p.label, labelOnly: true });
        }
        return out;
    }

    async refreshSnapshot(id) {
        // For now, just rebuild local snapshot (future: external fetches)
        return this.enrichCoin(id, { force: true, linksOnly: false });
    }

    // LocalStorage TTL cache helpers
    _cacheKey(key) { return `enrichCache:${key}`; }
    setCache(key, value, ttlMs = 1000 * 60 * 60 * 24) { // default 24h
        try {
            const rec = { v: value, exp: Date.now() + ttlMs };
            localStorage.setItem(this._cacheKey(key), JSON.stringify(rec));
        } catch (_) {}
    }
    getCache(key) {
        try {
            const raw = localStorage.getItem(this._cacheKey(key));
            if (!raw) return null;
            const rec = JSON.parse(raw);
            if (Date.now() > rec.exp) { localStorage.removeItem(this._cacheKey(key)); return null; }
            return rec.v;
        } catch (_) { return null; }
    }

    async _fetchExternalEnrichment(coin) {
        const snapshot = {
            label: coin.name || null,
            date: (coin.date && typeof coin.date === 'object') ? [coin.date.label || null, this._formatDateRange(coin.date.exact)].filter(Boolean).join(' ') || null : (coin.date || null),
            authority: (coin.ruler && typeof coin.ruler === 'object') ? (coin.ruler.label || null) : (coin.ruler || null),
            mint: (coin.origin && typeof coin.origin === 'object') ? (coin.origin.label || null) : (coin.origin || null),
            material: coin.material || null,
            specs: {
                weight_g: coin.weight || null,
                diameter_mm: coin.diameter || null
            },
            refs: coin.references || null,
            updatedLocal: new Date().toISOString()
        };

        const opts = coin.enrichment_opts || { ruler: true, origin: true, date: true };
        
        // Enrich per-field Nomisma URIs if present
        let qidFromNomismaAuthority = null;
        let qidFromNomismaMint = null;
        let qidFromNomismaPeriod = null;
        const nomismaTasks = [];
        if (coin.ruler && typeof coin.ruler === 'object' && coin.ruler.nomisma_uri) {
            nomismaTasks.push((async ()=>{
                try { snapshot.nomisma_ruler = await this._enrichNomisma(coin.ruler.nomisma_uri); qidFromNomismaAuthority = snapshot.nomisma_ruler?.wikidata || null; } catch(_){}
            })());
        }
        if (coin.origin && typeof coin.origin === 'object' && coin.origin.nomisma_uri) {
            nomismaTasks.push((async ()=>{
                try { snapshot.nomisma_origin = await this._enrichNomisma(coin.origin.nomisma_uri); qidFromNomismaMint = snapshot.nomisma_origin?.wikidata || null; } catch(_){}
            })());
        }
        if (coin.date && typeof coin.date === 'object' && coin.date.nomisma_uri) {
            nomismaTasks.push((async ()=>{
                try { snapshot.nomisma_period = await this._enrichNomisma(coin.date.nomisma_uri); qidFromNomismaPeriod = snapshot.nomisma_period?.wikidata || null; } catch(_){}
            })());
        }
        // Legacy: if a global Nomisma URL was set on the coin, keep enriching it too
        if (coin.external_ids && coin.external_ids.nomisma) {
            nomismaTasks.push((async ()=>{
                try { snapshot.nomisma = await this._enrichNomisma(coin.external_ids.nomisma); } catch(_){}
            })());
        }
        if (nomismaTasks.length) { try { await Promise.all(nomismaTasks); } catch(_){}
        }

        // Wikidata enrichment for authority (only if QID is sourced from Nomisma)
        const qidAuthority = (typeof coin.ruler === 'object' && coin.ruler.wikidata_qid) || qidFromNomismaAuthority || null;
        if (opts.ruler && qidAuthority) {
            try {
                const authInfo = await this._enrichWikidataEntity(qidAuthority, 'authority');
                if (authInfo) snapshot.authority_info = authInfo;
            } catch (e) { console.debug('Authority enrichment failed', e); }
        }
        // Mint enrichment (only if QID from Nomisma)
        const qidMint = (typeof coin.origin === 'object' && coin.origin.wikidata_qid) || qidFromNomismaMint || null;
        if (opts.origin && qidMint) {
            try {
                const mintInfo = await this._enrichWikidataEntity(qidMint, 'mint');
                if (mintInfo) snapshot.mint_info = mintInfo;
            } catch (e) { console.debug('Mint enrichment failed', e); }
        }
        // Period enrichment (only if QID from Nomisma)
        const qidPeriod = (typeof coin.date === 'object' && coin.date.wikidata_qid) || qidFromNomismaPeriod || null;
        if (opts.date && qidPeriod) {
            try {
                const periodInfo = await this._enrichWikidataEntity(qidPeriod, 'period');
                if (periodInfo) snapshot.period_info = periodInfo;
            } catch (e) { console.debug('Period enrichment failed', e); }
        }
        return snapshot;
    }

    async _enrichWikidataEntity(term, kind = 'generic') {
        const normalized = String(term).trim();
        if (!normalized) return null;
        const cacheHit = this.getCache(`wikidata:${normalized}`);
        if (cacheHit) return cacheHit;
        // Step 1: if input is QID, skip search
        let qid = null, label = null, description = null;
        if (/^Q\d+$/i.test(normalized)) {
            qid = normalized.toUpperCase();
        } else {
            try {
                const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(normalized)}&language=en&limit=5&format=json&origin=*`;
                const res = await this._fetchWithTimeout(searchUrl, { timeout: 12000 });
                const data = await res.json();
                if (data.search && data.search.length > 0) {
                    // Rank candidates using P31 classes and description keywords
                    const candidates = data.search.slice(0, 5);
                    const scored = [];
                    for (const hit of candidates) {
                        const eid = hit.id;
                        let score = 0;
                        // quick keyword filtering from description
                        const desc = (hit.description || '').toLowerCase();
                        if (/ship|vessel|album|song|novel|film|company|magazine|newspaper/.test(desc)) score -= 100;
                        // fetch entity to inspect P31
                        try {
                            const entRes = await this._fetchWithTimeout(`https://www.wikidata.org/wiki/Special:EntityData/${eid}.json`, { timeout: 12000 });
                            const ed = await entRes.json();
                            const ent = ed.entities && ed.entities[eid];
                            const p31 = ent && ent.claims && ent.claims.P31 ? ent.claims.P31.map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id).filter(Boolean) : [];
                            const has = (q) => p31.includes(q);
                            // Scoring by kind
                            if (kind === 'authority') {
                                if (has('Q5')) score += 100; // human
                                if (has('Q5119')) score += 80; // city-state
                                if (has('Q6256')) score += 70; // country/state
                                if (has('Q43229')) score += 60; // organization
                                if (has('Q11446')) score -= 200; // ship
                            } else if (kind === 'mint') {
                                if (has('Q515')) score += 100; // city
                                if (has('Q1637706')) score += 90; // ancient city
                                if (has('Q15284')) score += 85; // polis
                                if (has('Q11446')) score -= 200; // ship
                                if (has('Q5')) score -= 50; // human (unlikely for mint)
                            } else if (kind === 'period') {
                                if (has('Q11514315')) score += 100; // historical period
                                if (has('Q577')) score += 60; // year
                                if (has('Q577') && /bc|ad|bce|ce|century|period/.test(desc)) score += 20;
                            }
                            // prefer exact label matches
                            if (hit.label && hit.label.toLowerCase() === normalized.toLowerCase()) score += 10;
                            scored.push({ hit, score, ent });
                        } catch (_) { scored.push({ hit, score, ent: null }); }
                    }
                    scored.sort((a,b)=> b.score - a.score);
                    if (scored.length > 0) {
                        const top = scored[0];
                        qid = top.hit.id; label = top.hit.label; description = top.hit.description;
                    }
                }
            } catch (e) { console.debug('Wikidata search error', e); }
        }
        if (!qid) return null;
        // Step 2: fetch entity claims + site links
        let wikipedia = null;
        try {
            const entityUrl = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`; // CORS OK
            const res = await this._fetchWithTimeout(entityUrl, { timeout: 12000 });
            const data = await res.json();
            const ent = data.entities && data.entities[qid];
            if (ent && ent.sitelinks && ent.sitelinks.enwiki) {
                wikipedia = await this._fetchWikipediaSummary(ent.sitelinks.enwiki.title);
            }
            if (!label && ent && ent.labels && ent.labels.en) label = ent.labels.en.value;
            if (!description && ent && ent.descriptions && ent.descriptions.en) description = ent.descriptions.en.value;
        } catch (e) { console.debug('Entity fetch error', e); }
        const info = { qid, label, description, wikipedia };
        this.setCache(`wikidata:${normalized}`, info); // cache enriched info
        return info;
    }

    async _enrichNomisma(idOrUrl) {
        const baseUrl = this._normalizeNomismaUrl(idOrUrl);
        if (!baseUrl) return null;
        const cacheHit = this.getCache(`nomisma:${baseUrl}`);
        if (cacheHit) return cacheHit;
        // Try HTTPS first, then HTTP, and both JSON-LD and Accept header variants
        const httpsBase = baseUrl.replace(/^http:/i, 'https:');
        const httpBase = baseUrl.replace(/^https:/i, 'http:');
        const candidates = [
            `${httpsBase}.jsonld`,
            httpsBase,
            `${httpBase}.jsonld`,
            httpBase
        ];
        let data = null, finalUrl = null;
        for (const u of candidates) {
            try {
                const isJsonld = /\.jsonld$/i.test(u);
                const res = await this._fetchWithTimeout(u, { timeout: 12000, init: isJsonld ? {} : { headers: { Accept: 'application/ld+json, application/json;q=0.9, */*;q=0.1' } } });
                const ctype = res.headers.get('content-type') || '';
                if (!/json/i.test(ctype)) { continue; }
                data = await res.json();
                finalUrl = u;
                break;
            } catch (_) { /* try next */ }
        }
        if (!data) return null;
        // JSON-LD graph; find node matching @id
    const graph = Array.isArray(data['@graph']) ? data['@graph'] : [data];
    const node = graph.find(n => n['@id'] === baseUrl || n['@id'] === finalUrl) || graph[0];
        if (!node) return null;
        const getEn = (v) => {
            if (!v) return null;
            if (Array.isArray(v)) {
                const en = v.find(x => x['@language'] === 'en');
                return (en && en['@value']) || (v[0]['@value'] || String(v[0]));
            }
            if (typeof v === 'object' && v['@value']) return v['@value'];
            return String(v);
        };
        const getNum = (v) => {
            if (v == null) return null;
            if (typeof v === 'object' && v['@value'] != null) return parseFloat(v['@value']);
            const n = parseFloat(String(v));
            return isNaN(n) ? null : n;
        };
        const label = getEn(node['http://www.w3.org/2004/02/skos/core#prefLabel']) || getEn(node['label']) || null;
        const definition = getEn(node['http://www.w3.org/2004/02/skos/core#definition']) || getEn(node['http://www.w3.org/2004/02/skos/core#scopeNote']) || null;
        let wikidata = null;
        const exact = node['http://www.w3.org/2004/02/skos/core#exactMatch'] || node['exactMatch'];
        const exactArr = Array.isArray(exact) ? exact : (exact ? [exact] : []);
        for (const em of exactArr) {
            const val = (typeof em === 'string') ? em : (em['@id'] || em['@value'] || '');
            const m = val.match(/wikidata\.org\/entity\/(Q\d+)/i);
            if (m) { wikidata = m[1].toUpperCase(); break; }
        }
        // Coordinates (common in Nomisma with WGS84)
        const lat = getNum(node['http://www.w3.org/2003/01/geo/wgs84_pos#lat']) || getNum(node['geo:lat']) || null;
        const lon = getNum(node['http://www.w3.org/2003/01/geo/wgs84_pos#long']) || getNum(node['geo:long']) || null;
        const info = { uri: baseUrl, label, definition, wikidata, coordinates: (lat != null && lon != null) ? { lat, lon } : null };
        this.setCache(`nomisma:${baseUrl}`, info);
        return info;
    }

    async _fetchWikipediaSummary(title) {
        try {
            const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
            const res = await this._fetchWithTimeout(summaryUrl, { timeout: 12000 });
            if (!res.ok) return null;
            return await res.json();
        } catch (_) { return null; }
    }

    async _fetchWithTimeout(url, { timeout = 10000, retries = 1, init = {} } = {}) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), timeout);
            try {
                const res = await fetch(url, { ...init, signal: controller.signal });
                clearTimeout(t);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res;
            } catch (e) {
                clearTimeout(t);
                if (attempt === retries) throw e;
                // simple backoff before retrying
                await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
            }
        }
        throw new Error('Failed fetch');
    }

    // Save coins to localStorage
    saveCoins() {
        try {
            localStorage.setItem('coinCollection', JSON.stringify(this.coins));
        } catch (err) {
            if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
                throw new Error('LOCALSTORAGE_QUOTA');
            }
            throw err;
        }
    }

    // Initialize event listeners
    initEventListeners() {
        // Toggle form visibility
        document.getElementById('toggleFormBtn').addEventListener('click', () => {
            document.getElementById('addCoinForm').classList.toggle('hidden');
        });

        // Form submission
        document.getElementById('coinForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addCoin();
        });

        // Scoped Nomisma search events for Origin/Mint, Ruler/Authority, Period
        this._initScopedNomisma('origin', {
            inputId: 'coinOrigin',
            buttonId: 'originSearchBtn',
            suggestId: 'originSuggest',
            chipId: 'originChip',
            types: ['place','mint']
        });
        this._initScopedNomisma('ruler', {
            inputId: 'coinRuler',
            buttonId: 'rulerSearchBtn',
            suggestId: 'rulerSuggest',
            chipId: 'rulerChip',
            types: ['person','authority']
        });
        this._initScopedNomisma('period', {
            inputId: 'coinDate',
            buttonId: 'periodSearchBtn',
            suggestId: 'periodSuggest',
            chipId: 'periodChip',
            types: ['period']
        });

        // Material dropdown logic
        const matSel = document.getElementById('coinMaterialSelect');
        const matOther = document.getElementById('coinMaterialOther');
        if (matSel && matOther) {
            matSel.addEventListener('change', () => {
                matOther.style.display = matSel.value === 'OTHER' ? 'block' : 'none';
            });
        }

        // Global click: dismiss any open suggestions when clicking outside
        document.addEventListener('click', (e) => {
            const ids = ['originSuggest','rulerSuggest','periodSuggest'];
            ids.forEach(id => {
                const box = document.getElementById(id);
                if (!box || box.style.display === 'none') return;
                const input = id==='originSuggest'? document.getElementById('coinOrigin') : id==='rulerSuggest' ? document.getElementById('coinRuler') : document.getElementById('coinDate');
                const btn = id==='originSuggest'? document.getElementById('originSearchBtn') : id==='rulerSuggest'? document.getElementById('rulerSearchBtn') : document.getElementById('periodSearchBtn');
                const clickedInside = box.contains(e.target) || input.contains?.(e.target) || btn.contains?.(e.target) || (e.target===input) || (e.target===btn);
                if (!clickedInside) box.style.display = 'none';
            });
        });

        // Cancel button
        document.getElementById('cancelBtn').addEventListener('click', () => {
            this.resetFormToAddMode();
        });

        // Search functionality
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.filterCoins(e.target.value);
        });

        // Sort functionality
        document.getElementById('sortSelect').addEventListener('change', (e) => {
            this.sortCoins(e.target.value);
        });

        // Actions dropdown (Select for Print / Export / Import)
        const actionsBtn = document.getElementById('actionsBtn');
        const actionsMenu = document.getElementById('actionsMenu');
        const selModeBtn = document.getElementById('toggleSelectionModeBtn');
        if (actionsBtn && actionsMenu) {
            const hideMenu = () => { actionsMenu.style.display = 'none'; actionsBtn.setAttribute('aria-expanded', 'false'); };
            const showMenu = () => { actionsMenu.style.display = 'block'; actionsBtn.setAttribute('aria-expanded', 'true'); };
            actionsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = actionsMenu.style.display === 'block';
                if (isOpen) hideMenu(); else showMenu();
            });
            document.addEventListener('click', (e) => {
                if (!actionsMenu.contains(e.target) && e.target !== actionsBtn) hideMenu();
            });
        }
        // Selection mode toggle in dropdown
        if (selModeBtn) {
            selModeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOn = document.body.classList.toggle('selection-mode');
                selModeBtn.setAttribute('aria-pressed', String(isOn));
                selModeBtn.textContent = isOn ? 'Done Selecting' : 'Select for Print';
                const actionsMenu = document.getElementById('actionsMenu'); if (actionsMenu) actionsMenu.style.display = 'none';
                const actionsBtn = document.getElementById('actionsBtn'); if (actionsBtn) actionsBtn.setAttribute('aria-expanded', 'false');
            });
        }

        // Import/Export buttons
        const exportBtnJson = document.getElementById('exportJsonBtn');
        const importBtnJson = document.getElementById('importJsonBtn');
        const importFile = document.getElementById('importJsonFile');
        if (exportBtnJson) exportBtnJson.addEventListener('click', () => this.exportCollection());
        if (importBtnJson && importFile) {
            importBtnJson.addEventListener('click', () => importFile.click());
            importFile.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                try {
                    await this.importCollection(file);
                } finally {
                    e.target.value = '';
                }
            });
        }

        // Close modal
        document.querySelector('.close-modal').addEventListener('click', () => {
            this.closeModal();
        });

        // Close modal on outside click
        document.getElementById('coinModal').addEventListener('click', (e) => {
            if (e.target.id === 'coinModal') {
                this.closeModal();
            }
        });

        // Print bar controls
        const clearBtn = document.getElementById('clearSelection');
        const openBtn = document.getElementById('openPrintTickets');
        const delSelBtn = document.getElementById('deleteSelected');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.selectedForPrint.clear();
                this.renderCoins();
                this.updatePrintBar();
            });
        }
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                this.openPrintTickets();
            });
        }
        if (delSelBtn) {
            delSelBtn.addEventListener('click', async () => {
                const count = this.selectedForPrint.size;
                if (count === 0) return;
                if (!confirm(`Delete ${count} selected coin(s)? This cannot be undone.`)) return;
                // Collect before mutating
                const ids = Array.from(this.selectedForPrint);
                // Delete assets and remove coins
                for (const id of ids) {
                    const coin = this.coins.find(c => c.id === id);
                    if (!coin) continue;
                    // Remove IndexedDB asset if present
                    try {
                        if (coin.model3D && coin.model3D.assetId) {
                            await assetStorage.init();
                            await assetStorage.delete(coin.model3D.assetId);
                        }
                    } catch (_) {}
                    // Remove from array
                    this.coins = this.coins.filter(c => c.id !== id);
                }
                this.selectedForPrint.clear();
                this.saveCoins();
                this.renderCoins();
                this.updatePrintBar();
            });
        }
    }

    // Switch form into Edit mode for a specific coin
    openEditCoin(id) {
        const coin = this.coins.find(c => c.id === id);
        if (!coin) return;
        this.editingCoinId = id;
        document.getElementById('addCoinForm').classList.remove('hidden');
        document.getElementById('formTitle').textContent = 'Edit Coin';
        const saveBtn = document.getElementById('saveCoinBtn');
        if (saveBtn) saveBtn.textContent = 'Update Coin';
        // Populate fields (file inputs cannot be prefilled)
        document.getElementById('coinName').value = coin.name || '';
    // Date/Period text + exact range
    if (typeof coin.date === 'object' && coin.date) {
        document.getElementById('coinDate').value = coin.date.label || '';
        const ex = coin.date.exact || null;
        const sy = document.getElementById('dateStartYear');
        const se = document.getElementById('dateStartEra');
        const ey = document.getElementById('dateEndYear');
        const ee = document.getElementById('dateEndEra');
        if (sy) sy.value = ex?.from?.year || '';
        if (se) se.value = ex?.from?.era || 'CE';
        if (ey) ey.value = ex?.to?.year || '';
        if (ee) ee.value = ex?.to?.era || 'CE';
    } else {
        document.getElementById('coinDate').value = coin.date || '';
    }
    document.getElementById('coinOrigin').value = coin.origin?.label || coin.origin || '';
    document.getElementById('coinRuler').value = coin.ruler?.label || coin.ruler || '';
        const matSel = document.getElementById('coinMaterialSelect');
        const matOther = document.getElementById('coinMaterialOther');
        if (matSel && matOther) {
            if (coin.material && ['AR','AV','AE','EL','BI','CU'].includes(coin.material.code || coin.material)) {
                matSel.value = coin.material.code || coin.material;
                matOther.style.display = 'none';
                matOther.value = '';
            } else if (coin.material && coin.material.label) {
                matSel.value = 'OTHER';
                matOther.style.display = 'block';
                matOther.value = coin.material.label;
            } else if (typeof coin.material === 'string' && coin.material) {
                matSel.value = 'OTHER';
                matOther.style.display = 'block';
                matOther.value = coin.material;
            } else {
                matSel.value = '';
                matOther.style.display = 'none';
                matOther.value = '';
            }
        }
        document.getElementById('coinWeight').value = coin.weight || '';
        document.getElementById('coinDiameter').value = coin.diameter || '';
        document.getElementById('coinDescription').value = coin.description || '';
        const refsEl = document.getElementById('coinReferences');
        if (refsEl) refsEl.value = coin.references || '';
        // Restore chips if structured selections exist
        const originChip = document.getElementById('originChip');
        const originInput = document.getElementById('coinOrigin');
        if (coin.origin && typeof coin.origin === 'object' && coin.origin.nomisma_uri && originChip && originInput) {
            originInput.dataset.nomismaUri = coin.origin.nomisma_uri;
            originInput.dataset.nomismaQid = coin.origin.wikidata_qid || '';
            originInput.dataset.nomismaLabel = coin.origin.label || '';
            originChip.innerHTML = this._renderChip(coin.origin.label || '', coin.origin.nomisma_uri);
        }
        const rulerChip = document.getElementById('rulerChip');
        const rulerInput = document.getElementById('coinRuler');
        if (coin.ruler && typeof coin.ruler === 'object' && coin.ruler.nomisma_uri && rulerChip && rulerInput) {
            rulerInput.dataset.nomismaUri = coin.ruler.nomisma_uri;
            rulerInput.dataset.nomismaQid = coin.ruler.wikidata_qid || '';
            rulerInput.dataset.nomismaLabel = coin.ruler.label || '';
            rulerChip.innerHTML = this._renderChip(coin.ruler.label || '', coin.ruler.nomisma_uri);
        }
        const periodChip = document.getElementById('periodChip');
        const periodInput = document.getElementById('coinDate');
        if (coin.date && typeof coin.date === 'object' && coin.date.nomisma_uri && periodChip && periodInput) {
            periodInput.dataset.nomismaUri = coin.date.nomisma_uri;
            periodInput.dataset.nomismaQid = coin.date.wikidata_qid || '';
            periodInput.dataset.nomismaLabel = coin.date.label || '';
            periodChip.innerHTML = this._renderChip(coin.date.label || '', coin.date.nomisma_uri);
        }
        // Enrichment toggles (consolidated)
        const opts = coin.enrichment_opts || { ruler: true, origin: true, date: true };
        const chkR = document.getElementById('enrichUseRuler'); if (chkR) chkR.checked = !!opts.ruler;
        const chkO = document.getElementById('enrichUseOrigin'); if (chkO) chkO.checked = !!opts.origin;
        const chkD = document.getElementById('enrichUsePeriod'); if (chkD) chkD.checked = !!opts.date;
        document.getElementById('coinObverse').value = coin.obverse || '';
        document.getElementById('coinReverse').value = coin.reverse || '';
        // Clear file inputs
        const imgs = document.getElementById('coinImages'); if (imgs) imgs.value = '';
        const model = document.getElementById('coin3DModel'); if (model) model.value = '';
        // Scroll into view
        try { document.getElementById('addCoinForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
    }

    // Reset form back to Add mode
    resetFormToAddMode() {
        this.editingCoinId = null;
        document.getElementById('coinForm').reset();
        const title = document.getElementById('formTitle'); if (title) title.textContent = 'Add a New Coin';
        const saveBtn = document.getElementById('saveCoinBtn'); if (saveBtn) saveBtn.textContent = 'Save Coin';
        document.getElementById('addCoinForm').classList.add('hidden');
        // Clear date range fields
        const sy = document.getElementById('dateStartYear'); if (sy) sy.value='';
        const se = document.getElementById('dateStartEra'); if (se) se.value='CE';
        const ey = document.getElementById('dateEndYear'); if (ey) ey.value='';
        const ee = document.getElementById('dateEndEra'); if (ee) ee.value='CE';
    }

    // Export all coins to a downloadable JSON file
    exportCollection() {
        try {
            const payload = {
                version: 1,
                exportedAt: new Date().toISOString(),
                count: this.coins.length,
                coins: this.coins
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `coin-collection-${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Export failed:', err);
            alert('Failed to export collection. See console for details.');
        }
    }

    // Import coins from a JSON file, replacing the current collection
    async importCollection(file) {
        const text = await file.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            alert('Invalid JSON file.');
            return;
        }
        const coins = (data && Array.isArray(data.coins)) ? data.coins : (Array.isArray(data) ? data : null);
        if (!coins) {
            alert('JSON does not contain a coins array.');
            return;
        }
        if (!confirm(`Import ${coins.length} coin(s) and replace current collection?`)) return;
        try {
            // Basic normalization: ensure required fields exist
            const normalized = coins.map(c => ({
                id: c.id || Date.now() + Math.floor(Math.random()*100000),
                name: c.name || 'Untitled',
                date: (typeof c.date === 'object' && c.date) ? c.date : (c.date || ''),
                origin: c.origin || '',
                ruler: c.ruler || '',
                material: c.material || '',
                weight: c.weight || '',
                diameter: c.diameter || '',
                description: c.description || '',
                references: c.references || '',
                obverse: c.obverse || '',
                reverse: c.reverse || '',
                images: Array.isArray(c.images) ? c.images : [],
                model3D: c.model3D && c.model3D.assetId ? c.model3D : null,
                addedDate: c.addedDate || new Date().toISOString(),
                // Enrichment fields (remove pleiades/ocre to simplify)
                external_ids: c.external_ids ? {
                    nomisma: c.external_ids.nomisma || null,
                    wikidata: c.external_ids.wikidata || null,
                    searchUrls: c.external_ids.searchUrls || null
                } : { nomisma: null, wikidata: null, searchUrls: null },
                facts_snapshot: c.facts_snapshot || null,
                enrichment_status: c.enrichment_status || 'idle',
                enrichment_fetched_at: c.enrichment_fetched_at || null
            }));
            this.coins = normalized;
            this.selectedForPrint.clear();
            this.saveCoins();
            this.renderCoins();
            alert('Import completed. Note: 3D model binaries are not included in JSON and may need to be re-uploaded.');
        } catch (err) {
            if (err && err.message === 'LOCALSTORAGE_QUOTA') {
                alert('Import exceeds browser storage quota. Try removing some images or splitting the file.');
                return;
            }
            console.error('Import failed:', err);
            alert('Failed to import collection. See console for details.');
        }
    }

    // Add a new coin
    async addCoin() {
        const isEdit = !!this.editingCoinId;
        const name = document.getElementById('coinName').value;
    const date = document.getElementById('coinDate').value;
    const origin = document.getElementById('coinOrigin').value;
    const ruler = document.getElementById('coinRuler').value;
        const matSel = document.getElementById('coinMaterialSelect');
        const matOther = document.getElementById('coinMaterialOther');
        const material = (() => {
            if (!matSel) return '';
            if (matSel.value === 'OTHER') return { code: null, label: (matOther?.value || '').trim() };
            if (!matSel.value) return '';
            const map = { AR:'Silver (AR)', AV:'Gold (AV)', AE:'Bronze (AE)', EL:'Electrum (EL)', BI:'Billon (BI)', CU:'Copper (CU)' };
            return { code: matSel.value, label: map[matSel.value] };
        })();
        const weight = document.getElementById('coinWeight').value;
        const diameter = document.getElementById('coinDiameter').value;
        const description = document.getElementById('coinDescription').value;
        const references = (document.getElementById('coinReferences')?.value) || '';
        const obverse = document.getElementById('coinObverse').value;
        const reverse = document.getElementById('coinReverse').value;

        const imageFiles = document.getElementById('coinImages').files;
        const modelFile = document.getElementById('coin3DModel').files[0];
    const nomismaId = (document.getElementById('coinNomismaId')?.value || '').trim() || null;
        const useRulerEnrich = !!document.getElementById('enrichUseRuler')?.checked;
        const useOriginEnrich = !!document.getElementById('enrichUseOrigin')?.checked;
        const useDateEnrich = !!document.getElementById('enrichUsePeriod')?.checked;

        if (isEdit) {
            const coin = this.coins.find(c => c.id === this.editingCoinId);
            if (!coin) { alert('Could not find coin to edit.'); return; }
            coin.name = name;
            coin.date = this._readScopedSelection('period', date);
            coin.origin = this._readScopedSelection('origin', origin);
            coin.ruler = this._readScopedSelection('ruler', ruler);
            coin.material = material;
            coin.weight = weight;
            coin.diameter = diameter;
            coin.description = description;
            coin.references = references;
            coin.external_ids = coin.external_ids || { nomisma: null, wikidata: null, searchUrls: null };
            coin.external_ids.nomisma = nomismaId || coin.external_ids.nomisma || null;
            coin.enrichment_opts = { ruler: useRulerEnrich, origin: useOriginEnrich, date: useDateEnrich };
            coin.obverse = obverse;
            coin.reverse = reverse;

            // Replace images only if new ones were selected
            if (imageFiles && imageFiles.length > 0) {
                coin.images = [];
                for (let file of imageFiles) {
                    const base64 = await this.fileToBase64(file);
                    coin.images.push(base64);
                }
            }

            // Replace model if a new one is provided; cleanup old asset
            let newAssetId = null;
            try {
                if (modelFile) {
                    await assetStorage.init();
                    newAssetId = await assetStorage.add(modelFile, { filename: modelFile.name, type: modelFile.type, size: modelFile.size });
                    const oldAssetId = coin.model3D && coin.model3D.assetId;
                    coin.model3D = { assetId: newAssetId, filename: modelFile.name, type: modelFile.type, size: modelFile.size };
                    if (oldAssetId) { try { await assetStorage.delete(oldAssetId); } catch (_) {} }
                }
                this.saveCoins();
                this.renderCoins();
                // Mark enrichment stale and refresh links in background
                coin.enrichment_status = 'stale';
                try { await this.enrichCoin(coin.id, { force: true, linksOnly: false }); } catch (_) {}
            } catch (err) {
                // If new asset was created but something failed afterwards, best-effort cleanup
                if (newAssetId) { try { await assetStorage.delete(newAssetId); } catch (_) {} }
                if (err && err.message === 'LOCALSTORAGE_QUOTA') {
                    alert('Not enough browser storage to update this coin.');
                } else {
                    console.error('Failed to update coin:', err);
                    alert('Failed to update coin. See console for details.');
                }
                return;
            }

            this.resetFormToAddMode();
            return;
        }

        // Add new coin
        const coin = {
            id: Date.now(),
            name,
            date: this._readScopedSelection('period', date),
            origin: this._readScopedSelection('origin', origin),
            ruler: this._readScopedSelection('ruler', ruler),
            material, weight, diameter, description, references, obverse, reverse,
            images: [],
            model3D: null,
            addedDate: new Date().toISOString(),
            // Enrichment defaults
            external_ids: { nomisma: nomismaId, wikidata: null, searchUrls: null },
            facts_snapshot: null,
            enrichment_status: 'stale',
            enrichment_fetched_at: null,
            enrichment_opts: { ruler: useRulerEnrich, origin: useOriginEnrich, date: useDateEnrich }
        };

        // Process images
        for (let file of imageFiles) {
            const base64 = await this.fileToBase64(file);
            coin.images.push(base64);
        }

        // Process 3D model (store in IndexedDB)
        let modelAssetId = null;
        try {
            if (modelFile) {
                await assetStorage.init();
                modelAssetId = await assetStorage.add(modelFile, { filename: modelFile.name, type: modelFile.type, size: modelFile.size });
                coin.model3D = { assetId: modelAssetId, filename: modelFile.name, type: modelFile.type, size: modelFile.size };
            }
            this.coins.push(coin);
            this.saveCoins();
            this.renderCoins();
            // Fire-and-forget: compute enrichment search links
            try { await this.enrichCoin(coin.id, { force: true, linksOnly: false }); } catch (_) {}
        } catch (err) {
            if (modelAssetId) { try { await assetStorage.delete(modelAssetId); } catch (_) {} }
            if (err && err.message === 'LOCALSTORAGE_QUOTA') {
                alert('Not enough browser storage to save this coin. Please reduce image sizes or remove some items and try again.');
                return;
            }
            console.error('Failed to add coin:', err);
            alert('Failed to add coin. See console for details.');
            return;
        }

        this.resetFormToAddMode();
    }

    // Initialize scoped Nomisma autocomplete for a field
    _initScopedNomisma(field, { inputId, buttonId, suggestId, chipId, types }) {
        const input = document.getElementById(inputId);
        const btn = document.getElementById(buttonId);
        const suggest = document.getElementById(suggestId);
        const chipWrap = document.getElementById(chipId);
        if (!input || !btn || !suggest || !chipWrap) return;
        // Allow removing an existing linked selection (click × on chip)
        chipWrap.addEventListener('click', (e) => {
            const rem = e.target.closest('.chip-remove');
            if (!rem) return;
            delete input.dataset.nomismaUri;
            delete input.dataset.nomismaQid;
            delete input.dataset.nomismaLabel;
            chipWrap.innerHTML = '';
        });
        const search = async () => {
            const term = input.value.trim();
            if (!term) { suggest.style.display='none'; return; }
            suggest.innerHTML = '<div class="suggest-items"><div class="suggest-item"><span class="s-label">Searching Nomisma…</span></div></div>';
            suggest.style.display = 'block';
            let items = [];
            try {
                items = await this.searchNomismaByType(term, types);
            } catch (e) {
                console.error('Scoped Nomisma search failed:', e);
            }
            if (!items || items.length === 0) {
                // For period: prefer curated overlap suggestions; for others: probe slugs
                if (field === 'period') {
                    try { items = await this.periodFallbackSuggestions(term); } catch(_){}
                } else {
                    try {
                        // Skip numeric-only probes to avoid noisy 406s
                        if (!/^\s*\d[\d\s\-–_adcebce]*$/i.test(term)) {
                            const probed = await this.probeNomismaIds(term);
                            items = probed;
                        }
                    } catch (_) {}
                }
            }
            // Authority embedded fallback (only for ruler field) if still empty
            if ((!items || items.length === 0) && field === 'ruler') {
                try {
                    items = await this.authorityFallbackSuggestions(term);
                } catch (_) {}
            }
            if (!items || items.length === 0) {
                suggest.innerHTML = '<div class="suggest-items"><div class="suggest-item"><span class="s-label">No suggestions</span></div></div>';
                return;
            }
            // Mark first item as primary for period suggestions
            const isPeriod = field === 'period';
            suggest.innerHTML = `<div class="suggest-items">${items.map((it,idx)=>`<div class="suggest-item ${isPeriod && idx===0? 'suggest-primary':''}" data-uri="${it.id}" data-qid="${it.qid||''}" data-label-only="${it.labelOnly? '1':'0'}"><span class="s-label">${this.escapeHtml(it.label)}</span>${it.labelOnly? '' : `<span class=\"s-id\">${this.escapeHtml(it.id)}</span>`}</div>`).join('')}</div>`;
            suggest.querySelectorAll('.suggest-item').forEach(el=>{
                el.addEventListener('click', async ()=>{
                    const uri = el.getAttribute('data-uri');
                    const qid = el.getAttribute('data-qid') || null;
                    const label = el.querySelector('.s-label').textContent;
                    const labelOnly = el.getAttribute('data-label-only') === '1';
                    // store in dataset for later save
                    if (!labelOnly) {
                        input.dataset.nomismaUri = uri;
                        input.dataset.nomismaQid = qid;
                    } else {
                        delete input.dataset.nomismaUri;
                        delete input.dataset.nomismaQid;
                    }
                    input.dataset.nomismaLabel = label;
                    // show chip
                    chipWrap.innerHTML = labelOnly ? `<span class=\"chip\">${this.escapeHtml(label)}<button type=\"button\" class=\"chip-remove\" title=\"Remove link\">×</button></span>` : this._renderChip(label, uri);
                    // hide suggest
                    suggest.style.display='none';
                    if (field === 'period') this._updatePeriodContext();
                });
            });
            if (field === 'period') this._updatePeriodContext(items);
        };
        btn.addEventListener('click', search);
        input.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); search(); }});
        // Clear chip if user edits value
        input.addEventListener('input', ()=>{ delete input.dataset.nomismaUri; delete input.dataset.nomismaQid; delete input.dataset.nomismaLabel; chipWrap.innerHTML=''; });
        // Auto-suggest on year range edits (period only)
        if (field === 'period') {
            const sy = document.getElementById('dateStartYear');
            const ey = document.getElementById('dateEndYear');
            const hook = ()=>{ if (sy?.value || ey?.value) { this._updatePeriodContext(); search(); } };
            sy?.addEventListener('input', hook);
            ey?.addEventListener('input', hook);
        }
    }

    _renderChip(label, uri){
        if (!uri) {
            return `<span class="chip">${this.escapeHtml(label)}<button type="button" class="chip-remove" title="Remove link">×</button></span>`;
        }
        return `<span class="chip">${this.escapeHtml(label)}<a class="chip-link" href="${this.escapeHtml(uri)}" target="_blank" aria-label="Open Nomisma">🔗</a><button type="button" class="chip-remove" title="Remove link">×</button></span>`;
    }

    _readScopedSelection(field, fallbackText){
        const el = document.getElementById(field==='origin'?'coinOrigin':field==='ruler'?'coinRuler':'coinDate');
        if (el && el.dataset.nomismaUri) {
            const base = { label: el.dataset.nomismaLabel || el.value, nomisma_uri: el.dataset.nomismaUri, wikidata_qid: el.dataset.nomismaQid || null };
            if (field === 'period') {
                const exact = this._readExactDateRange();
                if (exact) base.exact = exact;
            }
            return base;
        }
        // Label-only period selection (chip without link)
        if (field === 'period' && el && el.dataset.nomismaLabel && !el.dataset.nomismaUri) {
            const obj = { label: el.dataset.nomismaLabel, nomisma_uri: null, wikidata_qid: null };
            const exact = this._readExactDateRange();
            if (exact) obj.exact = exact;
            return obj;
        }
        if (field === 'period') {
            const exact = this._readExactDateRange();
            if (exact || (fallbackText && fallbackText.trim())) {
                return { label: (fallbackText || '').trim(), exact };
            }
        }
        return fallbackText; // free text preserved
    }

    _readExactDateRange(){
        const sy = document.getElementById('dateStartYear');
        const se = document.getElementById('dateStartEra');
        const ey = document.getElementById('dateEndYear');
        const ee = document.getElementById('dateEndEra');
        const startYear = sy && sy.value ? parseInt(sy.value, 10) : null;
        const startEra = se ? (se.value || 'CE') : 'CE';
        const endYear = ey && ey.value ? parseInt(ey.value, 10) : null;
        const endEra = ee ? (ee.value || 'CE') : 'CE';
        if (!startYear && !endYear) return null;
        const norm = (y, era) => ({ year: (y && !isNaN(y)) ? y : null, era: (era === 'BCE' ? 'BCE' : 'CE') });
        return { from: norm(startYear, startEra), to: norm(endYear, endEra) };
    }

    _formatDateRange(exact){
        if (!exact || (!exact.from?.year && !exact.to?.year)) return '';
        const fmt = ({year, era}) => year ? `${year} ${era}` : '';
        const a = fmt(exact.from||{});
        const b = fmt(exact.to||{});
        if (a && b) return `${a} – ${b}`;
        return a || b;
    }

    _updatePeriodContext(suggestions){
        try {
            const host = document.getElementById('periodContext');
            if (!host) return;
            const sy = document.getElementById('dateStartYear');
            const se = document.getElementById('dateStartEra');
            const ey = document.getElementById('dateEndYear');
            const ee = document.getElementById('dateEndEra');
            const sYear = sy?.value ? parseInt(sy.value,10) : null;
            const eYear = ey?.value ? parseInt(ey.value,10) : null;
            const sEra = se?.value || 'CE';
            const eEra = ee?.value || 'CE';
            const buildYear = (y, era)=> y!=null? `${y} ${era}`:'';
            const rangeText = (sYear||eYear)? [buildYear(sYear,sEra), buildYear(eYear,eEra)].filter(Boolean).join(' – ') : '';
            let line = '';
            if (rangeText) line += `<strong>Range:</strong> ${rangeText}. `;
            if (suggestions && suggestions.length) {
                const primary = suggestions[0];
                const others = suggestions.slice(1).map(x=> x.label).join(', ');
                line += `<strong>Suggested period:</strong> ${primary.label}${others? `; broader: ${others}`:''}`;
            }
            host.innerHTML = line || '';
        } catch(_){}
    }

    // Typed Nomisma search with SPARQL filter
    async searchNomismaByType(term, types){
        const safe = term.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        // Map simplified types to ontology/classes
        const typeFilters = [];
        const add = (t, clauses)=>{ if (types.includes(t)) typeFilters.push(...clauses); };
        add('place', ["?id a <http://www.w3.org/2003/01/geo/wgs84_pos#SpatialThing>", "?id a <http://nomisma.org/ontology#Mint>"]);
        add('mint',  ["?id a <http://nomisma.org/ontology#Mint>"]);
        add('person',["?id a <http://xmlns.com/foaf/0.1/Person>"]);
        add('authority',["?id a <http://nomisma.org/ontology#Authority>", "?id a <http://xmlns.com/foaf/0.1/Person>"]);
        add('period',["?id a <http://nomisma.org/ontology#Period>"]);
        // Build FILTER for labels
        const labelClause = `{ ?id <http://www.w3.org/2004/02/skos/core#prefLabel> ?label } UNION { ?id <http://www.w3.org/2004/02/skos/core#altLabel> ?label } FILTER(LANG(?label)='en') FILTER(CONTAINS(LCASE(?label), LCASE('${safe}'))) FILTER(STRSTARTS(STR(?id), 'http://nomisma.org/id/'))`;
        const typeClause = typeFilters.length ? typeFilters.map(c=>`{ ${c} }`).join(' UNION ') : '';
        const where = typeClause ? `{ ${labelClause} . { ${typeClause} } }` : `{ ${labelClause} }`;
        const qTyped = `SELECT DISTINCT ?id ?label WHERE ${where} LIMIT 8`;
        const qBasic = `SELECT DISTINCT ?id ?label WHERE { ${labelClause} } LIMIT 8`;
        const endpoints = [ 'https://nomisma.org/query', 'http://nomisma.org/query', 'https://nomisma.org/sparql', 'http://nomisma.org/sparql' ];
        let data = null;
        // Try typed query first
        for (const base of endpoints) {
            try {
                const res = await this._fetchWithTimeout(`${base}?query=${encodeURIComponent(qTyped)}&format=application%2Fsparql-results%2Bjson`, { timeout: 15000 });
                if (!res.ok) continue;
                data = await res.json();
                if (data && (data.results?.bindings?.length || 0) > 0) break;
            } catch (_) { }
        }
        // Fallback to label-only if typed returns nothing or fails
        if (!data || (data.results?.bindings?.length || 0) === 0) {
            for (const base of endpoints) {
                try {
                    const res = await this._fetchWithTimeout(`${base}?query=${encodeURIComponent(qBasic)}&format=application%2Fsparql-results%2Bjson`, { timeout: 12000 });
                    if (!res.ok) continue;
                    data = await res.json();
                    if (data) break;
                } catch (_) { }
            }
        }
        if (!data) return [];
        const rows = data.results?.bindings || [];
        // Extract QID from exactMatch if available (follow-up fetch on JSON-LD)
        const items = rows.map(r=>({ id:r.id.value, label:r.label.value }));
        // Try to fetch QID for first few items
        const out = [];
        for (const it of items.slice(0,5)) {
            try {
                const ni = await this._enrichNomisma(it.id);
                out.push({ ...it, qid: ni?.wikidata || null });
            } catch (_) { out.push({ ...it }); }
        }
        return out.concat(items.slice(5));
    }

    // Nomisma SPARQL search by label/altLabel
    async searchNomisma(term) {
        const safe = term.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const q = `SELECT ?id ?label WHERE {
  { ?id <http://www.w3.org/2004/02/skos/core#prefLabel> ?label }
  UNION { ?id <http://www.w3.org/2004/02/skos/core#altLabel> ?label }
  FILTER(LANG(?label)='en')
  FILTER(CONTAINS(LCASE(?label), LCASE('${safe}')))
} LIMIT 8`;
        // Try the documented /query endpoint first, then legacy /sparql; prefer HTTPS
        const endpoints = [
            'https://nomisma.org/query',
            'http://nomisma.org/query',
            'https://nomisma.org/sparql',
            'http://nomisma.org/sparql'
        ];
        let data = null;
        for (const base of endpoints) {
            const url = `${base}?query=${encodeURIComponent(q)}&format=application%2Fsparql-results%2Bjson`;
            try {
                const res = await this._fetchWithTimeout(url, { timeout: 15000 });
                if (!res.ok) { console.error('Nomisma SPARQL HTTP error:', res.status, 'at', base); continue; }
                data = await res.json().catch(() => null);
                if (data) break;
            } catch (e) {
                console.error('Nomisma SPARQL request failed at', base, e);
                continue;
            }
        }
        if (!data) return [];
        if (!data) return [];
        const rows = (data && data.results && data.results.bindings) ? data.results.bindings : [];
        return rows.map(r => ({ id: r.id.value, label: r.label.value })).filter(x => /\/id\//.test(x.id));
    }

    // Probe likely Nomisma ID candidates via JSON-LD when SPARQL is blocked
    async probeNomismaIds(term) {
        const slugs = this._candidateNomismaSlugs(term);
        if (!slugs.length) return [];
        const candidates = [];
        slugs.forEach(s => {
            candidates.push(`https://nomisma.org/id/${s}`);
            candidates.push(`http://nomisma.org/id/${s}`);
        });
        const found = [];
        for (const base of candidates) {
            const urls = [`${base}.jsonld`, base];
            for (const u of urls) {
                try {
                    const isJsonld = /\.jsonld$/i.test(u);
                    const res = await this._fetchWithTimeout(u, { timeout: 10000, init: isJsonld ? {} : { headers: { Accept: 'application/ld+json, application/json;q=0.9, */*;q=0.1' } } });
                    const ctype = res.headers.get('content-type') || '';
                    if (!/json/i.test(ctype)) continue;
                    const data = await res.json();
                    const label = this._extractNomismaLabel(data) || base.split('/').pop();
                    found.push({ id: base, label });
                    break; // stop trying alternate of same base
                } catch (_) { /* try next */ }
            }
            if (found.length > 0) break;
        }
        return found;
    }

    // Last-resort: match against embedded authority list and verify via JSON-LD
    async authorityFallbackSuggestions(term, limit = 6) {
        const q = String(term || '').trim().toLowerCase();
        if (!q) return [];
        const matches = [];
        for (const a of AUTHORITY_FALLBACK) {
            const hay = [a.label, ...(a.aliases || [])].join(' ').toLowerCase();
            if (hay.includes(q)) matches.push(a);
            if (matches.length >= 20) break; // cap pre-verification set
        }
        if (matches.length === 0) return [];
        const out = [];
        for (const m of matches) {
            try {
                const info = await this._enrichNomisma(`https://nomisma.org/id/${m.slug}`);
                if (info && info.uri) {
                    out.push({ id: info.uri, label: info.label || m.label, qid: info.wikidata || null });
                }
            } catch (_) { /* skip */ }
            if (out.length >= limit) break;
        }
        return out;
    }

    _toNomismaSlug(text) {
        if (!text) return '';
        return String(text)
            .trim()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove diacritics
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^[-]+|[-]+$/g, '');
    }

    _candidateNomismaSlugs(text) {
        if (!text) return [];
        const base = String(text).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const lower = base.toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ').replace(/\s+/g, ' ').trim();
        const hyphen = lower.replace(/\s+/g, '-');
        const underscore = lower.replace(/\s+/g, '_');
        const compact = lower.replace(/\s+/g, '');
        // roman numerals to lowercase (keep spacing), e.g., gordian iii -> gordian iii
        const romanLower = lower.replace(/\b[ivxlcdm]+\b/gi, (m)=>m.toLowerCase());
        const romanHyphen = romanLower.replace(/\s+/g, '-');
        const romanUnderscore = romanLower.replace(/\s+/g, '_');
        const set = new Set([hyphen, underscore, compact, romanHyphen, romanUnderscore]);
        return Array.from(set).filter(Boolean);
    }

    _extractNomismaLabel(data) {
        try {
            const graph = Array.isArray(data['@graph']) ? data['@graph'] : [data];
            const node = graph[0];
            const v = node['http://www.w3.org/2004/02/skos/core#prefLabel'] || node['label'];
            if (!v) return null;
            if (Array.isArray(v)) {
                const en = v.find(x => x['@language'] === 'en');
                return (en && en['@value']) || (v[0]['@value'] || String(v[0]));
            }
            if (typeof v === 'object' && v['@value']) return v['@value'];
            return String(v);
        } catch (_) { return null; }
    }

    // Quick connectivity diagnostics for Nomisma
    async testNomismaConnectivity() {
        const out = { sparql: { ok: false, error: null }, jsonld: { ok: false, error: null } };
        // SPARQL: use ASK{} to minimize payload
        const ask = 'ASK{}';
        const sparqlEndpoints = ['https://nomisma.org/sparql', 'http://nomisma.org/sparql'];
        for (const base of sparqlEndpoints) {
            try {
                const url = `${base}?query=${encodeURIComponent(ask)}&format=application%2Fsparql-results%2Bjson`;
                const res = await this._fetchWithTimeout(url, { timeout: 10000 });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json().catch(() => null);
                if (data && (typeof data.boolean === 'boolean' || data.results)) { out.sparql.ok = true; break; }
            } catch (e) {
                out.sparql.error = e.message || String(e);
            }
        }
        // JSON-LD: try a known resource
        const jsonCandidates = [
            'https://nomisma.org/id/athens.jsonld',
            'https://nomisma.org/id/athens',
            'http://nomisma.org/id/athens.jsonld',
            'http://nomisma.org/id/athens'
        ];
        for (const u of jsonCandidates) {
            try {
                const isJsonld = /\.jsonld$/i.test(u);
                const res = await this._fetchWithTimeout(u, { timeout: 10000, init: isJsonld ? {} : { headers: { Accept: 'application/ld+json, application/json;q=0.9, */*;q=0.1' } } });
                const ctype = res.headers.get('content-type') || '';
                if (!/json/i.test(ctype)) continue;
                await res.json();
                out.jsonld.ok = true;
                break;
            } catch (e) {
                out.jsonld.error = e.message || String(e);
            }
        }
        return out;
    }

    // Convert file to base64
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // Escape HTML to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Delete a coin
    async deleteCoin(id) {
        if (confirm('Are you sure you want to delete this coin from your collection?')) {
            const coin = this.coins.find(c => c.id === id);
            this.coins = this.coins.filter(coin => coin.id !== id);
            try {
                this.saveCoins();
            } finally {
                if (coin && coin.model3D && coin.model3D.assetId) {
                    try { await assetStorage.init(); await assetStorage.delete(coin.model3D.assetId); } catch (_) {}
                }
            }
            this.renderCoins();
        }
    }
    // Open simplified v1 ticket print preview (Ticket 100×50, Fold 5×5)
    openPrintTickets() {
        if (this.selectedForPrint.size === 0) return alert('Select coins first.');
        const overlay = document.getElementById('ticketsOverlay');
        const pagesContainer = document.getElementById('ticketsPages');
        const countEl = document.getElementById('ticketCount');
        const pageCountEl = document.getElementById('pageCount');

        // Hide any legacy controls if still present (defensive against cached markup)
        try {
            const hideByIds = ['ticketLayout','paperSize','gutterSize','pageMargin','cutGuidesToggle','clampTextToggle','packMode','rulerToggle','showImagesWrap','computedLayout','layoutNotice','presetSelect','rulerOverlay','zoomLevel','fitWidthBtn','viewFullTextBtn','presetDesc','paperBadge'];
            hideByIds.forEach(id => { const el = document.getElementById(id); if (!el) return; (el.closest('label') || el).style.display = 'none'; });
            document.querySelectorAll('.advanced-row,.tickets-computed').forEach(el => el.style.display = 'none');
        } catch {}

        const selectedCoins = this.coins.filter(c => this.selectedForPrint.has(c.id));
        countEl.textContent = String(selectedCoins.length);

        // Physical layout constants (A4 portrait)
        const CARD_W = 100; // mm
        const CARD_H = 50;  // mm
        const MARGIN = 12;  // mm
        const USABLE_W = 210 - 2 * MARGIN; // 186 mm
        const USABLE_H = 297 - 2 * MARGIN; // 273 mm
        const ROW_GAP = 8; // mm vertical gap
        const ROWS_PER_PAGE = 3; // three labels per page
        const LEFT_MM = (USABLE_W - CARD_W) / 2; // center horizontally

        // Helpers
        const formatWeight = (w) => {
            if (w == null || w === '') return '';
            const num = parseFloat(String(w).toString().replace(/[^0-9.\-]/g, ''));
            if (isNaN(num)) return '';
            return num.toFixed(1);
        };
        const formatDia = (d) => {
            if (d == null || d === '') return '';
            const num = parseFloat(String(d).toString().replace(/[^0-9.\-]/g, ''));
            if (isNaN(num)) return '';
            const isInt = Math.abs(num - Math.round(num)) < 1e-6;
            return isInt ? String(Math.round(num)) : num.toFixed(1);
        };
        const escape = (s) => this.escapeHtml(s || '');

        const renderCardHtml = (coin) => {
            const snap = coin.facts_snapshot || null;
            const title = escape((snap && (snap.label || snap.title)) || coin.name);
            const date = escape((snap && snap.date) || ((typeof coin.date==='object') ? [coin.date.label||'', this._formatDateRange(coin.date.exact)].filter(Boolean).join(' ') : (coin.date || '')));
            const origin = escape((snap && snap.mint) || coin.origin);
            const ruler = escape((snap && snap.authority) || coin.ruler);
            const mat = escape((snap && snap.material) || coin.material);
            const w = formatWeight((snap && snap.specs && snap.specs.weight_g) || coin.weight);
            const d = formatDia((snap && snap.specs && snap.specs.diameter_mm) || coin.diameter);
            const specsParts = [];
            if (mat) specsParts.push(mat);
            if (w) specsParts.push(`${w} g`);
            if (d) specsParts.push(`Ø ${d} mm`);
            const specs = specsParts.join(' · ');

            const desc = escape(coin.description || '');
            let refs = escape((snap && snap.refs) || coin.references || '');
            if (!refs && coin.description && /(RIC|RSC|Sear|BMC|Crawford|OCRE)\b/i.test(coin.description)) {
                refs = escape(coin.description.match(/(RIC|RSC|Sear|BMC|Crawford|OCRE)[^.;\n]*/gi)?.join('; ') || '');
            }

            return `
                <div class="v1-ticket-card">
                    <div class="v1-front">
                        <div class="v1-front-top">
                            <div class="v1-title">${title || ''}</div>
                            <div class="v1-subline">${date || ''}</div>
                            <div class="v1-mint">${origin || ''}</div>
                        </div>
                        <div class="v1-front-bottom">
                            <div class="v1-auth">${ruler || ''}</div>
                            <div class="v1-specs ${specs ? '' : 'no-divider is-empty'}">${specs || ''}</div>
                        </div>
                    </div>
                    <div class="v1-back">
                        <div class="v1-back-top">
                            <div class="v1-desc ${desc ? 'fade' : ''}">${desc || ''}</div>
                        </div>
                        <div class="v1-back-bottom">
                            <div class="v1-refs">${refs || ''}</div>
                        </div>
                    </div>
                </div>
            `;
        };

        const totalPages = Math.max(1, Math.ceil(selectedCoins.length / ROWS_PER_PAGE));
        pageCountEl.textContent = String(totalPages);
        pagesContainer.innerHTML = '';

        for (let p = 0; p < totalPages; p++) {
            const page = document.createElement('div');
            page.className = 'tickets-page';
            const inner = document.createElement('div');
            inner.className = 'v1-page-inner';
            page.appendChild(inner);

            const remaining = Math.min(ROWS_PER_PAGE, selectedCoins.length - p * ROWS_PER_PAGE);
            const topStart = 0; // start from top margin
            for (let r = 0; r < remaining; r++) {
                const idx = p * ROWS_PER_PAGE + r;
                const topMm = topStart + r * (CARD_H + ROW_GAP);
                const row = document.createElement('div');
                row.className = 'v1-row';
                row.style.top = `${topMm}mm`;
                const wrap = document.createElement('div');
                wrap.style.position = 'relative';
                wrap.style.width = `${CARD_W}mm`;
                wrap.style.height = `${CARD_H}mm`;
                wrap.innerHTML = renderCardHtml(selectedCoins[idx]);
                row.appendChild(wrap);
                inner.appendChild(row);

                // Back description auto-shrink to 9 lines, then fade
                const descEl = wrap.querySelector('.v1-desc');
                if (descEl) {
                    const cs = getComputedStyle(descEl);
                    let fontPx = parseFloat(cs.fontSize);
                    const lineH = parseFloat(cs.lineHeight) || fontPx * 1.35;
                    const maxLines = 9;
                    const maxH = lineH * maxLines;
                    const minPx = 10; // ~7.5pt
                    let guard = 10;
                    while (descEl.scrollHeight > maxH && fontPx > minPx && guard-- > 0) {
                        fontPx -= 0.5;
                        descEl.style.fontSize = fontPx + 'px';
                        descEl.style.lineHeight = Math.round(fontPx * 1.35) + 'px';
                    }
                    descEl.style.overflow = 'hidden';
                }

                // Cut marks at corners
                const corners = [
                    { pos: 'tl', x: LEFT_MM, y: topMm },
                    { pos: 'tr', x: LEFT_MM + CARD_W, y: topMm },
                    { pos: 'bl', x: LEFT_MM, y: topMm + CARD_H },
                    { pos: 'br', x: LEFT_MM + CARD_W, y: topMm + CARD_H },
                ];
                corners.forEach(c => {
                    const m = document.createElement('span');
                    m.className = 'cut-mark';
                    m.dataset.pos = c.pos;
                    m.style.left = `${c.x}mm`;
                    m.style.top = `${c.y}mm`;
                    inner.appendChild(m);
                });
            }

            const footer = document.createElement('div');
            footer.className = 'tickets-page-footer';
            footer.textContent = `Page ${p + 1} / ${totalPages}`;
            page.appendChild(footer);
            pagesContainer.appendChild(page);
        }

        // Show overlay and wire buttons
        overlay.classList.remove('hidden');
        setTimeout(() => { try { overlay.focus(); } catch (_) {} }, 0);
        const printBtn = document.getElementById('printTicketsBtn');
        const exportBtn = document.getElementById('exportPdfBtn');
        const closeBtn = document.getElementById('closeTicketsBtn');
        const close = () => { overlay.classList.add('hidden'); const clearBtn = document.getElementById('clearSelection'); if (clearBtn) clearBtn.focus(); };
        if (printBtn) printBtn.onclick = () => setTimeout(() => window.print(), 50);
        if (exportBtn) exportBtn.onclick = async () => {
            try { await loadPdfLibs(); } catch (e) { console.error('PDF libs failed to load', e); alert('Could not load PDF exporter. Please use Print → Save as PDF.'); return; }
            await this.exportTicketsPdf('a4');
        };
        if (closeBtn) closeBtn.onclick = close;
    }


    // Export current tickets pages to a PDF
    async exportTicketsPdf(paper) {
        const pagesWrapper = document.getElementById('ticketsPages');
        const pages = Array.from(pagesWrapper.querySelectorAll('.tickets-page'));
        if (pages.length === 0) return;

        // Page size in points (1 pt = 1/72 inch)
        const MM_PER_IN = 25.4;
        const A4 = { wmm: 210, hmm: 297 };
        const LETTER = { wmm: 216, hmm: 279 };
        const sz = paper === 'letter' ? LETTER : A4;
        const winDPI = 96; // typical CSS px per inch
        const wpx = Math.round((sz.wmm / MM_PER_IN) * winDPI);
        const hpx = Math.round((sz.hmm / MM_PER_IN) * winDPI);

        const doc = new jsPDFLib({ orientation: 'portrait', unit: 'mm', format: [sz.wmm, sz.hmm] });

        for (let i = 0; i < pages.length; i++) {
            const pageEl = pages[i];
            // Use html2canvas to rasterize current page at decent scale
            const canvas = await html2canvasLib(pageEl, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true,
                width: pageEl.offsetWidth,
                height: pageEl.offsetHeight
            });
            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            if (i > 0) doc.addPage([sz.wmm, sz.hmm], 'portrait');
            doc.addImage(imgData, 'JPEG', 0, 0, sz.wmm, sz.hmm);
        }

        doc.save('coin-tickets.pdf');
    }

    // Render all coins
    renderCoins() {
        const grid = document.getElementById('coinsGrid');
        const emptyState = document.getElementById('emptyState');

        if (this.coins.length === 0) {
            grid.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
    grid.innerHTML = this.coins.map(coin => this.createCoinCard(coin)).join('');

        // Add event listeners to cards (full-card click and print select only)
        this.coins.forEach(coin => {
            const sel = document.getElementById(`select-${coin.id}`);
            if (sel) {
                sel.addEventListener('change', (e) => {
                    if (e.target.checked) this.selectedForPrint.add(coin.id);
                    else this.selectedForPrint.delete(coin.id);
                    this.updatePrintBar();
                    const cardEl = document.querySelector(`[data-card-id="${coin.id}"]`);
                    if (cardEl) cardEl.classList.toggle('selected', e.target.checked);
                });
            }
            // Click anywhere on the card (except controls) to open details
            const card = document.querySelector(`[data-card-id="${coin.id}"]`);
            if (card) {
                card.addEventListener('click', (e) => {
                    const isControl = e.target.closest('.coin-card-actions') || e.target.closest('.print-select') || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON';
                    if (isControl) return;
                    this.viewCoin(coin.id);
                });
            }
        });
    }

    // Create HTML for a coin card
    createCoinCard(coin) {
        const frontImg = coin.images.length > 0 ? coin.images[0] : PLACEHOLDER_IMAGE;
        const backImg = coin.images.length > 1 ? coin.images[1] : (coin.images.length > 0 ? coin.images[0] : PLACEHOLDER_IMAGE);
        const checked = this.selectedForPrint.has(coin.id) ? 'checked' : '';
        const selectedCls = this.selectedForPrint.has(coin.id) ? ' selected' : '';
    const dateText = (coin.date && typeof coin.date === 'object') ? [coin.date.label || '', this._formatDateRange(coin.date.exact)].filter(Boolean).join(' ') : (coin.date || '');
        const originText = (coin.origin && typeof coin.origin === 'object') ? (coin.origin.label || '') : (coin.origin || '');
        const rulerText = (coin.ruler && typeof coin.ruler === 'object') ? (coin.ruler.label || '') : (coin.ruler || '');
        
        return `
            <div class="coin-card${selectedCls}" data-card-id="${coin.id}">
                <div class="coin-card-images">
                    <div class="coin-3d" aria-hidden="true">
                        <div class="coin-rotator">
                            <img class="coin-face coin-front" src="${frontImg}" alt="${coin.name}">
                            <img class="coin-face coin-back" src="${backImg}" alt="${coin.name} (reverse)">
                        </div>
                    </div>
                    ${coin.images.length > 1 ? `<span class="image-count">📷 ${coin.images.length}</span>` : ''}
                    ${coin.model3D ? '<span class="coin-card-badge">3D</span>' : ''}
                </div>
                <div class="coin-card-content">
                    <h3>${coin.name}</h3>
                    <label class="print-select">
                        <input id="select-${coin.id}" type="checkbox" ${checked} /> select
                    </label>
                    <div class="coin-info">
                        <div class="coin-info-item">
                            <span>Date:</span>
                            <strong>${dateText}</strong>
                        </div>
                        ${originText ? `
                            <div class="coin-info-item">
                                <span>Origin:</span>
                                <strong>${originText}</strong>
                            </div>
                        ` : ''}
                        ${rulerText ? `
                            <div class="coin-info-item">
                                <span>Ruler:</span>
                                <strong>${rulerText}</strong>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    // Update floating print bar visibility and count
    updatePrintBar() {
        const bar = document.getElementById('printBar');
        const count = this.selectedForPrint.size;
        if (!bar) return;
        bar.querySelector('[data-count]').textContent = String(count);
        bar.style.display = count > 0 ? 'flex' : 'none';
    }

    // View coin details in modal
    viewCoin(id) {
        const coin = this.coins.find(c => c.id === id);
        if (!coin) return;

        const modalBody = document.getElementById('modalBody');
        modalBody.innerHTML = `
            <div class="modal-header">
                <h2>${coin.name}</h2>
                <div class="modal-actions">
                    <button id="editCoinBtn" class="btn-secondary">Edit</button>
                </div>
            </div>

            ${coin.images.length > 0 ? `
                <div class="modal-images">
                    ${coin.images.map(img => `<img src="${img}" alt="${coin.name}">`).join('')}
                </div>
            ` : ''}

            ${coin.model3D ? `
                <div class="modal-3d-viewer">
                    <h3>360° 3D View</h3>
                    <div id="viewer3D"></div>
                </div>
            ` : ''}

            <div class="modal-info">
                <div class="info-section">
                    <h3>Basic Information</h3>
                    <div class="info-item">
                        <strong>Date/Period:</strong>
                        <span>${(typeof coin.date==='object') ? [coin.date.label||'', this._formatDateRange(coin.date.exact)].filter(Boolean).join(' ') : coin.date}</span>
                    </div>
                    ${coin.origin ? `
                        <div class="info-item">
                            <strong>Origin/Mint:</strong>
                            <span>${coin.origin.label || coin.origin}</span>
                        </div>
                    ` : ''}
                    ${coin.ruler ? `
                        <div class="info-item">
                            <strong>Ruler/Authority:</strong>
                            <span>${coin.ruler.label || coin.ruler}</span>
                        </div>
                    ` : ''}
                    ${coin.external_ids && coin.external_ids.nomisma ? `
                        <div class="info-item">
                            <strong>Nomisma:</strong>
                            <a href="${this._normalizeNomismaUrl(coin.external_ids.nomisma)}" target="_blank" rel="noopener">${this._normalizeNomismaUrl(coin.external_ids.nomisma)}</a>
                        </div>
                    ` : ''}
                </div>

                <div class="info-section">
                    <h3>Physical Details</h3>
                    ${coin.material ? `
                        <div class="info-item">
                            <strong>Material:</strong>
                            <span>${coin.material}</span>
                        </div>
                    ` : ''}
                    ${coin.weight ? `
                        <div class="info-item">
                            <strong>Weight:</strong>
                            <span>${coin.weight} g</span>
                        </div>
                    ` : ''}
                    ${coin.diameter ? `
                        <div class="info-item">
                            <strong>Diameter:</strong>
                            <span>${coin.diameter} mm</span>
                        </div>
                    ` : ''}
                    ${coin.references ? `
                        <div class="info-item">
                            <strong>References:</strong>
                            <span>${coin.references}</span>
                        </div>
                    ` : ''}
                </div>

                <div class="info-section">
                    <h3>Coin Sides</h3>
                    ${coin.obverse ? `
                        <div class="info-item">
                            <strong>Obverse:</strong>
                            <span>${coin.obverse}</span>
                        </div>
                    ` : ''}
                    ${coin.reverse ? `
                        <div class="info-item">
                            <strong>Reverse:</strong>
                            <span>${coin.reverse}</span>
                        </div>
                    ` : ''}
                </div>
            </div>

            ${coin.description ? `
                <div class="modal-description">
                    <h3>Description & Notes</h3>
                    <p>${coin.description}</p>
                </div>
            ` : ''}

            <div class="info-section">
                <h3>Learn more</h3>
                <button id="toggleLearnMore" class="btn-secondary">Read more</button>
                <div id="enrichLearnMore" class="learn-more" style="display:none"></div>
            </div>
        `;

        document.getElementById('coinModal').classList.remove('hidden');

        // Wire modal action buttons
        const editBtn = document.getElementById('editCoinBtn');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                this.openEditCoin(coin.id);
                this.closeModal();
            });
        }
        // Delete button removed from modal (bulk delete via selection bar)
        // Learn more: collapsed by default; fetch lazily when expanded
        const toggleBtn = document.getElementById('toggleLearnMore');
        const host = document.getElementById('enrichLearnMore');
        if (toggleBtn && host) {
            toggleBtn.addEventListener('click', async () => {
                const isHidden = host.style.display === 'none' || getComputedStyle(host).display === 'none';
                if (isHidden) {
                    host.style.display = 'block';
                    toggleBtn.textContent = 'Hide';
                    if (!coin.facts_snapshot) {
                        host.innerHTML = '<em>Fetching information…</em>';
                        try {
                            await this.enrichCoin(coin.id, { force: false });
                        } catch (_) {}
                        const updated = this.coins.find(x => x.id === coin.id) || coin;
                        this.renderLearnMore(updated);
                    } else {
                        this.renderLearnMore(coin);
                    }
                } else {
                    host.style.display = 'none';
                    toggleBtn.textContent = 'Read more';
                }
            });
        }

        // Wire image lightbox on click
        const modalImgs = document.querySelectorAll('.modal-images img');
        if (modalImgs && modalImgs.length > 0) {
            const urls = coin.images.slice();
            modalImgs.forEach((imgEl, idx) => {
                imgEl.style.cursor = 'zoom-in';
                imgEl.addEventListener('click', () => {
                    this.openImageLightbox(urls, idx);
                });
            });
        }

        // Initialize 3D viewer if model exists (delayed to ensure DOM is ready)
        if (coin.model3D) {
            setTimeout(() => this.init3DViewer(coin.model3D), VIEWER_INIT_DELAY);
        }
    }

    // Simple lightbox with zoom and navigation
    openImageLightbox(images, startIndex = 0) {
        if (!images || images.length === 0) return;
        let idx = Math.max(0, Math.min(startIndex, images.length - 1));
        let scale = 1;
        let tx = 0, ty = 0;
        let isPanning = false, startX = 0, startY = 0;

        const overlay = document.createElement('div');
        overlay.className = 'image-lightbox';
        overlay.innerHTML = `
            <div class="ilb-toolbar">
                <button class="ilb-close" title="Close">✕</button>
                <button class="ilb-zoom-out" title="Zoom out">−</button>
                <button class="ilb-zoom-in" title="Zoom in">＋</button>
            </div>
            <div class="ilb-stage"><img alt="full" /></div>
            ${images.length > 1 ? '<button class="ilb-prev" aria-label="Previous">‹</button>' : ''}
            ${images.length > 1 ? '<button class="ilb-next" aria-label="Next">›</button>' : ''}
        `;
        document.body.appendChild(overlay);

        const imgEl = overlay.querySelector('img');
        const btnClose = overlay.querySelector('.ilb-close');
        const btnIn = overlay.querySelector('.ilb-zoom-in');
        const btnOut = overlay.querySelector('.ilb-zoom-out');
        const btnPrev = overlay.querySelector('.ilb-prev');
        const btnNext = overlay.querySelector('.ilb-next');

        const updateImg = () => {
            imgEl.src = images[idx];
            scale = 1; tx = 0; ty = 0; applyTransform();
        };
        const applyTransform = () => {
            imgEl.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
            overlay.querySelector('.ilb-stage').style.cursor = scale > 1 ? 'grab' : 'default';
        };
        const zoomBy = (delta) => {
            const newScale = Math.min(5, Math.max(1, scale + delta));
            if (newScale !== scale) { scale = newScale; if (scale === 1) { tx = 0; ty = 0; } applyTransform(); }
        };
        const prev = () => { if (images.length > 1) { idx = (idx - 1 + images.length) % images.length; updateImg(); } };
        const next = () => { if (images.length > 1) { idx = (idx + 1) % images.length; updateImg(); } };
        const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };

        // Events
        btnClose && btnClose.addEventListener('click', close);
        btnIn && btnIn.addEventListener('click', () => zoomBy(0.25));
        btnOut && btnOut.addEventListener('click', () => zoomBy(-0.25));
        btnPrev && btnPrev.addEventListener('click', prev);
        btnNext && btnNext.addEventListener('click', next);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        const stage = overlay.querySelector('.ilb-stage');
        stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY > 0 ? -0.2 : 0.2); }, { passive: false });
        stage.addEventListener('mousedown', (e) => { if (scale <= 1) return; isPanning = true; startX = e.clientX - tx; startY = e.clientY - ty; stage.style.cursor = 'grabbing'; });
        window.addEventListener('mousemove', (e) => { if (!isPanning) return; tx = e.clientX - startX; ty = e.clientY - startY; applyTransform(); });
        window.addEventListener('mouseup', () => { if (!isPanning) return; isPanning = false; stage.style.cursor = 'grab'; });
    stage.addEventListener('dblclick', () => { if (scale === 1) { scale = 2; } else { scale = 1; tx = 0; ty = 0; } applyTransform(); });

        const onKey = (e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowLeft') prev();
            else if (e.key === 'ArrowRight') next();
            else if (e.key === '+') zoomBy(0.25);
            else if (e.key === '-') zoomBy(-0.25);
        };
        document.addEventListener('keydown', onKey);

        updateImg();
    }

    // (UI simplified) No link-section rendering; we only show Learn more cards.

    // Render "Learn more" cards for authority/mint/period summaries
    renderLearnMore(coin) {
        const host = document.getElementById('enrichLearnMore');
        if (!host) return;
        const snap = coin.facts_snapshot || {};
        const cards = [];
        const mkCard = (title, info, fallback) => {
            if (!info) return '';
            const img = info.wikipedia?.thumbnail?.source || '';
            const url = info.wikipedia?.content_urls?.desktop?.page || info.wikipedia?.url || info.wikipedia?.page || (fallback && fallback.uri) || '';
            const summary = info.wikipedia?.extract || info.description || (fallback && fallback.definition) || '';
            if (!summary && !img) return '';
            return `
                <div class="learn-card">
                    <div class="learn-card-header">
                        <h4>${this.escapeHtml(title)}</h4>
                        ${url ? `<a href="${url}" target="_blank" class="learn-link">Read more</a>` : ''}
                    </div>
                    <div class="learn-card-body">
                        ${img ? `<img class="learn-thumb" src="${img}" alt="${this.escapeHtml(title)}"/>` : ''}
                        <p>${this.escapeHtml(summary)}</p>
                        ${fallback && fallback.coordinates ? `<div class="coords">Lat ${fallback.coordinates.lat.toFixed(4)}, Lon ${fallback.coordinates.lon.toFixed(4)}</div>` : ''}
                    </div>
                </div>
            `;
        };
        if (snap.authority_info) cards.push(mkCard(snap.authority_info.label || (coin.ruler?.label || coin.ruler) || 'Authority', snap.authority_info));
        if (snap.mint_info) cards.push(mkCard(snap.mint_info.label || (coin.origin?.label || coin.origin) || 'Mint', snap.mint_info));
        if (snap.period_info) cards.push(mkCard(snap.period_info.label || (typeof coin.date==='object'? coin.date.label : coin.date) || 'Period', snap.period_info));
        // Nomisma summaries for selected concepts
        const nmCards = [snap.nomisma_origin, snap.nomisma_ruler, snap.nomisma_period, snap.nomisma].filter(Boolean);
        nmCards.forEach(nm => {
            const label = nm.label || 'Nomisma Entry';
            const summary = nm.definition || '';
            cards.push(`
                <div class="learn-card">
                    <div class="learn-card-header">
                        <h4>${this.escapeHtml(label)}</h4>
                        <a href="${this.escapeHtml(nm.uri)}" target="_blank" class="learn-link">Open</a>
                    </div>
                    <div class="learn-card-body">
                        ${summary ? `<p>${this.escapeHtml(summary)}</p>` : ''}
                        ${nm.coordinates ? `<div class="coords">Lat ${nm.coordinates.lat.toFixed(4)}, Lon ${nm.coordinates.lon.toFixed(4)}</div>` : ''}
                    </div>
                </div>
            `);
        });
        if (cards.length === 0) {
            host.innerHTML = '<em>No enrichment yet. Try Refresh Snapshot.</em>';
        } else {
            host.innerHTML = cards.join('');
        }
    }

    // Initialize 3D viewer with Three.js
    init3DViewer(model3D) {
        const container = document.getElementById('viewer3D');
        if (!container || this.currentViewer) return;

        // If Three.js is not available, show a fallback message
        if (!threeJsAvailable) {
            container.innerHTML = `
                <div class="viewer-fallback">
                    <p class="viewer-fallback-title">3D Model: ${this.escapeHtml(model3D.filename)}</p>
                    <p class="viewer-fallback-message">3D viewer requires online connection for Three.js library</p>
                    <button class="btn-primary viewer-fallback-btn" data-download="true">
                        Download 3D Model
                    </button>
                </div>
            `;
            
            // Add event listener for download button
            const downloadBtn = container.querySelector('[data-download="true"]');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', async () => {
                    try {
                        let href = null;
                        if (model3D.assetId) {
                            await assetStorage.init();
                            const rec = await assetStorage.get(model3D.assetId);
                            if (!rec) throw new Error('Model not found');
                            href = URL.createObjectURL(rec.blob);
                        } else if (model3D.data) {
                            href = model3D.data;
                        }
                        if (href) {
                            const link = document.createElement('a');
                            link.href = href;
                            link.download = model3D.filename;
                            link.click();
                            if (model3D.assetId) setTimeout(() => URL.revokeObjectURL(href), 2000);
                        }
                    } catch (e) {
                        console.error('Download failed:', e);
                        alert('Could not download the 3D model.');
                    }
                });
            }
            return;
        }

    let width = container.clientWidth || container.offsetWidth || 800;
    let height = container.clientHeight || container.offsetHeight || 500;
    if (!width || !height) { width = 800; height = 500; }

        // Create scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf5f5f5);

        // Create camera
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        camera.position.set(0, 0, 5);

        // Create renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(renderer.domElement);

        // Add lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 5, 5);
        scene.add(directionalLight);

        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
        directionalLight2.position.set(-5, -5, -5);
        scene.add(directionalLight2);

        // Add orbit controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 2.0;

        // Store viewer reference before starting animation loop
        this.currentViewer = { renderer, scene, camera, controls };

        // Load model
        this.load3DModel(scene, model3D).catch(err => {
            console.error('3D load error:', err);
            container.innerHTML = `
                <div class="viewer-fallback">
                    <p class="viewer-fallback-title">Failed to load 3D model</p>
                    <p class="viewer-fallback-message">${this.escapeHtml(model3D.filename)}</p>
                    <button class="btn-primary viewer-fallback-btn" data-download="true">Download 3D Model</button>
                </div>
            `;
            const btn = container.querySelector('[data-download="true"]');
            if (btn) {
                btn.addEventListener('click', async () => {
                    try {
                        let href = null;
                        if (model3D.assetId) {
                            await assetStorage.init();
                            const rec = await assetStorage.get(model3D.assetId);
                            if (!rec) throw new Error('Model not found');
                            href = URL.createObjectURL(rec.blob);
                        } else if (model3D.data) {
                            href = model3D.data;
                        }
                        if (href) {
                            const link = document.createElement('a');
                            link.href = href;
                            link.download = model3D.filename;
                            link.click();
                            if (model3D.assetId) setTimeout(() => URL.revokeObjectURL(href), 2000);
                        }
                    } catch (e) {
                        console.error('Download failed:', e);
                        alert('Could not download the 3D model.');
                    }
                });
            }
        });

        // Animation loop (keep rendering while container exists)
        const animate = () => {
            if (!document.body.contains(container)) return; // stop when modal closed/DOM removed
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        // Handle window resize
        const handleResize = () => {
            if (!container) return;
            const width = container.clientWidth;
            const height = container.clientHeight;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        };
        window.addEventListener('resize', handleResize);
    }

    // Load 3D model
    async load3DModel(scene, model3D) {
        if (!threeJsAvailable) return;
        
        const extension = model3D.filename.split('.').pop().toLowerCase();
        
        // Resolve to object URL from IndexedDB or legacy base64
        let url = null;
        let createdUrl = false;
        if (model3D.assetId) {
            await assetStorage.init();
            const rec = await assetStorage.get(model3D.assetId);
            if (!rec || !rec.blob) throw new Error('3D model asset not found');
            url = URL.createObjectURL(rec.blob);
            createdUrl = true;
        } else if (model3D.data) {
            const base64Data = model3D.data.split(',')[1];
            const byteCharacters = atob(base64Data);
            const byteArray = Uint8Array.from(byteCharacters, char => char.charCodeAt(0));
            const blob = new Blob([byteArray], { type: model3D.type || 'application/octet-stream' });
            url = URL.createObjectURL(blob);
            createdUrl = true;
        } else {
            throw new Error('Unsupported 3D model format');
        }

        if (extension === 'glb' || extension === 'gltf') {
            const loader = new GLTFLoader();
            try {
                if (DRACOLoader) {
                    const dracoLoader = new DRACOLoader();
                    // Use Google-hosted decoders for reliability
                    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
                    loader.setDRACOLoader(dracoLoader);
                }
            } catch (_) {}
            loader.load(url, (gltf) => {
                const model = gltf.scene;
                
                // Center and scale model
                const box = new THREE.Box3().setFromObject(model);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 2 / maxDim;
                
                model.scale.setScalar(scale);
                model.position.sub(center.multiplyScalar(scale));
                
                scene.add(model);
                if (createdUrl) URL.revokeObjectURL(url);
            }, undefined, (error) => {
                console.error('Error loading 3D model:', error);
                throw error;
            });
        } else if (extension === 'obj') {
            const loader = new OBJLoader();
            loader.load(url, (object) => {
                // Center and scale model
                const box = new THREE.Box3().setFromObject(object);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 2 / maxDim;
                
                object.scale.setScalar(scale);
                object.position.sub(center.multiplyScalar(scale));
                
                // Add material if needed
                object.traverse((child) => {
                    if (child instanceof THREE.Mesh && !child.material) {
                        child.material = new THREE.MeshPhongMaterial({ color: 0xcccccc });
                    }
                });
                
                scene.add(object);
                if (createdUrl) URL.revokeObjectURL(url);
            }, undefined, (error) => {
                console.error('Error loading OBJ model:', error);
                throw error;
            });
        }
    }

    // Close modal
    closeModal() {
        document.getElementById('coinModal').classList.add('hidden');
        
        // Clean up 3D viewer
        if (this.currentViewer) {
            const container = document.getElementById('viewer3D');
            if (container) {
                container.innerHTML = '';
            }
            this.currentViewer = null;
        }
    }

    // Filter coins by search term
    filterCoins(searchTerm) {
        const filtered = this.coins.filter(coin => {
            const term = String(searchTerm || '').toLowerCase();
            const dateText = (coin.date && typeof coin.date === 'object') ? (coin.date.label || '') : (coin.date || '');
            const originText = (coin.origin && typeof coin.origin === 'object') ? (coin.origin.label || '') : (coin.origin || '');
            const rulerText = (coin.ruler && typeof coin.ruler === 'object') ? (coin.ruler.label || '') : (coin.ruler || '');
            return (coin.name || '').toLowerCase().includes(term) ||
                   String(dateText).toLowerCase().includes(term) ||
                   String(originText).toLowerCase().includes(term) ||
                   String(rulerText).toLowerCase().includes(term) ||
                   (coin.description && coin.description.toLowerCase().includes(term));
        });

        const grid = document.getElementById('coinsGrid');
        const emptyState = document.getElementById('emptyState');

        if (filtered.length === 0) {
            grid.innerHTML = '';
            emptyState.innerHTML = '<p>No coins found matching your search.</p>';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        grid.innerHTML = filtered.map(coin => this.createCoinCard(coin)).join('');

        // Re-add event listeners (selection + full-card click)
        filtered.forEach(coin => {
            const sel = document.getElementById(`select-${coin.id}`);
            if (sel) {
                sel.addEventListener('change', (e) => {
                    if (e.target.checked) this.selectedForPrint.add(coin.id);
                    else this.selectedForPrint.delete(coin.id);
                    this.updatePrintBar();
                    const cardEl = document.querySelector(`[data-card-id="${coin.id}"]`);
                    if (cardEl) cardEl.classList.toggle('selected', e.target.checked);
                });
            }
            const card = document.querySelector(`[data-card-id="${coin.id}"]`);
            if (card) {
                card.addEventListener('click', (e) => {
                    const isControl = e.target.closest('.coin-card-actions') || e.target.closest('.print-select') || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON';
                    if (isControl) return;
                    this.viewCoin(coin.id);
                });
            }
        });
    }

    // Sort coins
    sortCoins(sortBy) {
        switch (sortBy) {
            case 'newest':
                this.coins.sort((a, b) => new Date(b.addedDate) - new Date(a.addedDate));
                break;
            case 'oldest':
                this.coins.sort((a, b) => new Date(a.addedDate) - new Date(b.addedDate));
                break;
            case 'name':
                this.coins.sort((a, b) => a.name.localeCompare(b.name));
                break;
        }
        this.renderCoins();
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    await assetStorage.init().catch(() => {});
    await loadThreeJS();
    new CoinCollection();
});
