// Ancient Coin Collection App
// Import Three.js dynamically if available
let THREE, GLTFLoader, OBJLoader, OrbitControls, DRACOLoader;
let jsPDFLib = null, html2canvasLib = null;
let threeJsAvailable = false;
async function loadPdfLibs() {
    if (jsPDFLib && html2canvasLib) return;
    const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    if (!window.html2canvas) await loadScript('https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js');
    if (!window.jspdf && !window.jsPDF) await loadScript('https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js');
    html2canvasLib = window.html2canvas;
    jsPDFLib = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || null);
}

// Curated authority fallback list (label -> Nomisma slug)
const AUTHORITY_FALLBACK = [
    { label: 'Marcus Aurelius', slug: 'marcus_aurelius' },
    { label: 'Lucius Verus', slug: 'lucius_verus' },
    { label: 'Commodus', slug: 'commodus' },
    { label: 'Pertinax', slug: 'pertinax' },
    { label: 'Didius Julianus', slug: 'didius_julianus' },
    { label: 'Septimius Severus', slug: 'septimius_severus' },
    { label: 'Caracalla', slug: 'caracalla' },
    { label: 'Geta', slug: 'geta' },
];

// Lightweight IndexedDB asset storage for large files (e.g., 3D models)
class AssetStorage {
    constructor() {
        this.db = null;
        this.DB_NAME = 'CoinflipDB';
        this.STORE = 'assets';
    }
    init() {
        if (this.db) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORE)) {
                    db.createObjectStore(this.STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            req.onerror = () => reject(req.error);
        });
    }
    _txn(mode='readonly') { return this.db.transaction([this.STORE], mode).objectStore(this.STORE); }
    async add(file, meta={}) {
        await this.init();
        const id = 'asset-' + Date.now() + '-' + Math.floor(Math.random()*100000);
        const record = { id, blob: file, filename: meta.filename||file.name, type: meta.type||file.type, size: meta.size||file.size };
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
    async estimateUsage(){
        await this.init();
        return await new Promise((resolve, reject)=>{
            let total = 0;
            const store = this._txn('readonly');
            const req = store.openCursor();
            req.onsuccess = (e)=>{
                const cursor = e.target.result;
                if (cursor){
                    const rec = cursor.value;
                    const sz = (rec && (rec.size || (rec.blob && rec.blob.size))) || 0;
                    total += sz;
                    cursor.continue();
                } else {
                    resolve(total);
                }
            };
            req.onerror = ()=> reject(req.error);
        });
    }
    async clearAll(){
        await this.init();
        return await new Promise((resolve, reject)=>{
            const req = this._txn('readwrite').clear();
            req.onsuccess = ()=> resolve();
            req.onerror = ()=> reject(req.error);
        });
    }
}

// Main application class
class CoinCollection {
    constructor(){
        this.coins = [];
        this.selectedForPrint = new Set();
        this.cache = new Map(); // Initialize cache for storing data
        this._searchCache = {};
        this.currentViewer = null;
        this.PLACEHOLDER_IMAGE = this.PLACEHOLDER_IMAGE || '';
        this._activeTrace = null;
        // WDQS rate limiting state
        this._wdqsQueue = [];
        this._wdqsActive = 0;
        this._wdqsLastStart = 0;
        this._wdqsMinGapMs = 1500; // safer than 1 req/sec to avoid 429s
        this._wdqsMaxConcurrency = 1; // serialize WDQS calls
        this._draftStructuredRefs = [];
        this._editingRefIndex = -1;
        this._draftImages = [];
        this._debug = true;
        this._searchTerm = '';
        this._currentSort = 'struck';
        this._initPersistence();
        this.sortCoins(this._currentSort, { skipRender: true });
        this.renderCoins();
        this.initEventListeners();
    }

    _traceCreate(context){
        return { context, startedAt: (window.performance?.now?.()||Date.now()), steps: [], finishedAt: null };
    }
    _tracePush(trace, step){
        try { if (trace && step) trace.steps.push({ when: Date.now(), ...step }); } catch(_){}
    }
    _traceFinish(trace){
        try { if (trace) trace.finishedAt = (window.performance?.now?.()||Date.now()); } catch(_){}
        return trace;
    }
    _traceAddProvenance(trace, { section, qid, label, hops = [], wd = null, wiki = null }){
        try {
            if (!trace) return;
            if (!trace.provenance) trace.provenance = [];
            trace.provenance.push({ section, qid, label, hops, wd, wiki });
        } catch(_){}
    }
    _renderTrace(trace, host){
        if (!trace || !host) return;
        const total = trace.finishedAt && trace.startedAt ? Math.round(trace.finishedAt - trace.startedAt) : null;
        const lines = [];
        trace.steps.forEach(s=>{ const k=s.type||'other'; agg[k]=(agg[k]||0)+(s.durationMs||0); });
            this.cache = new Map(); // Initialize cache for storing data
        Object.keys(agg).sort((a,b)=>agg[b]-agg[a]).forEach(k=>{
            lines.push(`<div class="t-step"><div>Sum ${this.escapeHtml(k)}</div><div>${Math.round(agg[k])} ms</div></div>`);
        });
        trace.steps.forEach(s=>{
            const left = [s.type?`[${this.escapeHtml(s.type)}]`:'' , this.escapeHtml(s.label||'')].filter(Boolean).join(' ');
            const right = `${s.durationMs!=null? (Math.round(s.durationMs)+" ms") : ''}`;
            const meta = [];
            if (s.resultCount!=null) meta.push(`${s.resultCount} rows`);
            if (s.cacheHit) meta.push('cache');
            if (s.error) meta.push(`error: ${this.escapeHtml(String(s.error))}`);
            if (s.note) meta.push(this.escapeHtml(s.note));
            lines.push(`<div class="t-step"><div>${left}${meta.length?`<div class="t-meta">${meta.join(' · ')}</div>`:''}</div><div>${right}</div></div>`);
        });
        // Per-item provenance block
        const prov = Array.isArray(trace.provenance) ? trace.provenance.slice() : [];
        if (prov.length){
            const bySection = new Map();
            for (const p of prov){ const k = p.section || 'Other'; if (!bySection.has(k)) bySection.set(k, []); bySection.get(k).push(p); }
            const provBlocks = [];
            for (const [sec, arr] of bySection.entries()){
                const itemsHtml = arr.map(p=>{
                    const hops = (p.hops||[]).map(h=> this.escapeHtml(h)).join(' → ');
                    const links = [p.wd?`<a href="${this.escapeHtml(p.wd)}" target="_blank">Wikidata</a>`:'', p.wiki?`<a href="${this.escapeHtml(p.wiki)}" target="_blank">Wikipedia</a>`:''].filter(Boolean).join(' · ');
                    const id = this.escapeHtml(p.qid || '');
                    const label = this.escapeHtml(p.label || '');
                    return `<div class="t-step"><div><span class="t-em">${label || id}</span>${id?` <span class="t-meta">${id}</span>`:''}<div class="t-meta">${hops}</div>${links?`<div class="t-meta">${links}</div>`:''}</div><div></div></div>`;
                }).join('');
                provBlocks.push(`<div class="t-step"><div><span class="t-em">${this.escapeHtml(sec)}</span></div><div></div></div>` + itemsHtml);
            }
            host.innerHTML = `<div class="trace-list">${lines.join('')}<div class="t-step"><div><span class="t-em">Per-Item Paths</span></div><div></div></div>${provBlocks.join('')}</div>`;
            return;
        }
        host.innerHTML = `<div class="trace-list">${lines.join('')}</div>`;
    }

    // Simple in-memory cache with optional TTL
    getCache(key) {
        if (!this.cache) this.cache = new Map();
        const entry = this.cache.get(key);
        if (entry == null) return null;
        if (typeof entry === 'object' && entry && Object.prototype.hasOwnProperty.call(entry, '__expiresAt')) {
            if (entry.__expiresAt != null && Date.now() > entry.__expiresAt) {
                this.cache.delete(key);
                return null;
            }
            return entry.value;
        }
        return entry;
    }

    setCache(key, value, { ttlMs } = {}) {
        if (!this.cache) this.cache = new Map();
        if (Number.isFinite(ttlMs) && ttlMs > 0) {
            this.cache.set(key, { value, __expiresAt: Date.now() + ttlMs });
        } else {
            this.cache.set(key, value);
        }
    }

    _coinMatchesSearch(coin) {
        const term = String(this._searchTerm || '').trim().toLowerCase();
        if (!term) return true;
        const dateText = (() => {
            const range = this._formatDateRange(coin.struck_date?.exact);
            const note = coin.struck_date?.note || '';
            const periodLabel = (coin.period && typeof coin.period === 'object') ? (coin.period.label || '') : (coin.period || '');
            return [periodLabel, range, note].filter(Boolean).join(' ');
        })();
        const originText = (coin.origin && typeof coin.origin === 'object') ? (coin.origin.label || '') : (coin.origin || '');
        const rulerText = (coin.ruler && typeof coin.ruler === 'object') ? (coin.ruler.label || '') : (coin.ruler || '');
        const corpus = [coin.name || '', dateText || '', originText || '', rulerText || '', coin.description || '']
            .map(part => part.toLowerCase());
        return corpus.some(part => part.includes(term));
    }

    async _fetchPeriodEvents(qid, { rulers = null, periodRange = null, originQid = null, struckExact = null } = {}, trace = null){
        if (!qid || !/^Q\d+$/i.test(qid)) return [];
        const cacheKey = `wikidata:events:${qid.toUpperCase()}`;
        const hit = this.getCache(cacheKey); if (hit) return hit;

        if (!periodRange) { try { periodRange = await this._fetchPeriodRange(qid); } catch(_){} }
        if (!rulers) { try { rulers = await this._fetchRulersForPeriod(qid); } catch(_){ rulers = []; } }

        let items = [];

        try {
            const rulerQids = (rulers||[]).map(r=>r.qid).filter(Boolean).slice(0,50);
            if (rulerQids.length){
                const values = rulerQids.map(q => `wd:${q}`).join(' ');
                const typeValues = ['wd:Q178561','wd:Q198','wd:Q40231','wd:Q2472587'].join(' ');
                const query = `
SELECT ?event ?eventLabel ?pt ?img WHERE {
  VALUES ?ruler { ${values} }
  ?event wdt:P31/wdt:P279* ?etype .
  VALUES ?etype { ${typeValues} }
  ?event wdt:P710 ?ruler .
  OPTIONAL { ?event wdt:P585 ?pt. }
  OPTIONAL { ?event p:P580/ps:P580 ?pt. }
  OPTIONAL { ?event wdt:P18 ?img. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language 'en'. }
}
ORDER BY ?pt
LIMIT 300`;
                const data = await this._wdqsQuery('events:ruler', query, { timeout: 60000, maxRetries: 2, trace });
                const rows = data?.results?.bindings || [];
                items.push(...rows.map(row => ({
                    qid: (row.event?.value || '').split('/').pop(),
                    title: row.eventLabel?.value || '',
                    year: this._yearFromWikidataTime(row.pt?.value || null),
                    image: row.img?.value || null,
                    source: 'P710_RULER'
                })));
            }
        } catch(_){ }

        try {
            const query2 = `
SELECT ?event ?eventLabel ?pt ?img WHERE {
    ?event (wdt:P361)+ wd:${qid.toUpperCase()} .
  OPTIONAL { ?event wdt:P585 ?pt. }
  OPTIONAL { ?event p:P580/ps:P580 ?pt. }
  OPTIONAL { ?event wdt:P18 ?img. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language 'en'. }
}
ORDER BY ?pt
LIMIT 200`;
            const data2 = await this._wdqsQuery('events:period-part', query2, { timeout: 60000, maxRetries: 2, trace });
            const b2 = data2?.results?.bindings || [];
            items.push(...b2.map(row => ({
                qid: (row.event?.value || '').split('/').pop(),
                title: row.eventLabel?.value || '',
                year: this._yearFromWikidataTime(row.pt?.value || null),
                image: row.img?.value || null,
                source: 'P361_PERIOD'
            })));
        } catch(_){ }

        try {
            const queryWars = `
SELECT ?event ?eventLabel ?pt ?img WHERE {
    ?event wdt:P31/wdt:P279* wd:Q198 .
    ?event wdt:P710 ?actor .
    ?actor (wdt:P361|^wdt:P361)* wd:${qid.toUpperCase()} .
  OPTIONAL { ?event wdt:P585 ?pt. }
  OPTIONAL { ?event p:P580/ps:P580 ?pt. }
  OPTIONAL { ?event wdt:P18 ?img. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language 'en'. }
}
ORDER BY ?pt
LIMIT 200`;
            const dataW = await this._wdqsQuery('events:wars', queryWars, { timeout: 60000, maxRetries: 2, trace });
            const rowsW = dataW?.results?.bindings || [];
            const wars = rowsW.map(row => ({
                qid: (row.event?.value || '').split('/').pop(),
                title: row.eventLabel?.value || '',
                year: this._yearFromWikidataTime(row.pt?.value || null),
                image: row.img?.value || null,
                source: 'WAR_P710_PERIOD'
            }));
            items.push(...wars);
            const warQids = wars.map(w=>w.qid).filter(Boolean).slice(0,50);
            if (warQids.length){
                const valuesWars = warQids.map(q=>`wd:${q}`).join(' ');
                const queryBattles = `
SELECT ?event ?eventLabel ?pt ?img WHERE {
  VALUES ?war { ${valuesWars} }
  ?war wdt:P527 ?event .
  ?event wdt:P31/wdt:P279* wd:Q178561 .
  OPTIONAL { ?event wdt:P585 ?pt. }
  OPTIONAL { ?event p:P580/ps:P580 ?pt. }
  OPTIONAL { ?event wdt:P18 ?img. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language 'en'. }
}
ORDER BY ?pt
LIMIT 300`;
                const dataB = await this._wdqsQuery('events:battles', queryBattles, { timeout: 60000, maxRetries: 2, trace });
                const rowsB = dataB?.results?.bindings || [];
                items.push(...rowsB.map(row => ({
                    qid: (row.event?.value || '').split('/').pop(),
                    title: row.eventLabel?.value || '',
                    year: this._yearFromWikidataTime(row.pt?.value || null),
                    image: row.img?.value || null,
                    source: 'BATTLE_OF_WAR'
                })));
            }
        } catch(_){ }

        if (originQid) {
            try {
                const typeValues = ['wd:Q178561','wd:Q198','wd:Q40231','wd:Q2472587'].join(' ');
                const queryLoc = `
SELECT ?event ?eventLabel ?pt ?img WHERE {
  ?event wdt:P31/wdt:P279* ?etype .
  VALUES ?etype { ${typeValues} }
  ?event wdt:P276/(wdt:P131)* wd:${originQid.toUpperCase()} .
  OPTIONAL { ?event wdt:P585 ?pt. }
  OPTIONAL { ?event p:P580/ps:P580 ?pt. }
  OPTIONAL { ?event wdt:P18 ?img. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language 'en'. }
}
ORDER BY ?pt
LIMIT 200`;
                const dataL = await this._wdqsQuery('events:location', queryLoc, { timeout: 60000, maxRetries: 2, trace });
                const rowsL = dataL?.results?.bindings || [];
                items.push(...rowsL.map(row => ({
                    qid: (row.event?.value || '').split('/').pop(),
                    title: row.eventLabel?.value || '',
                    year: this._yearFromWikidataTime(row.pt?.value || null),
                    image: row.img?.value || null,
                    source: 'LOCATION'
                })));
            } catch(_){ }
        }

        const byQ = new Map();
        for (const it of items){ if (!it.qid) continue; if (!byQ.has(it.qid)) byQ.set(it.qid, it); }
        let merged = Array.from(byQ.values());

        let from = null, to = null;
        if (struckExact && (struckExact.from || struckExact.to)){
            const sx = struckExact;
            from = sx.from ? this._eraNum(sx.from) : null;
            to = sx.to ? this._eraNum(sx.to) : null;
        } else if (periodRange && (periodRange.start || periodRange.end)){
            from = periodRange.start ? this._eraNum(periodRange.start) : null;
            to = periodRange.end ? this._eraNum(periodRange.end) : null;
        }
        if (from != null || to != null){
            merged = merged.filter(it => {
                const y = it.year ?? null;
                if (y == null) return true;
                if (from != null && y < from) return false;
                if (to != null && y > to) return false;
                return true;
            });
        }

        merged.sort((a,b)=>{
            const ad = (a.year!=null) ? 1 : 0, bd = (b.year!=null) ? 1 : 0;
            if (bd - ad) return bd - ad;
            if (a.year!=null && b.year!=null && a.year !== b.year) return a.year - b.year;
            return (a.title||'').localeCompare(b.title||'');
        });

        const cap = 15;
        const out = [];
        for (const it of merged){
            let description = it.description || null;
            let imageUrl = it.image || null;
            if (!description || !imageUrl){
                try {
                    const info = await this._enrichWikidataEntity(it.qid, 'event');
                    if (info?.wikipedia?.extract) description = info.wikipedia.extract;
                    if (!imageUrl) imageUrl = info?.wikipedia?.thumbnail?.source || null;
                } catch(_){ }
            }
            out.push({ qid: it.qid, title: it.title, year: it.year, description, imageUrl });
            if (out.length >= cap) break;
        }
        this.setCache(cacheKey, out, { ttlMs: 1000*60*60*6 });
        return out;
    }

    // Migrate legacy coin.date field into struck_date + period
    _migrateLegacyDates(){
        let changed = false;
        this.coins.forEach(c => {
            if (c.date != null && c.struck_date == null && c.period == null){
                if (typeof c.date === 'number') {
                    const yr = c.date;
                    c.struck_date = {
                        from: { year: yr, era: yr < 0 ? 'BCE':'CE' },
                        to: null,
                        note: null
                    };
                } else if (typeof c.date === 'string') {
                    const txt = c.date.trim();
                    c.struck_date = { exact: null, note: txt || null };
                }
                delete c.date;
                changed = true;
            }
        });
        return changed;
    }

    // Ensure structured references have formatted strings and recompute type-series URIs from combined refs
    _migrateReferences(){
        if (!Array.isArray(this.coins)) return false;
        let changed = false;
        this.coins.forEach(c => {
            if (!Array.isArray(c.referencesStructured)) { c.referencesStructured = []; changed = true; }
            // Ensure formatted strings present
            const updated = [];
            for (const r of c.referencesStructured){
                const ref = { ...r };
                if (!ref.formatted) { ref.formatted = this._formatStructuredRef(ref); changed = true; }
                updated.push(ref);
            }
            c.referencesStructured = updated;
            // Recompute type-series URIs from combined ref text and merge
            const combined = this._structuredRefsCombinedForExtraction(c);
            const recomputed = this._extractTypeSeriesFromReferences(combined);
            const before = Array.isArray(c.typeSeriesUris) ? new Set(c.typeSeriesUris) : new Set();
            recomputed.forEach(u => before.add(u));
            const merged = Array.from(before);
            // Update if different order/values
            if (JSON.stringify(merged) !== JSON.stringify(c.typeSeriesUris || [])) { c.typeSeriesUris = merged; changed = true; }
        });
        if (changed) { try { this.saveCoins(); } catch(_){} }
        return changed;
    }

    _migrateImageFaces(){
        if (!Array.isArray(this.coins)) return false;
        let changed = false;
        this.coins.forEach(c => {
            if (!c || typeof c !== 'object') return;
            if (!c.imageFaces || typeof c.imageFaces !== 'object') {
                this._updateCoinImageFaces(c);
                changed = true;
            }
        });
        if (changed) { try { this.saveCoins(); } catch(_){} }
        return changed;
    }

    _normalizeDraftImageRoles(drafts){
        if (!Array.isArray(drafts) || drafts.length === 0) return drafts;
        const taken = new Set();
        drafts.forEach(d => {
            if (!d || !d.role) return;
            if (taken.has(d.role)) d.role = null;
            else taken.add(d.role);
        });
        let hasObv = drafts.some(d => d.role === 'obv');
        let hasRev = drafts.some(d => d.role === 'rev');
        drafts.forEach((d, idx) => {
            if (d.role) return;
            if (!hasObv) { d.role = 'obv'; hasObv = true; return; }
            if (!hasRev) { d.role = 'rev'; hasRev = true; return; }
            if (idx === 0 && !hasObv) { d.role = 'obv'; hasObv = true; }
        });
        return drafts;
    }

    _updateCoinImageFaces(coin, drafts=null){
        if (!coin || typeof coin !== 'object') return;
        const normalize = (url)=> (typeof url === 'string' && url.trim().length) ? url : null;
        const imgs = Array.isArray(coin.images) ? coin.images.filter(Boolean) : [];
        let obv = null;
        let rev = null;
        if (Array.isArray(drafts) && drafts.length){
            obv = normalize(drafts.find(d => d.role === 'obv')?.url);
            rev = normalize(drafts.find(d => d.role === 'rev')?.url);
        }
        if (!obv) obv = normalize(imgs[0]);
        if (!rev){
            rev = normalize(imgs.find(img => normalize(img) && normalize(img) !== obv));
        }
        coin.imageFaces = {
            obv: obv || null,
            rev: rev || null
        };
    }

    _normalizeExternalImageUrl(url){
        if (typeof url !== 'string') return null;
        const trimmed = url.trim();
        if (!trimmed) return null;
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        if (/^(?:\/|\.\.\/|\.\/)[^\s]+/.test(trimmed)) return trimmed;
        if (/^[A-Za-z0-9][A-Za-z0-9._\-\/]+$/.test(trimmed)) return trimmed;
        return null;
    }

    _applyExternalImageOverrides(coin, { obvUrl = null, revUrl = null } = {}){
        if (!coin || typeof coin !== 'object') return;
        const prevObvExternal = typeof coin.externalImageUrlObv === 'string' ? coin.externalImageUrlObv : null;
        const prevRevExternal = typeof coin.externalImageUrlRev === 'string' ? coin.externalImageUrlRev : null;
        const obvNormalized = this._normalizeExternalImageUrl(obvUrl);
        const revNormalized = this._normalizeExternalImageUrl(revUrl);
        if (!coin.imageFaces || typeof coin.imageFaces !== 'object') {
            coin.imageFaces = { obv: null, rev: null };
        }
        let imgs = Array.isArray(coin.images) ? coin.images.slice() : [];
        if (obvNormalized) {
            const prev = coin.imageFaces.obv;
            if (prev) imgs = imgs.filter(img => img !== prev);
            coin.externalImageUrlObv = obvNormalized;
            coin.imageFaces.obv = obvNormalized;
        } else {
            coin.externalImageUrlObv = null;
            if (prevObvExternal && coin.imageFaces.obv === prevObvExternal) {
                coin.imageFaces.obv = null;
            }
        }
        if (revNormalized) {
            const prev = coin.imageFaces.rev;
            if (prev) imgs = imgs.filter(img => img !== prev);
            coin.externalImageUrlRev = revNormalized;
            coin.imageFaces.rev = revNormalized;
        } else {
            coin.externalImageUrlRev = null;
            if (prevRevExternal && coin.imageFaces.rev === prevRevExternal) {
                coin.imageFaces.rev = null;
            }
        }
        coin.images = imgs;
    }

    _hasCoinImageSource(coin){
        if (!coin || typeof coin !== 'object') return false;
        const hasExternal = (value)=> typeof value === 'string' && value.trim().length > 0;
        if (hasExternal(coin.externalImageUrlObv) || hasExternal(coin.externalImageUrlRev)) return true;
        if (Array.isArray(coin.images) && coin.images.some(hasExternal)) return true;
        const faces = coin.imageFaces && typeof coin.imageFaces === 'object' ? coin.imageFaces : null;
        if (!faces) return false;
        return hasExternal(faces.obv) || hasExternal(faces.rev);
    }

    _collectCoinImageSources(coin){
        if (!coin || typeof coin !== 'object') return [];
        const seen = new Set();
        const out = [];
        const placeholder = this.PLACEHOLDER_IMAGE || null;
        const normalize = (url)=>{
            if (typeof url !== 'string') return null;
            const trimmed = url.trim();
            if (!trimmed) return null;
            if (placeholder && trimmed === placeholder) return null;
            return trimmed;
        };
        const push = (url)=>{
            const val = normalize(url);
            if (!val || seen.has(val)) return;
            seen.add(val);
            out.push(val);
        };
        push(coin.externalImageUrlObv);
        push(coin.externalImageUrlRev);
        if (coin.imageFaces && typeof coin.imageFaces === 'object') {
            push(coin.imageFaces.obv);
            push(coin.imageFaces.rev);
        }
        (Array.isArray(coin.images) ? coin.images : []).forEach(push);
        return out;
    }

    _getCoinFace(coin, face='obv'){
        const placeholder = this.PLACEHOLDER_IMAGE || '';
        if (!coin || typeof coin !== 'object') return placeholder;
        const normalize = (url)=> (typeof url === 'string' && url.trim().length) ? url : null;
        if (face === 'obv') {
            const externalObv = normalize(coin.externalImageUrlObv);
            if (externalObv) return externalObv;
        }
        const imgs = Array.isArray(coin.images) ? coin.images : [];
        const faces = (coin.imageFaces && typeof coin.imageFaces === 'object') ? coin.imageFaces : {};
        if (face === 'obv') {
            const fromMeta = normalize(faces.obv);
            if (fromMeta) return fromMeta;
            const direct = normalize(imgs[0]);
            if (direct) return direct;
            const any = normalize(faces.rev) || imgs.map(normalize).find(Boolean);
            return any || placeholder;
        }
        if (face === 'rev') {
            const externalRev = normalize(coin.externalImageUrlRev);
            if (externalRev) return externalRev;
            const front = this._getCoinFace(coin, 'obv') || placeholder;
            const fromMeta = normalize(faces.rev);
            if (fromMeta && fromMeta !== front) return fromMeta;
            const direct = normalize(imgs[1]);
            if (direct && direct !== front) return direct;
            const alt = imgs.map(normalize).find(img => img && img !== front);
            if (alt) return alt;
            return fromMeta || front || placeholder;
        }
        return placeholder;
    }

    _resolveCoinFaces(coin){
        const placeholder = this.PLACEHOLDER_IMAGE || '';
        if (!coin || typeof coin !== 'object') return { obv: placeholder, rev: placeholder };
        const front = this._getCoinFace(coin, 'obv') || placeholder;
        let back = this._getCoinFace(coin, 'rev');
        if (!back || back === front){
            const imgs = Array.isArray(coin.images)? coin.images.filter(Boolean) : [];
            const alt = imgs.find(url => typeof url === 'string' && url && url !== front);
            if (alt) back = alt;
        }
        if (!back) back = front || placeholder;
        return { obv: front, rev: back };
    }

    // Normalize Nomisma user-supplied URI or slug to canonical https://nomisma.org/id/<slug>
    _normalizeNomismaUrl(input) {
        if (!input) return null;
        let s = String(input).trim();
        // If already full URL
        const mFull = s.match(/^https?:\/\/nomisma\.org\/id\/([A-Za-z0-9_-]+)$/i);
        if (mFull) return `https://nomisma.org/id/${mFull[1]}`;
        // Accept nm:slug or just slug
        const mNm = s.match(/^nm:([A-Za-z0-9_-]+)$/i);
        if (mNm) return `https://nomisma.org/id/${mNm[1]}`;
        // Bare slug (no spaces, simple)
        if (/^[A-Za-z0-9_-]+$/.test(s)) return `https://nomisma.org/id/${s}`;
        // If user pasted a longer URL with path/query fragment, try to extract final segment
        try {
            const urlMatch = s.match(/nomisma\.org\/id\/([A-Za-z0-9_-]+)/i);
            if (urlMatch) return `https://nomisma.org/id/${urlMatch[1]}`;
        } catch(_) {}
        return null; // Can't normalize
    }

    _initPersistence() {
        try {
            const raw = localStorage.getItem('coinCollection');
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) this.coins = arr.map(c => ({
                    id: c.id || Date.now() + Math.floor(Math.random()*100000),
                    name: c.name || 'Untitled',
                    // Legacy field retained only for migration; will be transformed to struck_date/period
                    date: c.date || null,
                    origin: c.origin || '',
                    ruler: c.ruler || '',
                    material: c.material || '',
                    weight: c.weight || '',
                    diameter: c.diameter || '',
                    description: c.description || '',
                    references: c.references || '',
                    referencesStructured: Array.isArray(c.referencesStructured) ? c.referencesStructured : [],
                    obverse: c.obverse || '',
                    reverse: c.reverse || '',
                    images: Array.isArray(c.images) ? c.images : [],
                    externalImageUrlObv: typeof c.externalImageUrlObv === 'string' ? c.externalImageUrlObv : null,
                    externalImageUrlRev: typeof c.externalImageUrlRev === 'string' ? c.externalImageUrlRev : null,
                    imageFaces: (c.imageFaces && typeof c.imageFaces === 'object') ? c.imageFaces : null,
                    model3D: c.model3D || null,
                    addedDate: c.addedDate || new Date().toISOString(),
                    external_ids: c.external_ids || { nomisma: null, wikidata: null, searchUrls: null },
                    facts_snapshot: c.facts_snapshot || null,
                    enrichment_status: c.enrichment_status || 'stale',
                    enrichment_fetched_at: c.enrichment_fetched_at || null,
                    typeSeriesUris: c.typeSeriesUris || [],
                    struck_date: c.struck_date || null,
                    period: c.period || null
                }));
                // Run references migration to ensure formatted + type-series recomputed from structured refs
                try { this._migrateReferences(); } catch(_) {}
                try { this._migrateImageFaces(); } catch(_) {}
            }
        } catch (e) { console.warn('Failed to load existing collection', e); }
    }
    // Enrich a coin's linked concepts (Nomisma & Wikidata) with strict provenance gating
    async enrichCoin(id, { force = false, linksOnly = false } = {}) {
        const coin = this.coins.find(c => c.id === id);
        if (!coin) return null; // Return null if coin is not found
        if (!force && coin.enrichment_status === 'fresh' && coin.facts_snapshot) return coin.facts_snapshot;
        const snapshot = {};
        // Always compute simple search URLs (can be expanded later)
        if (!linksOnly) {
            const q = encodeURIComponent(coin.name || 'ancient coin');
            snapshot.searchUrls = [
                `https://www.google.com/search?q=${q}`,
                `https://www.acsearch.info/search.html?term=${q}`
            ];
        }
        // Enrich Nomisma-linked fields
        let qidFromNomismaAuthority = null;
        let qidFromNomismaMint = null;
        let qidFromNomismaPeriod = null;
        const tasks = [];
        if (coin.ruler && typeof coin.ruler === 'object' && coin.ruler.nomisma_uri){
            tasks.push((async()=>{ try { snapshot.nomisma_ruler = await this._enrichNomisma(coin.ruler.nomisma_uri); qidFromNomismaAuthority = snapshot.nomisma_ruler?.wikidata || null; } catch(_){} })());
        }
        if (coin.origin && typeof coin.origin === 'object' && coin.origin.nomisma_uri){
            tasks.push((async()=>{ try { snapshot.nomisma_origin = await this._enrichNomisma(coin.origin.nomisma_uri); qidFromNomismaMint = snapshot.nomisma_origin?.wikidata || null; } catch(_){} })());
        }
        if (coin.period && typeof coin.period === 'object' && coin.period.nomisma_uri){
            tasks.push((async()=>{ try { snapshot.nomisma_period = await this._enrichNomisma(coin.period.nomisma_uri); qidFromNomismaPeriod = snapshot.nomisma_period?.wikidata || null; } catch(_){} })());
        }
        // Material: resolve to Nomisma (via code or label) and enrich for authoritative label/definition
        try {
            const matUri = this._mapMaterialToNomisma(coin.material);
            if (matUri) {
                tasks.push((async()=>{ try { snapshot.nomisma_material = await this._enrichNomisma(matUri); } catch(_){} })());
            }
        } catch(_){}
        if (coin.external_ids && coin.external_ids.nomisma){
            tasks.push((async()=>{ try { snapshot.nomisma = await this._enrichNomisma(coin.external_ids.nomisma); } catch(_){} })());
        }
        if (tasks.length){ try { await Promise.all(tasks); } catch(_){} }
        // Wikidata enrichment strictly gated by Nomisma-derived QIDs
        if (qidFromNomismaAuthority){
            try { const ai = await this._enrichWikidataEntity(qidFromNomismaAuthority, 'authority'); if (ai) snapshot.authority_info = ai; } catch(e){ console.debug('Authority enrichment failed', e); }
        }
        if (qidFromNomismaMint){
            try { const mi = await this._enrichWikidataEntity(qidFromNomismaMint, 'mint'); if (mi) snapshot.mint_info = mi; } catch(e){ console.debug('Mint enrichment failed', e); }
        }
        if (qidFromNomismaPeriod){
            try { const pi = await this._enrichWikidataEntity(qidFromNomismaPeriod, 'period'); if (pi) snapshot.period_info = pi; } catch(e){ console.debug('Period enrichment failed', e); }
        }
        // Wikidata enrichment for material if available from Nomisma
        try {
            const qMat = snapshot.nomisma_material?.wikidata || null;
            if (qMat) {
                const mati = await this._enrichWikidataEntity(qMat, 'material');
                if (mati) snapshot.material_info = mati;
            }
        } catch(e){ console.debug('Material enrichment failed', e); }
        coin.facts_snapshot = snapshot;
        coin.enrichment_status = 'fresh';
        coin.enrichment_fetched_at = new Date().toISOString();
        this.saveCoins();
        return snapshot;
    }

    async _enrichWikidataEntity(term, kind = 'generic', trace = null) {
        const normalized = String(term).trim();
        if (!normalized) return null;
        const t0All = (window.performance?.now?.()||Date.now());
        const cacheHit = this.getCache(`wikidata:${normalized}`);
        if (cacheHit) { this._tracePush(trace, { type:'cache', label:`wikidata:${normalized}`, durationMs: 0, cacheHit: true }); return cacheHit; }
        // Strict gating: only accept direct QID input (from Nomisma exactMatch) or a wikidata entity URL
        let qid = null, label = null, description = null;
        const mUrl = normalized.match(/wikidata\.org\/(?:entity|wiki)\/(Q\d+)/i);
        if (/^Q\d+$/i.test(normalized)) {
            qid = normalized.toUpperCase();
        } else if (mUrl) {
            qid = mUrl[1].toUpperCase();
        } else {
            console.warn('Blocked Wikidata lookup without Nomisma-derived QID:', normalized);
            return null;
        }
        // Step 2: fetch entity claims + site links
        let wikipedia = null;
        let lastEntityJson = null;
        try {
            const entityUrl = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`; // CORS OK
            const t0 = (window.performance?.now?.()||Date.now());
            const res = await this._fetchWithTimeout(entityUrl, { timeout: 12000 });
            const data = await res.json();
            this._tracePush(trace, { type:'wikidata-entity', label:`EntityData ${qid}`, durationMs: Math.round((window.performance?.now?.()||Date.now()) - t0) });
            lastEntityJson = data;
            const ent = data.entities && data.entities[qid];
            if (ent && ent.sitelinks && ent.sitelinks.enwiki) {
                const tW = (window.performance?.now?.()||Date.now());
                wikipedia = await this._fetchWikipediaSummary(ent.sitelinks.enwiki.title);
                this._tracePush(trace, { type:'wikipedia', label: `summary ${ent.sitelinks.enwiki.title}`, durationMs: Math.round((window.performance?.now?.()||Date.now()) - tW) });
            }
            if (!label && ent && ent.labels && ent.labels.en) label = ent.labels.en.value;
            if (!description && ent && ent.descriptions && ent.descriptions.en) description = ent.descriptions.en.value;
        } catch (e) { console.debug('Entity fetch error', e); }
    const info = { qid, label, description, wikipedia, fromNomismaExactMatch: true };
        // Parse lightweight claims (reign years, basic relationships) from entity JSON
        try {
            if (lastEntityJson && lastEntityJson.entities && lastEntityJson.entities[qid]) {
                const ent = lastEntityJson.entities[qid];
                info.claims_parsed = this._parseWikidataClaims(ent, kind);
            }
        } catch (_) { /* non-critical */ }
        this.setCache(`wikidata:${normalized}`, info); // cache enriched info
        this._tracePush(trace, { type:'wikidata-entity', label:`enrich ${qid}`, durationMs: Math.round((window.performance?.now?.()||Date.now()) - t0All), resultCount: info ? 1 : 0 });
        return info;
    }

    // Extract useful structured facts from Wikidata entity claims without extra network requests
    _parseWikidataClaims(ent, kind) {
        if (!ent || !ent.claims) return null;
        const claims = ent.claims;
        const out = {};
        // Helper to parse a Wikidata time string to year + era
        const parseTimeYear = (t) => {
            if (!t || typeof t !== 'string') return null;
            const m = t.match(/^[+-]?(\d{1,4})-/); // +0123-00-00T..
            if (!m) return null;
            let year = parseInt(m[1], 10);
            // Wikidata uses proleptic Gregorian; years before 0 -> BCE
            const era = (t.startsWith('-')) ? 'BCE' : 'CE';
            return { year, era };
        };
        // Reign: scan P39 (position held) qualifiers P580 (start), P582 (end) filtered to Roman emperor (Q842606)
        if (claims.P39) {
            let earliest = null, latest = null;
            for (const c of claims.P39) {
                const posSnak = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id;
                if (posSnak && posSnak !== 'Q842606') continue; // Only Roman emperor
                const qs = c.qualifiers || {};
                const startSnaks = qs.P580 || [];
                const endSnaks = qs.P582 || [];
                const start = startSnaks[0] && startSnaks[0].datavalue && startSnaks[0].datavalue.value && startSnaks[0].datavalue.value.time;
                const end = endSnaks[0] && endSnaks[0].datavalue && endSnaks[0].datavalue.value && endSnaks[0].datavalue.value.time;
                const startY = parseTimeYear(start);
                const endY = parseTimeYear(end);
                if (startY) {
                    if (!earliest || startY.year < earliest.year || (startY.era === 'BCE' && earliest.era === 'CE')) earliest = startY;
                }
                if (endY) {
                    if (!latest || endY.year > latest.year || (endY.era === 'CE' && latest.era === 'BCE')) latest = endY;
                }
            }
            if (earliest || latest) {
                out.reign = { start: earliest || null, end: latest || null };
            }
        }
        // Parents: father (P22), mother (P25) - store QIDs only to honor gating
        const father = (claims.P22 && claims.P22[0] && claims.P22[0].mainsnak && claims.P22[0].mainsnak.datavalue && claims.P22[0].mainsnak.datavalue.value && claims.P22[0].mainsnak.datavalue.value.id) || null;
        if (father || mother) out.parents = { father, mother };
        // Spouse(s) P26
        if (claims.P26) {
            out.spouses = claims.P26.map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id).filter(Boolean);
            if (!out.spouses.length) delete out.spouses;
        }
        // Dynasty / family P53
        if (claims.P53) {
            out.dynasties = claims.P53.map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id).filter(Boolean);
            if (!out.dynasties.length) delete out.dynasties;
        }
        return Object.keys(out).length ? out : null;
    }

    _resolveMintCoordinates(primary, fallback) {
        const candidates = [
            primary?.coordinates,
            primary?.claims_parsed?.coordinates,
            fallback?.coordinates
        ];
        for (const cand of candidates) {
            const norm = this._normalizeCoordinates(cand);
            if (norm) return norm;
        }
        return null;
    }

    _normalizeCoordinates(raw) {
        if (!raw) return null;
        const toNum = (val) => {
            if (val == null) return null;
            if (typeof val === 'number') return Number.isFinite(val) ? val : null;
            if (typeof val === 'string') {
                const trimmed = val.trim();
                if (!trimmed) return null;
                const parsed = Number(trimmed);
                return Number.isFinite(parsed) ? parsed : null;
            }
            if (typeof val === 'object' && val !== null && Object.prototype.hasOwnProperty.call(val, 'value')) {
                return toNum(val.value);
            }
            return null;
        };
        let lat = null;
        let lon = null;
        if (Array.isArray(raw) && raw.length >= 2) {
            lat = toNum(raw[0]);
            lon = toNum(raw[1]);
        } else if (typeof raw === 'string') {
            const parts = raw.split(/[,;\s]+/).filter(Boolean);
            if (parts.length >= 2) {
                lat = toNum(parts[0]);
                lon = toNum(parts[1]);
            }
        } else if (typeof raw === 'object') {
            lat = toNum(raw.lat ?? raw.latitude ?? raw.latDeg ?? raw.lat_deg ?? raw.y ?? raw.latlon?.lat);
            lon = toNum(raw.lon ?? raw.lng ?? raw.longitude ?? raw.long ?? raw.x ?? raw.latlon?.lon);
            if ((lat == null || lon == null) && typeof raw.value === 'string') {
                const pieces = raw.value.split(/[,;\s]+/).filter(Boolean);
                if (pieces.length >= 2) {
                    if (lat == null) lat = toNum(pieces[0]);
                    if (lon == null) lon = toNum(pieces[1]);
                }
            }
        }
        if (lat == null || lon == null) return null;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
        return { lat, lon };
    }

    _renderMintMap(coords, label = '') {
        if (!coords) return '';
        const lat = coords.lat;
        const lon = coords.lon;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
            const latStr = lat.toFixed(4);
            const lonStr = lon.toFixed(4);
            const latRadius = Math.abs(lat) > 55 ? 0.8 : 0.5;
        const lonRadius = Math.abs(lat) > 55 ? 1.0 : 0.6;
        const latMin = Math.max(-90, lat - latRadius).toFixed(4);
        const latMax = Math.min(90, lat + latRadius).toFixed(4);
        const lonMin = Math.max(-180, lon - lonRadius).toFixed(4);
        const lonMax = Math.min(180, lon + lonRadius).toFixed(4);
        const bbox = encodeURIComponent(`${lonMin},${latMin},${lonMax},${latMax}`);
        const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latStr}%2C${lonStr}`;
        const osmUrl = `https://www.openstreetmap.org/?mlat=${latStr}&mlon=${lonStr}#map=12/${latStr}/${lonStr}`;
        const altLabel = label ? `Map showing mint near ${label}` : 'Map showing mint location';
        return `
            <div class=\"mint-map-block\">
                <div class=\"mint-map-canvas\">
                    <iframe class=\"mint-map-frame\" src=\"${this.escapeHtml(embedUrl)}\" title=\"${this.escapeHtml(altLabel)}\" loading=\"lazy\" referrerpolicy=\"no-referrer-when-downgrade\"></iframe>
                </div>
                <div class=\"mint-map-meta\">
                    <span class=\"mint-map-coords\">Lat ${latStr}, Lon ${lonStr}</span>
                    <a class=\"mint-map-link\" href=\"${this.escapeHtml(osmUrl)}\" target=\"_blank\" rel=\"noopener\">Open map</a>
                </div>
            </div>`;
    }

    async _enrichNomisma(idOrUrl, trace = null) {
        const baseUrl = this._normalizeNomismaUrl(idOrUrl);
        if (!baseUrl) return null;
        const t0All = (window.performance?.now?.()||Date.now());
        const cacheHit = this.getCache(`nomisma:${baseUrl}`);
        if (cacheHit) { this._tracePush(trace, { type:'cache', label:`nomisma:${baseUrl.split('/').pop()}`, durationMs: 0, cacheHit: true }); return cacheHit; }
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
                const t0 = (window.performance?.now?.()||Date.now());
                const res = await this._fetchWithTimeout(u, { timeout: 12000, init: isJsonld ? {} : { headers: { Accept: 'application/ld+json, application/json;q=0.9, */*;q=0.1' } } });
                const ctype = res.headers.get('content-type') || '';
                if (!/json/i.test(ctype)) { continue; }
                data = await res.json();
                finalUrl = u;
                this._tracePush(trace, { type:'nomisma', label: `fetch ${u}`, durationMs: Math.round((window.performance?.now?.()||Date.now()) - t0) });
                break;
            } catch (_) { /* try next */ }
        }
        if (!data) return null;
        // JSON-LD graph; find the primary concept node robustly (handle nm: prefix, http vs https, exclude fragments)
        const graph = Array.isArray(data['@graph']) ? data['@graph'] : [data];
        const slug = baseUrl.split('/').pop();
        const isPrimaryType = (n) => {
            const t = n['@type'];
            const arr = Array.isArray(t) ? t : (t ? [t] : []);
            return arr.some(x => String(x).includes('skos#Concept') || String(x).includes('skos:Concept') || String(x).includes('foaf/0.1/Person') || String(x).includes('foaf:Person') || String(x).includes('nomisma.org/ontology#'));
        };
        const idMatches = (id) => {
            if (!id) return false;
            if (typeof id !== 'string') return false;
            const idBase = id.split('#')[0]; // allow #this fragments
            if (idBase === baseUrl) return true;
            const httpId = baseUrl.replace(/^https:/i, 'http:');
            if (idBase === httpId) return true;
            if (idBase === `http://nomisma.org/id/${slug}` || idBase === `https://nomisma.org/id/${slug}`) return true;
            if (idBase === `nm:${slug}`) return true;
            return idBase.endsWith(`/${slug}`) || idBase.endsWith(`:${slug}`);
        };
        let node = graph.find(n => idMatches(n['@id']) && isPrimaryType(n));
        if (!node) node = graph.find(n => idMatches(n['@id']));
        if (!node) node = graph.find(n => (n['@id'] || '').includes(slug) && !(n['@id'] || '').includes('#'));
        if (!node) node = graph[0];
        if (!node) return null;
        const pickProp = (obj, keys) => {
            for (const k of keys) { if (obj && obj[k] != null) return obj[k]; }
            return null;
        };
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
        const latKeys = ['http://www.w3.org/2003/01/geo/wgs84_pos#lat','geo:lat','lat','latitude'];
        const lonKeys = ['http://www.w3.org/2003/01/geo/wgs84_pos#long','geo:long','lon','long','longitude'];
        const readCoordsFromNode = (n) => {
            if (!n) return null;
            const latVal = getNum(pickProp(n, latKeys));
            const lonVal = getNum(pickProp(n, lonKeys));
            if (latVal == null || lonVal == null) return null;
            if (!Number.isFinite(latVal) || !Number.isFinite(lonVal)) return null;
            return { lat: latVal, lon: lonVal };
        };
        // Accept both expanded and compacted JSON-LD keys
        const label = getEn(pickProp(node, ['http://www.w3.org/2004/02/skos/core#prefLabel','skos:prefLabel','label'])) || null;
        const definition = getEn(pickProp(node, ['http://www.w3.org/2004/02/skos/core#definition','skos:definition','http://www.w3.org/2004/02/skos/core#scopeNote','skos:scopeNote'])) || null;
        let wikidata = null;
        const exactRaw = pickProp(node, ['http://www.w3.org/2004/02/skos/core#exactMatch','skos:exactMatch','exactMatch']);
        const exactArr = Array.isArray(exactRaw) ? exactRaw : (exactRaw ? [exactRaw] : []);
        const rawExactMatches = exactArr.map(em => (typeof em === 'string') ? em : (em && (em['@id'] || em['@value']) || null)).filter(Boolean);
        let chosenUrl = null;
        for (const val of rawExactMatches) {
            const s = String(val);
            // Accept /entity/Qxxx, /wiki/Qxxx, with optional fragments/query
            const m = s.match(/wikidata\.org\/(?:entity|wiki)\/?(Q\d+)/i) || s.match(/\b(Q\d+)\b/);
            if (m && m[1]) { wikidata = m[1].toUpperCase(); chosenUrl = s.replace(/^http:/i,'https:'); break; }
        }
        // Fallback: scan entire graph for any exactMatch pointing to a Wikidata QID
        if (!wikidata) {
            try {
                for (const n of graph) {
                    const emRaw = n['http://www.w3.org/2004/02/skos/core#exactMatch'] || n['skos:exactMatch'] || n['exactMatch'] || [];
                    const arr = Array.isArray(emRaw) ? emRaw : [emRaw];
                    for (const em of arr) {
                        const v = typeof em === 'string' ? em : (em && (em['@id'] || em['@value']) || '');
                        const s = String(v);
                        const m = s.match(/wikidata\.org\/(?:entity|wiki)\/?(Q\d+)/i) || s.match(/\b(Q\d+)\b/);
                        if (m && m[1]) { wikidata = m[1].toUpperCase(); chosenUrl = s.replace(/^http:/i,'https:'); break; }
                    }
                    if (wikidata) break;
                }
            } catch(_) {}
        }
        // Debug exactMatch scan (include chosenUrl)
        try { console.debug('Nomisma exactMatch scan', { nomismaId: baseUrl, nodeId: node['@id'], exactMatches: rawExactMatches, chosenUrl, chosenQid: wikidata }); } catch(_){}
        let coords = readCoordsFromNode(node);
        let coordSource = coords ? 'primary-node' : null;
        if (!coords) {
            const spatial = graph.find(n => {
                const id = n['@id'] || '';
                if (!idMatches(id)) return false;
                const t = Array.isArray(n['@type']) ? n['@type'] : (n['@type'] ? [n['@type']] : []);
                return t.some(val => {
                    const s = String(val).toLowerCase();
                    return s.includes('spatial') || s.includes('geo') || s.includes('place');
                });
            });
            coords = readCoordsFromNode(spatial);
            if (coords) coordSource = 'spatial-node';
        }
        if (!coords) {
            for (const n of graph) {
                const val = readCoordsFromNode(n);
                if (val) { coords = val; coordSource = 'graph-fallback'; break; }
            }
        }
        const info = { uri: baseUrl, label, definition, wikidata, coordinates: coords || null };
        if (this._debug) {
            try {
                if (coords) console.debug('Nomisma coordinates resolved', { nomismaId: baseUrl, source: coordSource, lat: coords.lat, lon: coords.lon });
                else console.debug('Nomisma coordinates missing', { nomismaId: baseUrl, label });
            } catch(_) {}
        }
        this.setCache(`nomisma:${baseUrl}`, info);
        this._tracePush(trace, { type:'nomisma', label:`enrich ${slug}`, durationMs: Math.round((window.performance?.now?.()||Date.now()) - t0All), note: wikidata?`wd:${wikidata}`:'' });
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

    // WDQS and Nomisma period enumeration helpers removed; period is manual URL now

    // Lightweight labels lookup for Wikidata QIDs (English)
    async _fetchWikidataLabels(qids = []) {
        const ids = Array.from(new Set(qids.filter(Boolean)));
        if (!ids.length) return {};
        try {
            const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&props=labels&languages=en&ids=${encodeURIComponent(ids.join('|'))}&format=json&origin=*`;
            const res = await this._fetchWithTimeout(url, { timeout: 12000 });
            const data = await res.json();
            const out = {};
            const entities = data.entities || {};
            Object.keys(entities).forEach(q => {
                const lbl = entities[q]?.labels?.en?.value || null;
                if (lbl) out[q] = lbl;
            });
            return out;
        } catch (_) { return {}; }
    }

    async _fetchWithTimeout(url, { timeout = 10000, retries = 1, init = {}, throwOnHTTPError = true } = {}) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), timeout);
            try {
                const res = await fetch(url, { ...init, signal: controller.signal });
                clearTimeout(t);
                if (!res.ok) {
                    if (throwOnHTTPError) throw new Error(`HTTP ${res.status}`);
                    return res;
                }
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

    // Schedule a WDQS task with min-gap and concurrency control
    _wdqsScheduleTask(exec, label = 'wdqs') {
        return new Promise((resolve, reject) => {
            this._wdqsQueue.push({ exec, resolve, reject, label });
            this._wdqsPump();
        });
    }

    _wdqsPump() {
        if (this._wdqsActive >= this._wdqsMaxConcurrency) return;
        const now = Date.now();
        const sinceLast = now - this._wdqsLastStart;
        if (sinceLast < this._wdqsMinGapMs) {
            const jitter = Math.floor(Math.random() * 200);
            const wait = this._wdqsMinGapMs - sinceLast + 10 + jitter;
            setTimeout(() => this._wdqsPump(), wait);
            return;
        }
        const job = this._wdqsQueue.shift();
        if (!job) return;
        this._wdqsActive += 1;
        this._wdqsLastStart = Date.now();
        const finalize = () => {
            this._wdqsActive -= 1;
            this._wdqsPump();
        };
        Promise.resolve()
            .then(() => job.exec())
            .then((res) => { finalize(); job.resolve(res); })
            .catch((err) => { finalize(); job.reject(err); });
    }

    // WDQS query with retry/backoff and proper scheduling. Returns parsed JSON.
    async _wdqsQuery(label, query, { timeout = 45000, maxRetries = 3, trace = null } = {}) {
        const endpoint = 'https://query.wikidata.org/sparql';
        const url = `${endpoint}?format=json&query=${encodeURIComponent(query)}`;
        const t0 = (window.performance?.now?.()||Date.now());
        const doFetch = async () => {
            let lastErr = null;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                // jittered backoff (skip before first try)
                if (attempt > 0) {
                    const base = 700 * Math.pow(2, attempt - 1); // 0.7s, 1.4s, 2.8s ...
                    const jitter = Math.floor(Math.random() * 250);
                    await new Promise(r => setTimeout(r, base + jitter));
                }
                try {
                    const controller = new AbortController();
                    const t = setTimeout(() => controller.abort(), timeout);
                    const res = await fetch(url, { headers: { 'Accept': 'application/sparql-results+json' }, signal: controller.signal });
                    clearTimeout(t);
                    if (res.status === 429) {
                        // respect Retry-After if present, then retry
                        const ra = parseInt(res.headers.get('retry-after') || '0', 10);
                        // adapt pacing upward on rate-limit
                        try {
                            const targetGap = (!isNaN(ra) && ra > 0) ? Math.min(2500, 1000 + ra * 1000) : 1800;
                            this._wdqsMinGapMs = Math.max(this._wdqsMinGapMs, targetGap);
                        } catch(_) {}
                        if (!isNaN(ra) && ra > 0) await new Promise(r => setTimeout(r, ra * 1000));
                        lastErr = new Error('HTTP 429');
                        continue;
                    }
                    if (!res.ok) {
                        // retry on some transient server errors
                        if ([502,503,504].includes(res.status)) { lastErr = new Error(`HTTP ${res.status}`); continue; }
                        const msg = await res.text().catch(()=>`HTTP ${res.status}`);
                        throw new Error(msg || `HTTP ${res.status}`);
                    }
                    const ct = (res.headers.get('content-type') || '').toLowerCase();
                    if (!ct.includes('json')) {
                        const text = await res.text();
                        throw new Error(`Unexpected content-type ${ct}; first 200: ${text.slice(0,200)}`);
                    }
                    const data = await res.json();
                    try {
                        const dur = (window.performance?.now?.()||Date.now()) - t0;
                        const rc = data?.results?.bindings?.length || 0;
                        this._tracePush(trace, { type:'wdqs', label, durationMs: Math.round(dur), resultCount: rc });
                    } catch(_){}
                    return data;
                } catch (e) {
                    // AbortError or network issues – treat as retryable up to maxRetries
                    lastErr = e;
                }
            }
            throw lastErr || new Error('WDQS request failed');
        };
        try {
            return await this._wdqsScheduleTask(doFetch, label);
        } catch (e) {
            console.error('WDQS error on', label, e);
            try {
                const dur = (window.performance?.now?.()||Date.now()) - t0;
                this._tracePush(trace, { type:'wdqs', label, durationMs: Math.round(dur), error: e?.message||String(e) });
            } catch(_){}
            throw e;
        }
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
        // Form submission
        document.getElementById('coinForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addCoin();
        });

        // Clear images button
        const clearImagesBtn = document.getElementById('clearImagesBtn');
        if (clearImagesBtn) {
            clearImagesBtn.addEventListener('click', () => {
                const imgInput = document.getElementById('coinImages');
                if (imgInput) imgInput.value = '';
                this._draftImages = [];
                this._renderImageDraftList();
            });
        }

        // Image file selection -> build draft list with roles
        const imgInput = document.getElementById('coinImages');
        if (imgInput){
            imgInput.addEventListener('change', async (e)=>{
                try { await this._onImageFilesSelected(e.target.files); } catch(_) {}
            });
        }

        // Swap Obv/Rev quick action
        const swapBtn = document.getElementById('swapObvRevBtn');
        if (swapBtn){
            swapBtn.addEventListener('click', ()=>{
                if (!Array.isArray(this._draftImages) || this._draftImages.length<2) return;
                const iObv = this._draftImages.findIndex(x=> x.role==='obv');
                const iRev = this._draftImages.findIndex(x=> x.role==='rev');
                if (iObv===-1 || iRev===-1) return;
                this._draftImages[iObv].role = 'rev';
                this._draftImages[iRev].role = 'obv';
                this._renderImageDraftList();
            });
        }

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
        // Period is manual URL; no scoped Nomisma search

        // Material dropdown logic + link indicator
        const matSel = document.getElementById('coinMaterialSelect');
        const matOther = document.getElementById('coinMaterialOther');
        if (matSel && matOther) {
            matSel.addEventListener('change', () => {
                matOther.style.display = matSel.value === 'OTHER' ? 'block' : 'none';
                this._updateMaterialLinkInfo();
            });
            matOther.addEventListener('input', () => this._updateMaterialLinkInfo());
            // initial state
            this._updateMaterialLinkInfo();
        }

        // Numeric validation for weight/diameter
        const weightEl = document.getElementById('coinWeight');
        const weightErr = document.getElementById('weightError');
        const diamEl = document.getElementById('coinDiameter');
        const diamErr = document.getElementById('diameterError');
        const validateNumber = (el, errEl) => {
            if (!el) return true;
            const v = el.value.trim();
            if (!v) { if (errEl) errEl.style.display = 'none'; return true; }
            const n = Number(v.replace(',', '.'));
            const ok = Number.isFinite(n) && n >= 0;
            if (errEl) errEl.style.display = ok ? 'none' : 'block';
            return ok;
        };
        weightEl?.addEventListener('input', () => validateNumber(weightEl, weightErr));
        diamEl?.addEventListener('input', () => validateNumber(diamEl, diamErr));

        // Global click: dismiss any open suggestions when clicking outside
        document.addEventListener('click', (e) => {
            const ids = ['originSuggest','rulerSuggest'];
            ids.forEach(id => {
                const box = document.getElementById(id);
                if (!box || box.style.display === 'none') return;
                const input = id==='originSuggest'? document.getElementById('coinOrigin') : document.getElementById('coinRuler');
                const btn = id==='originSuggest'? document.getElementById('originSearchBtn') : document.getElementById('rulerSearchBtn');
                const clickedInside = box.contains(e.target) || input.contains?.(e.target) || btn.contains?.(e.target) || (e.target===input) || (e.target===btn);
                if (!clickedInside) box.style.display = 'none';
            });
            // Close ref search menu if clicking outside
            const refBtn = document.getElementById('refSearchBtn');
            const refMenu = document.getElementById('refSearchMenu');
            if (refMenu && refMenu.style.display === 'block') {
                const inside = refMenu.contains(e.target) || e.target === refBtn;
                if (!inside) { refMenu.style.display = 'none'; refBtn?.setAttribute('aria-expanded','false'); }
            }
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
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.sortCoins(e.target.value);
            });
            sortSelect.value = this._currentSort || 'struck';
        }

        const selectionModeBtn = document.getElementById('selectionModeBtn');
        if (selectionModeBtn) {
            const syncSelectionBtn = () => selectionModeBtn.setAttribute('aria-pressed', String(document.body.classList.contains('selection-mode')));
            syncSelectionBtn();
            selectionModeBtn.addEventListener('click', () => {
                document.body.classList.toggle('selection-mode');
                syncSelectionBtn();
            });
        }

        // Actions dropdown (Select for Print / Export / Import)
        const actionsBtn = document.getElementById('actionsBtn');
        const actionsMenu = document.getElementById('actionsMenu');
        const hideActionsMenu = () => {
            if (actionsMenu) actionsMenu.style.display = 'none';
            if (actionsBtn) actionsBtn.setAttribute('aria-expanded', 'false');
        };
        if (actionsBtn && actionsMenu) {
            const showMenu = () => { actionsMenu.style.display = 'block'; actionsBtn.setAttribute('aria-expanded', 'true'); };
            actionsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = actionsMenu.style.display === 'block';
                if (isOpen) hideActionsMenu(); else showMenu();
            });
            document.addEventListener('click', (e) => {
                if (!actionsMenu.contains(e.target) && e.target !== actionsBtn) hideActionsMenu();
            });
        }

        const addCoinMenuBtn = document.getElementById('addCoinMenuBtn');
        if (addCoinMenuBtn) {
            addCoinMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openAddCoinForm();
                hideActionsMenu();
            });
        }

        // Data & storage center
        const dataManagerBtn = document.getElementById('dataManagerBtn');
        const dataModal = document.getElementById('dataModal');
        const closeDataModalBtn = document.getElementById('closeDataModal');
        if (dataManagerBtn) {
            dataManagerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openDataModal();
                hideActionsMenu();
            });
        }
        if (closeDataModalBtn) closeDataModalBtn.addEventListener('click', () => this.closeDataModal());
        if (dataModal) {
            dataModal.addEventListener('click', (e) => {
                if (e.target === dataModal) this.closeDataModal();
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const modal = document.getElementById('dataModal');
                if (modal && !modal.classList.contains('hidden')) this.closeDataModal();
            }
        });

        const refreshStatsBtn = document.getElementById('storageStatsRefreshBtn');
        if (refreshStatsBtn) refreshStatsBtn.addEventListener('click', () => this._loadStorageStats());

        const exportBtnJson = document.getElementById('dataExportJsonBtn');
        if (exportBtnJson) {
            exportBtnJson.addEventListener('click', () => {
                const scope = this._getSelectedExportScope();
                if (scope === 'selection' && (!this.selectedForPrint || this.selectedForPrint.size === 0)) {
                    alert('Select at least one coin to export.');
                    return;
                }
                this.exportCollection({ scope });
            });
        }
        const exportBtnJsonLd = document.getElementById('dataExportJsonLdBtn');
        if (exportBtnJsonLd) {
            exportBtnJsonLd.addEventListener('click', () => {
                const scope = this._getSelectedExportScope();
                if (scope === 'selection' && (!this.selectedForPrint || this.selectedForPrint.size === 0)) {
                    alert('Select at least one coin to export.');
                    return;
                }
                this.exportCollectionJsonLd({ scope });
            });
        }

        const importBtnJson = document.getElementById('dataImportJsonBtn');
        const importFile = document.getElementById('dataImportInput');
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

        const cleanStorageBtn = document.getElementById('dataCleanBtn');
        if (cleanStorageBtn) {
            cleanStorageBtn.addEventListener('click', () => {
                this._promptStorageCleanup();
            });
        }

        // Open Compare from overview Actions menu
        const openCompareBlankGlobalBtn = document.getElementById('openCompareBlankGlobalBtn');
        if (openCompareBlankGlobalBtn) {
            openCompareBlankGlobalBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openCompareBlank();
                hideActionsMenu();
            });
        }

        const museumModeGlobalBtn = document.getElementById('museumModeGlobalBtn');
        if (museumModeGlobalBtn) {
            museumModeGlobalBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openMuseumFromOverview();
                hideActionsMenu();
            });
        }

        // Theme toggle and initialization
        const themeBtn = document.getElementById('toggleThemeBtn');
        const applyTheme = (theme) => {
            const t = theme === 'dark' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', t);
            if (themeBtn) themeBtn.textContent = t === 'dark' ? 'Light Mode' : 'Dark Mode';
        };
        // Initialize theme from saved preference or system preference
        try {
            const saved = localStorage.getItem('theme');
            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            applyTheme(saved || (prefersDark ? 'dark' : 'light'));
        } catch (_) { applyTheme('light'); }
        if (themeBtn) {
            themeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
                const next = cur === 'dark' ? 'light' : 'dark';
                applyTheme(next);
                try { localStorage.setItem('theme', next); } catch (_) {}
                hideActionsMenu();
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

        // Reference search menu wiring
        const refBtn = document.getElementById('refSearchBtn');
        const refMenu = document.getElementById('refSearchMenu');
        const refsInput = document.getElementById('coinReferences');
        if (refBtn && refMenu && refsInput) {
            const buildMenu = () => {
                const term = encodeURIComponent(refsInput.value.trim());
                const searchItems = [
                    { label: 'OCRE search', url: term ? `https://numismatics.org/ocre/results?q=${term}` : 'https://numismatics.org/ocre/' },
                    { label: 'CRRO search (Republican)', url: term ? `https://numismatics.org/crro/results?q=${term}` : 'https://numismatics.org/crro/' },
                    { label: 'ACSearch', url: term ? `https://www.acsearch.info/search.html?term=${term}` : 'https://www.acsearch.info/' },
                    { label: 'WildWinds (Google site search)', url: `https://www.google.com/search?q=${term}+site%3Awildwinds.com` },
                    { label: 'Google (all web)', url: `https://www.google.com/search?q=${term}` }
                ];
                refMenu.innerHTML = searchItems.map(it => `<a href="${it.url}" class="menu-item" role="menuitem" target="_blank" rel="noopener">${it.label}</a>`).join('');
            };
            refBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = refMenu.style.display === 'block';
                if (open) { refMenu.style.display = 'none'; refBtn.setAttribute('aria-expanded','false'); }
                else { buildMenu(); refMenu.style.display = 'block'; refBtn.setAttribute('aria-expanded','true'); }
            });
        }
        this._initReferenceUI();
    }

    async _promptStorageCleanup(){
        const coinCount = Array.isArray(this.coins) ? this.coins.length : 0;
        const modelCount = this.coins.reduce((sum, coin) => sum + (coin?.model3D?.assetId ? 1 : 0), 0);
        let jsonBytes = 0;
        try {
            jsonBytes = JSON.stringify(this.coins || []).length;
        } catch(_){ jsonBytes = 0; }
        let idbBytes = null;
        try {
            idbBytes = await assetStorage.estimateUsage();
        } catch(_){ idbBytes = null; }
        const jsonMb = (jsonBytes/1024/1024) || 0;
        const idbMb = idbBytes!=null ? (idbBytes/1024/1024) : null;
        const warningLines = [
            'You are about to permanently delete:',
            `• ${coinCount} coin record${coinCount===1?'':'s'} including embedded images (~${jsonMb.toFixed(2)} MB in localStorage)`,
            `• ${modelCount} stored 3D model${modelCount===1?'':'s'}${idbMb!=null?` (~${idbMb.toFixed(2)} MB in IndexedDB)`:''}`,
            '• App preferences (e.g., dark mode) stored in localStorage'
        ];
        const confirmMsg = `${warningLines.join('\n')}\n\nThis action cannot be undone. Continue?`;
        if (!window.confirm(confirmMsg)) return;
        await this._executeStorageCleanup();
    }

    async _executeStorageCleanup(){
        try {
            await assetStorage.clearAll();
        } catch (err) {
            console.warn('Failed to clear asset storage', err);
        }
        try { localStorage.removeItem('coinCollection'); } catch(_){ }
        try { localStorage.removeItem('theme'); } catch(_){ }
        this.coins = [];
        this.selectedForPrint.clear();
        this._draftImages = [];
        this._draftStructuredRefs = [];
        this._editingRefIndex = -1;
        this.cache?.clear?.();
        this.renderCoins();
        this.resetFormToAddMode();
        alert('Storage cleaned. All coins, embedded images, and stored models have been removed.');
    }

    _updateMaterialLinkInfo(){
        const host = document.getElementById('materialLinkInfo');
        if (!host) return;
        const sel = document.getElementById('coinMaterialSelect');
        const other = document.getElementById('coinMaterialOther');
        const val = sel?.value || '';
        const label = (val === 'OTHER') ? (other?.value || '') : val;
        // Show Nomisma link hint only for predefined options, not for custom OTHER
        if (val && val !== 'OTHER') {
            const uri = this._mapMaterialToNomisma({ code: val, label: val });
            const text = (val==='AR'?'Silver (AR)':val==='AV'?'Gold (AV)':val==='AE'?'Bronze (AE)':val==='EL'?'Electrum (EL)':val==='BI'?'Billon (BI)':val==='CU'?'Copper (CU)': val);
            if (uri) {
                host.innerHTML = `<span class="chip" title="Linked to Nomisma material">${this.escapeHtml(text)}<a class="chip-link" href="${this.escapeHtml(uri)}" target="_blank" aria-label="Open Nomisma" title="Open on nomisma.org">🔗</a><span class="badge" title="Nomisma link">Nomisma</span><button type="button" class="chip-remove" title="Clear">×</button></span>`;
                host.querySelector('.chip-remove')?.addEventListener('click', ()=>{ if (sel) sel.value=''; if (other) { other.value=''; other.style.display='none'; } this._updateMaterialLinkInfo(); });
                return;
            }
        }
        if (label && (val === 'OTHER')) {
            host.innerHTML = `<span class="chip">${this.escapeHtml(label)}<button type="button" class="chip-remove" title="Clear">×</button></span>`;
            host.querySelector('.chip-remove')?.addEventListener('click', ()=>{ if (other) other.value=''; this._updateMaterialLinkInfo(); });
        } else {
            host.innerHTML = '';
        }
    }

    _mapMaterialToNomisma(mat){
        const code = (typeof mat === 'object' && mat && mat.code) ? String(mat.code).toUpperCase() : null;
        const label = (typeof mat === 'object' && mat && mat.label) ? String(mat.label) : (typeof mat === 'string' ? mat : '');
        const txt = (label || '').toLowerCase().trim();
        const byCode = {
            AR: 'https://nomisma.org/id/ar',
            AV: 'https://nomisma.org/id/av',
            AE: 'https://nomisma.org/id/ae',
            EL: 'https://nomisma.org/id/el',
            BI: 'https://nomisma.org/id/bi',
            CU: 'https://nomisma.org/id/cu'
        };
        if (code && byCode[code]) return byCode[code];
        if (!txt) return null;
        if (/\b(silver|argent|\bar\b)\b/.test(txt)) return 'https://nomisma.org/id/ar';
        if (/\b(gold|aurum|\bav\b)\b/.test(txt)) return 'https://nomisma.org/id/av';
        if (/\b(bronze|\bae\b)\b/.test(txt)) return 'https://nomisma.org/id/ae';
        if (/\b(electrum|\bel\b)\b/.test(txt)) return 'https://nomisma.org/id/el';
        if (/\b(billon|\bbi\b)\b/.test(txt)) return 'https://nomisma.org/id/bi';
        if (/\b(copper|\bcu\b)\b/.test(txt)) return 'https://nomisma.org/id/cu';
        return null;
    }

    // Build JSON-LD graph for the chosen scope and download
    exportCollectionJsonLd({ scope = 'all' } = {}) {
        const coins = this._getCoinsForScope(scope);
        if (scope === 'selection' && coins.length === 0) {
            alert('Select at least one coin to export.');
            return;
        }
        try {
            const context = {
                rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
                nmo: 'http://nomisma.org/ontology#',
                dcterms: 'http://purl.org/dc/terms/',
                foaf: 'http://xmlns.com/foaf/0.1/',
                skos: 'http://www.w3.org/2004/02/skos/core#',
                xsd: 'http://www.w3.org/2001/XMLSchema#'
            };
            const graph = [];
            const toDec = (v) => {
                if (v == null || v === '') return null;
                const n = parseFloat(String(v).toString().replace(/[^0-9.\-]/g, ''));
                return isNaN(n) ? null : n;
            };
            const mapMaterialToNomisma = (mat) => {
                // Accept {code,label} or string; return Nomisma material URI or null
                const code = (typeof mat === 'object' && mat && mat.code) ? String(mat.code).toUpperCase() : null;
                const label = (typeof mat === 'object' && mat && mat.label) ? String(mat.label) : (typeof mat === 'string' ? mat : '');
                const txt = (label || '').toLowerCase().trim();
                // Code-based canonical URIs (lowercased code path per user feedback)
                const byCode = {
                    AR: 'https://nomisma.org/id/ar',
                    AV: 'https://nomisma.org/id/av',
                    AE: 'https://nomisma.org/id/ae',
                    EL: 'https://nomisma.org/id/el',
                    BI: 'https://nomisma.org/id/bi',
                    CU: 'https://nomisma.org/id/cu'
                };
                if (code && byCode[code]) return byCode[code];
                if (!txt) return null;
                // Text inference -> code URIs
                if (/\b(silver|argent|\bar\b)\b/.test(txt)) return 'https://nomisma.org/id/ar';
                if (/\b(gold|aurum|\bav\b)\b/.test(txt)) return 'https://nomisma.org/id/av';
                if (/\b(bronze|\bae\b)\b/.test(txt)) return 'https://nomisma.org/id/ae';
                if (/\b(electrum|\bel\b)\b/.test(txt)) return 'https://nomisma.org/id/el';
                if (/\b(billon|\bbi\b)\b/.test(txt)) return 'https://nomisma.org/id/bi';
                if (/\b(copper|\bcu\b)\b/.test(txt)) return 'https://nomisma.org/id/cu';
                return null;
            };
            const extractTypeSeriesUris = (coin) => {
                const out = new Set();
                const addIf = (s) => {
                    if (!s) return;
                    const re = /https?:\/\/numismatics\.org\/ocre\/[^\s\]\)"']+/gi;
                    let m;
                    while ((m = re.exec(s)) !== null) {
                        out.add(m[0]);
                    }
                    // Detect CRRO (Roman Republican) IDs
                    const reCrro = /https?:\/\/numismatics\.org\/crro\/[^\s\]\)"']+/gi;
                    while ((m = reCrro.exec(s)) !== null) {
                        out.add(m[0]);
                    }
                    // Detect Greek/other ANS series IDs (PELLA / SCO / PCO)
                    const rePella = /https?:\/\/numismatics\.org\/pella\/id\/[^\s,;\)\]]+/gi;
                    while ((m = rePella.exec(s)) !== null) { out.add(m[0]); }
                    const reSco = /https?:\/\/numismatics\.org\/sco\/id\/[^\s,;\)\]]+/gi;
                    while ((m = reSco.exec(s)) !== null) { out.add(m[0]); }
                    const rePcoId = /https?:\/\/numismatics\.org\/pco\/id\/[^\s,;\)\]]+/gi;
                    while ((m = rePcoId.exec(s)) !== null) { out.add(m[0]); }
                    // Pattern-based inference for Crawford numbers (RRC/Crawford 1234)
                    const crawfordRe = /\b(?:RRC|Crawford)\s*(\d{1,4})([ABab]?)/g;
                    while ((m = crawfordRe.exec(s)) !== null) {
                        const num = m[1];
                        out.add(`https://numismatics.org/crro/id/rrc-${num}`);
                    }
                };
                // Include structured formatted references too
                const structured = Array.isArray(coin.referencesStructured)? coin.referencesStructured.map(r=> r.formatted).join('; ') : '';
                addIf(structured);
                addIf(coin.references);
                // Future: inspect other fields (external_ids) for explicit type URIs
                if (Array.isArray(coin.typeSeriesUris)) coin.typeSeriesUris.forEach(u=> out.add(u));
                return Array.from(out);
            };
            for (const coin of coins) {
                const coinId = `urn:coinflip:coin:${coin.id}`;
                const node = { '@id': coinId, '@type': ['nmo:NumismaticObject'] };
                if (coin.name) node['dcterms:title'] = [{ '@value': String(coin.name) }];
                node['dcterms:identifier'] = [{ '@value': String(coin.id) }];
                const w = toDec(coin.weight);
                if (w != null) node['nmo:hasWeight'] = [{ '@value': String(w), '@type': 'xsd:decimal' }];
                const d = toDec(coin.diameter);
                if (d != null) node['nmo:hasDiameter'] = [{ '@value': String(d), '@type': 'xsd:decimal' }];
                // Material mapping to Nomisma
                const matUri = mapMaterialToNomisma(coin.material);
                if (matUri) node['nmo:hasMaterial'] = [{ '@id': matUri }];
                // Authority/Mint from Nomisma when linked
                if (coin.ruler && typeof coin.ruler === 'object' && coin.ruler.nomisma_uri) {
                    node['nmo:hasAuthority'] = [{ '@id': this._normalizeNomismaUrl(coin.ruler.nomisma_uri) }];
                }
                if (coin.origin && typeof coin.origin === 'object' && coin.origin.nomisma_uri) {
                    node['nmo:hasMint'] = [{ '@id': this._normalizeNomismaUrl(coin.origin.nomisma_uri) }];
                }
                // Period (Nomisma) if linked
                if (coin.period && typeof coin.period === 'object' && coin.period.nomisma_uri) {
                    node['nmo:hasPeriod'] = [{ '@id': this._normalizeNomismaUrl(coin.period.nomisma_uri) }];
                }
                // Struck date label from exact years and optional note
                const sExact = coin.struck_date?.exact || null;
                const sNote = coin.struck_date?.note || '';
                const dateText = [sNote, this._formatDateRange(sExact)].filter(Boolean).join(' ').trim();
                if (dateText) node['dcterms:temporal'] = [{ '@value': dateText }];
                // Type series items (e.g., OCRE URIs) if present in references
                const typeUris = extractTypeSeriesUris(coin);
                if (typeUris.length) {
                    node['nmo:hasTypeSeriesItem'] = typeUris.map(u => ({ '@id': u }));
                }
                // Obverse/Reverse images
                const img0 = this._getCoinFace(coin, 'obv');
                const img1 = this._getCoinFace(coin, 'rev');
                if (img0) {
                    const obvId = `${coinId}#obverse`;
                    node['nmo:hasObverse'] = [{ '@id': obvId }];
                    graph.push({ '@id': obvId, 'foaf:depiction': [{ '@id': img0 }] });
                }
                if (img1 && img1 !== img0) {
                    const revId = `${coinId}#reverse`;
                    node['nmo:hasReverse'] = [{ '@id': revId }];
                    graph.push({ '@id': revId, 'foaf:depiction': [{ '@id': img1 }] });
                }
                // Description, references
                if (coin.description) node['dcterms:description'] = [{ '@value': String(coin.description) }];
                // Emit structured references first, then free-text as notes
                const bibs = [];
                if (Array.isArray(coin.referencesStructured) && coin.referencesStructured.length) {
                    coin.referencesStructured.forEach(r => { const f = r && r.formatted; if (f) bibs.push({ '@value': String(f) }); });
                }
                if (coin.references) bibs.push({ '@value': String(coin.references) });
                if (bibs.length) node['dcterms:bibliographicCitation'] = bibs;
                graph.push(node);
            }
            const payload = { '@context': context, '@graph': graph };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/ld+json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `coin-collection-${new Date().toISOString().slice(0,10)}.jsonld`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Export JSON-LD failed:', err);
            alert('Failed to export JSON-LD. See console for details.');
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
    // Struck date exact range + note
    const ex = coin.struck_date?.exact || null;
        const sy = document.getElementById('dateStartYear');
        const se = document.getElementById('dateStartEra');
        const ey = document.getElementById('dateEndYear');
        const ee = document.getElementById('dateEndEra');
        const approx = document.getElementById('dateApprox');
        if (sy) sy.value = ex?.from?.year || '';
        if (se) se.value = ex?.from?.era || 'CE';
        if (ey) ey.value = ex?.to?.year || '';
        if (ee) ee.value = ex?.to?.era || 'CE';
        if (approx) approx.checked = !!ex?.approx;
        if (approx && approx.checked && ey) ey.value='';
    const struckNoteEl = document.getElementById('struckDateFree');
    if (struckNoteEl) struckNoteEl.value = coin.struck_date?.note || '';
    // Period field (manual URL)
    const periodInput = document.getElementById('coinPeriod');
    if (periodInput) {
        const url = coin.period && typeof coin.period === 'object' ? (coin.period.nomisma_uri || '') : '';
        periodInput.value = url || '';
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
        const otherRef = document.getElementById('otherReferenceNote'); if (otherRef) otherRef.value = coin.references || '';
        this._draftStructuredRefs = Array.isArray(coin.referencesStructured) ? coin.referencesStructured.map(r=> ({...r})) : [];
        this._renderStructuredRefsList();
        // Restore chips if structured selections exist
        const originChip = document.getElementById('originChip');
        const originInput = document.getElementById('coinOrigin');
        if (coin.origin && typeof coin.origin === 'object' && originChip && originInput) {
            if (coin.origin.nomisma_uri) {
                originInput.dataset.nomismaUri = coin.origin.nomisma_uri;
                originInput.dataset.nomismaQid = coin.origin.wikidata_qid || '';
                originInput.dataset.nomismaLabel = coin.origin.label || '';
                originChip.innerHTML = this._renderChip(coin.origin.label || '', coin.origin.nomisma_uri);
            } else if (coin.origin.label) {
                // label-only chip
                originInput.dataset.nomismaLabel = coin.origin.label;
                originChip.innerHTML = `<span class="chip">${this.escapeHtml(coin.origin.label)}<button type="button" class="chip-remove" title="Remove link">×</button></span>`;
            }
        }
        const rulerChip = document.getElementById('rulerChip');
        const rulerInput = document.getElementById('coinRuler');
        if (coin.ruler && typeof coin.ruler === 'object' && rulerChip && rulerInput) {
            if (coin.ruler.nomisma_uri) {
                rulerInput.dataset.nomismaUri = coin.ruler.nomisma_uri;
                rulerInput.dataset.nomismaQid = coin.ruler.wikidata_qid || '';
                rulerInput.dataset.nomismaLabel = coin.ruler.label || '';
                rulerChip.innerHTML = this._renderChip(coin.ruler.label || '', coin.ruler.nomisma_uri);
            } else if (coin.ruler.label) {
                rulerInput.dataset.nomismaLabel = coin.ruler.label;
                rulerChip.innerHTML = `<span class="chip">${this.escapeHtml(coin.ruler.label)}<button type="button" class="chip-remove" title="Remove link">×</button></span>`;
            }
        }
        // Legacy period/date chip block removed (now using coin.period populated earlier)
        // Enrichment toggles (consolidated)
    // Enrichment toggles removed; enrichment now automatic based on linked fields.
        document.getElementById('coinObverse').value = coin.obverse || '';
        document.getElementById('coinReverse').value = coin.reverse || '';
        const extObvInput = document.getElementById('externalObvUrl'); if (extObvInput) extObvInput.value = coin.externalImageUrlObv || '';
        const extRevInput = document.getElementById('externalRevUrl'); if (extRevInput) extRevInput.value = coin.externalImageUrlRev || '';
        // Initialize image draft list from existing images, preserving first=obv, second=rev
        try {
            const imagesArr = Array.isArray(coin.images)? coin.images : [];
            const storedObv = coin.imageFaces?.obv || null;
            const storedRev = coin.imageFaces?.rev || null;
            this._draftImages = imagesArr.map((url) => {
                let role = null;
                if (storedObv && url === storedObv) role = 'obv';
                else if (storedRev && url === storedRev) role = 'rev';
                return { url, role };
            });
            this._normalizeDraftImageRoles(this._draftImages);
            this._renderImageDraftList();
        } catch(_) { this._draftImages = []; this._renderImageDraftList(); }
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
        const approx = document.getElementById('dateApprox'); if (approx) approx.checked = false;
        // Clear period URL
    const periodInput = document.getElementById('coinPeriod'); if (periodInput) { periodInput.value=''; }
    const struckNoteEl = document.getElementById('struckDateFree'); if (struckNoteEl) struckNoteEl.value='';
        // Clear origin/ruler chips & datasets
        const origin = document.getElementById('coinOrigin'); if (origin) { delete origin.dataset.nomismaUri; delete origin.dataset.nomismaQid; delete origin.dataset.nomismaLabel; }
        const originChip = document.getElementById('originChip'); if (originChip) originChip.innerHTML='';
        const ruler = document.getElementById('coinRuler'); if (ruler) { delete ruler.dataset.nomismaUri; delete ruler.dataset.nomismaQid; delete ruler.dataset.nomismaLabel; }
        const rulerChip = document.getElementById('rulerChip'); if (rulerChip) rulerChip.innerHTML='';
        // Clear material selection and chip
        const matSel = document.getElementById('coinMaterialSelect'); if (matSel) matSel.value='';
        const matOther = document.getElementById('coinMaterialOther'); if (matOther) { matOther.value=''; matOther.style.display='none'; }
        const matInfo = document.getElementById('materialLinkInfo'); if (matInfo) matInfo.innerHTML='';
        const extObvInput = document.getElementById('externalObvUrl'); if (extObvInput) extObvInput.value='';
        const extRevInput = document.getElementById('externalRevUrl'); if (extRevInput) extRevInput.value='';
        // Clear reference menu any leftover
        const refMenu = document.getElementById('refSearchMenu'); if (refMenu) refMenu.style.display='none';
        this._editingRefIndex = -1;
        this._draftStructuredRefs = [];
        const listHost = document.getElementById('structuredRefsList'); if (listHost) listHost.innerHTML='';
        const formRef = document.getElementById('structuredRefForm'); if (formRef) formRef.classList.add('hidden');
        // Clear image drafts
        this._draftImages = [];
        const imgHost = document.getElementById('imageDraftList'); if (imgHost) imgHost.innerHTML='';
    }

    openAddCoinForm() {
        this.resetFormToAddMode();
        const form = document.getElementById('addCoinForm');
        if (form) {
            form.classList.remove('hidden');
            this._initReferenceUI();
            try { form.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
        }
    }

    // Export coins to a downloadable JSON file
    exportCollection({ scope = 'all' } = {}) {
        const coins = this._getCoinsForScope(scope);
        if (scope === 'selection' && coins.length === 0) {
            alert('Select at least one coin to export.');
            return;
        }
        try {
            const payload = {
                version: 1,
                exportedAt: new Date().toISOString(),
                count: coins.length,
                coins
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
            // Normalize while preserving structured fields when present
            const normalized = coins.map(c => {
                const id = c.id || Date.now() + Math.floor(Math.random()*100000);
                const origin = (c.origin && typeof c.origin === 'object') ? c.origin : (c.origin || '');
                const ruler = (c.ruler && typeof c.ruler === 'object') ? c.ruler : (c.ruler || '');
                const material = (c.material && typeof c.material === 'object') ? c.material : (c.material || '');
                const referencesStructured = Array.isArray(c.referencesStructured) ? c.referencesStructured.map(r => {
                    const r2 = { ...r };
                    if (!r2.formatted) r2.formatted = this._formatStructuredRef(r2);
                    return r2;
                }) : [];
                const node = {
                    id,
                    name: c.name || 'Untitled',
                    // Legacy date retained for post-normalization migration
                    date: (typeof c.date === 'object' && c.date) ? c.date : (c.date || ''),
                    struck_date: c.struck_date || null,
                    period: (c.period && typeof c.period === 'object') ? c.period : null,
                    origin,
                    ruler,
                    material,
                    weight: c.weight || '',
                    diameter: c.diameter || '',
                    description: c.description || '',
                    references: c.references || '',
                    referencesStructured,
                    externalImageUrlObv: typeof c.externalImageUrlObv === 'string' ? c.externalImageUrlObv : null,
                    externalImageUrlRev: typeof c.externalImageUrlRev === 'string' ? c.externalImageUrlRev : null,
                    obverse: c.obverse || '',
                    reverse: c.reverse || '',
                    images: Array.isArray(c.images) ? c.images : [],
                    model3D: (c.model3D && c.model3D.assetId) ? c.model3D : null,
                    addedDate: c.addedDate || new Date().toISOString(),
                    external_ids: c.external_ids ? {
                        nomisma: c.external_ids.nomisma || null,
                        wikidata: c.external_ids.wikidata || null,
                        searchUrls: c.external_ids.searchUrls || null
                    } : { nomisma: null, wikidata: null, searchUrls: null },
                    facts_snapshot: c.facts_snapshot || null,
                    enrichment_status: c.enrichment_status || 'idle',
                    enrichment_fetched_at: c.enrichment_fetched_at || null,
                    typeSeriesUris: Array.isArray(c.typeSeriesUris) ? c.typeSeriesUris.slice() : []
                };
                return node;
            });
            this.coins = normalized;
            this.selectedForPrint.clear();
            // Run migrations: legacy dates -> struck_date, ensure formatted refs, recompute type-series from combined refs
            try { this._migrateLegacyDates(); } catch(_) {}
            try { this._migrateReferences(); } catch(_) {}
            this.saveCoins();
            this.renderCoins();
            alert('Import completed. Structured references preserved, and type-series links recomputed. 3D model binaries are not included in JSON and may need re-upload.');
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
    const periodText = document.getElementById('coinPeriod').value;
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
        const referencesFree = (document.getElementById('otherReferenceNote')?.value) || '';
        const obverse = document.getElementById('coinObverse').value;
        const reverse = document.getElementById('coinReverse').value;
        const externalObvRaw = (document.getElementById('externalObvUrl')?.value || '').trim();
        const externalRevRaw = (document.getElementById('externalRevUrl')?.value || '').trim();
        const externalObvUrl = this._normalizeExternalImageUrl(externalObvRaw);
        const externalRevUrl = this._normalizeExternalImageUrl(externalRevRaw);
        if (externalObvRaw && !externalObvUrl) {
            alert('Obverse external image URL must be an https:// link or a relative path such as /coin-images/obv.jpg.');
            return;
        }
        if (externalRevRaw && !externalRevUrl) {
            alert('Reverse external image URL must be an https:// link or a relative path such as /coin-images/rev.jpg.');
            return;
        }

        const imageFiles = document.getElementById('coinImages').files;
        const modelFile = document.getElementById('coin3DModel').files[0];
    const nomismaId = (document.getElementById('coinNomismaId')?.value || '').trim() || null;
    // Enrichment options removed; always enrich linked fields automatically.

        if (isEdit) {
            const coin = this.coins.find(c => c.id === this.editingCoinId);
            if (!coin) { alert('Could not find coin to edit.'); return; }
            coin.name = name;
            // Split fields: struck_date (manual) + period (Nomisma URL)
            coin.struck_date = { exact: this._readExactDateRange(), note: (document.getElementById('struckDateFree')?.value || '').trim() || null };
            coin.period = this._readPeriodUrlFromInput();
            coin.origin = this._readScopedSelection('origin', origin);
            coin.ruler = this._readScopedSelection('ruler', ruler);
            coin.material = material;
            coin.weight = weight;
            coin.diameter = diameter;
            coin.description = description;
            coin.references = referencesFree;
            coin.referencesStructured = Array.isArray(this._draftStructuredRefs) ? this._draftStructuredRefs.map(r=> ({...r, formatted: this._formatStructuredRef(r)})) : [];
            coin.typeSeriesUris = this._extractTypeSeriesFromReferences(this._structuredRefsCombinedForExtraction(coin));
            coin.external_ids = coin.external_ids || { nomisma: null, wikidata: null, searchUrls: null };
            coin.external_ids.nomisma = nomismaId || coin.external_ids.nomisma || null;
            // enrichment_opts removed
            coin.obverse = obverse;
            coin.reverse = reverse;

            // Apply draft images ordering/roles if present (even empty array -> delete all)
            try {
                if (Array.isArray(this._draftImages)) {
                    const ordered = [];
                    const obv = this._draftImages.find(x=> x.role==='obv'); if (obv) ordered.push(obv.url);
                    const rev = this._draftImages.find(x=> x.role==='rev'); if (rev) ordered.push(rev.url);
                    this._draftImages.forEach(x=>{ if (x.role!=='obv' && x.role!=='rev') ordered.push(x.url); });
                    coin.images = ordered;
                    this._updateCoinImageFaces(coin, this._draftImages);
                }
            } catch(_){}

            this._applyExternalImageOverrides(coin, { obvUrl: externalObvUrl, revUrl: externalRevUrl });
            if (!externalObvUrl && !externalRevUrl) {
                this._updateCoinImageFaces(coin, Array.isArray(this._draftImages) ? this._draftImages : null);
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
                if (err && err.message === 'LOCALSTORAGE_QUOTA' && imageFiles && imageFiles.length > 0) {
                    // Retry with stronger compression
                    try {
                        const prevImages = Array.isArray(coin.images) ? coin.images.slice() : [];
                        coin.images = [];
                        for (let file of imageFiles) {
                            const base64 = await this.compressImage(file, { maxDim: 1200, quality: 0.75 });
                            if (base64) coin.images.push(base64);
                        }
                        this._updateCoinImageFaces(coin);
                        this.saveCoins();
                        this.renderCoins();
                        coin.enrichment_status = 'stale';
                        try { await this.enrichCoin(coin.id, { force: true, linksOnly: false }); } catch (_) {}
                        this.resetFormToAddMode();
                        return;
                    } catch (e2) {
                        // Rollback images to previous state and clear file input
                        // No safe rollback possible; keep previous images if available
                        const imgInput = document.getElementById('coinImages'); if (imgInput) imgInput.value = '';
                        alert('Not enough browser storage to update this coin even after compression. Remove or reduce images and try again.');
                        return;
                    }
                } else if (err && err.message === 'LOCALSTORAGE_QUOTA') {
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
            struck_date: { exact: this._readExactDateRange(), note: (document.getElementById('struckDateFree')?.value || '').trim() || null },
            period: this._readPeriodUrlFromInput(),
            origin: this._readScopedSelection('origin', origin),
            ruler: this._readScopedSelection('ruler', ruler),
            material, weight, diameter, description, references: referencesFree, obverse, reverse,
            images: [],
            imageFaces: { obv: null, rev: null },
            model3D: null,
            addedDate: new Date().toISOString(),
            // Enrichment defaults
            external_ids: { nomisma: nomismaId, wikidata: null, searchUrls: null },
            facts_snapshot: null,
            enrichment_status: 'stale',
            enrichment_fetched_at: null,
            // enrichment_opts removed
            referencesStructured: Array.isArray(this._draftStructuredRefs) ? this._draftStructuredRefs.map(r=> ({...r, formatted: this._formatStructuredRef(r)})) : [],
            typeSeriesUris: this._extractTypeSeriesFromReferences(this._structuredRefsCombinedForExtraction({ referencesStructured: this._draftStructuredRefs, references: referencesFree }))
        };

        // Process images (respect draft ordering if present)
        if (Array.isArray(this._draftImages) && this._draftImages.length) {
            const ordered = [];
            const obv = this._draftImages.find(x=> x.role==='obv'); if (obv) ordered.push(obv.url);
            const rev = this._draftImages.find(x=> x.role==='rev'); if (rev) ordered.push(rev.url);
            this._draftImages.forEach(x=>{ if (x.role!=='obv' && x.role!=='rev') ordered.push(x.url); });
            coin.images = ordered;
            this._updateCoinImageFaces(coin, this._draftImages);
        } else {
            for (let file of imageFiles) {
                const base64 = await this.compressImage(file, { maxDim: 1600, quality: 0.85 });
                if (base64) coin.images.push(base64);
            }
            this._updateCoinImageFaces(coin);
        }

        this._applyExternalImageOverrides(coin, { obvUrl: externalObvUrl, revUrl: externalRevUrl });
        if (!externalObvUrl && !externalRevUrl) {
            this._updateCoinImageFaces(coin, Array.isArray(this._draftImages) ? this._draftImages : null);
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
            if (err && err.message === 'LOCALSTORAGE_QUOTA' && imageFiles && imageFiles.length > 0) {
                // Retry with stronger compression
                try {
                    // Remove previously pushed coin if any
                    this.coins = this.coins.filter(c => c.id !== coin.id);
                    coin.images = [];
                    for (let file of imageFiles) {
                        const base64 = await this.compressImage(file, { maxDim: 1200, quality: 0.75 });
                        if (base64) coin.images.push(base64);
                    }
                    this._updateCoinImageFaces(coin);
                    this.coins.push(coin);
                    this.saveCoins();
                    this.renderCoins();
                    try { await this.enrichCoin(coin.id, { force: true, linksOnly: false }); } catch (_) {}
                } catch (e2) {
                    // Ensure coin not left inserted and clear file input
                    this.coins = this.coins.filter(c => c.id !== coin.id);
                    const imgInput = document.getElementById('coinImages'); if (imgInput) imgInput.value = '';
                    alert('Not enough browser storage even after compression. Please reduce image sizes or remove some items and try again.');
                    return;
                }
            } else if (err && err.message === 'LOCALSTORAGE_QUOTA') {
                // Remove previously pushed coin and clear input
                this.coins = this.coins.filter(c => c.id !== coin.id);
                const imgInput = document.getElementById('coinImages'); if (imgInput) imgInput.value = '';
                alert('Not enough browser storage to save this coin. Please reduce image sizes or remove some items and try again.');
                return;
            } else {
                console.error('Failed to add coin:', err);
                alert('Failed to add coin. See console for details.');
                return;
            }
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
            // No fallback probing – strict Nomisma SPARQL only
            // No authority fallback
            // Build manual "Use as plain text" option when there's a term
            const manual = term ? [{ id: '', label: term, labelOnly: true, isPlain: true }] : [];
            const itemsForContext = items && items.length ? items : [];
            const displayItems = (items && items.length) ? [...manual, ...items] : (manual.length ? manual : []);
            if (displayItems.length === 0) {
                suggest.innerHTML = '<div class="suggest-items"><div class="suggest-item"><span class="s-label">No suggestions</span></div></div>';
                return;
            }
            // Mark first item as primary for period suggestions (exclude manual-only case)
            suggest.innerHTML = `<div class=\"suggest-items\">${displayItems.map((it,idx)=>{
                const primaryClass = '';
                const baseLabelEsc = this.escapeHtml(it.label);
                const typeBadge = (!it.isPlain && it.conceptType) ? `<span class=\"s-type\">${this.escapeHtml(it.conceptType)}</span>` : '';
                const labelText = it.isPlain ? `Use as plain text: \u201C${baseLabelEsc}\u201D` : `${baseLabelEsc} ${typeBadge}`;
                const dataLabel = baseLabelEsc;
                const dataUri = it.id || '';
                const dataQid = it.qid || '';
                const dataType = it.conceptType || '';
                const labelOnly = it.labelOnly ? '1' : '0';
                const idHtml = it.labelOnly ? '' : `<span class=\"s-id\">${this.escapeHtml(it.id)}</span>`;
                return `<div class=\"suggest-item ${primaryClass}\" data-uri=\"${dataUri}\" data-qid=\"${dataQid}\" data-label-only=\"${labelOnly}\" data-label=\"${dataLabel}\" data-concept-type=\"${this.escapeHtml(dataType)}\">` + `<span class=\"s-label\">${labelText}</span>` + `${idHtml}` + `</div>`;
            }).join('')}</div>`;
            suggest.querySelectorAll('.suggest-item').forEach(el=>{
                el.addEventListener('click', async ()=>{
                    const uri = el.getAttribute('data-uri');
                    const qid = el.getAttribute('data-qid') || null;
                    const dataLabel = el.getAttribute('data-label');
                    const label = dataLabel || (el.querySelector('.s-label')?.textContent || '');
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
                });
            });
        };
        btn.addEventListener('click', search);
        input.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); search(); }});
        // Clear chip if user edits value
        input.addEventListener('input', ()=>{ delete input.dataset.nomismaUri; delete input.dataset.nomismaQid; delete input.dataset.nomismaLabel; chipWrap.innerHTML=''; });
    }

    _renderChip(label, uri){
        if (!uri) {
            return `<span class="chip">${this.escapeHtml(label)}<button type="button" class="chip-remove" title="Remove link">×</button></span>`;
        }
        return `<span class="chip">${this.escapeHtml(label)}<a class="chip-link" href="${this.escapeHtml(uri)}" target="_blank" aria-label="Open Nomisma" title="Open on nomisma.org">🔗</a><button type="button" class="chip-remove" title="Remove link">×</button></span>`;
    }

    _readScopedSelection(field, fallbackText){
        const el = document.getElementById(field==='origin'?'coinOrigin':field==='ruler'?'coinRuler':'coinPeriod');
        if (field !== 'period' && el && el.dataset.nomismaUri) {
            const base = { label: el.dataset.nomismaLabel || el.value, nomisma_uri: el.dataset.nomismaUri, wikidata_qid: el.dataset.nomismaQid || null };
            return base;
        }
        // Label-only chip for non-period fields
        if (field !== 'period' && el && el.dataset.nomismaLabel && !el.dataset.nomismaUri) {
            return { label: el.dataset.nomismaLabel, nomisma_uri: null, wikidata_qid: null };
        }
        return fallbackText; // free text preserved
    }

    // Read period as a manual Nomisma URL (no lookup). Returns { nomisma_uri } or null.
    _readPeriodUrlFromInput(){
        const el = document.getElementById('coinPeriod');
        if (!el) return null;
        const raw = String(el.value || '').trim();
        if (!raw) return null;
        const url = this._normalizeNomismaUrl(raw);
        if (!url) return null;
        return { label: null, nomisma_uri: url, wikidata_qid: null };
    }

    _readExactDateRange(){
        const sy = document.getElementById('dateStartYear');
        const se = document.getElementById('dateStartEra');
        const ey = document.getElementById('dateEndYear');
        const ee = document.getElementById('dateEndEra');
        const approx = document.getElementById('dateApprox');
        const startYear = sy && sy.value ? parseInt(sy.value, 10) : null;
        const startEra = se ? (se.value || 'CE') : 'CE';
        const endYear = (approx && approx.checked) ? null : (ey && ey.value ? parseInt(ey.value, 10) : null);
        const endEra = ee ? (ee.value || 'CE') : 'CE';
        if (!startYear && !endYear) return null;
        const norm = (y, era) => ({ year: (y && !isNaN(y)) ? y : null, era: (era === 'BCE' ? 'BCE' : 'CE') });
        const obj = { from: norm(startYear, startEra), to: norm(endYear, endEra) };
        if (approx && approx.checked) obj.approx = true;
        return obj;
    }

    _formatDateRange(exact){
        if (!exact || (!exact.from?.year && !exact.to?.year)) return '';
        const fmt = ({year, era}) => year ? `${year} ${era}` : '';
        const a = fmt(exact.from||{});
        const b = fmt(exact.to||{});
        const prefix = exact.approx ? 'c. ' : '';
        if (a && b) return `${prefix}${a} – ${b}`;
        return `${prefix}${a || b}`;
    }

    // Period context UI removed (period is manual URL)

    // Typed Nomisma search (prefLabel/altLabel) with explicit type filtering; strict, no fallbacks
    async searchNomismaByType(term, types, opts = {}){
        const cleaned = String(term || '').trim();
        if (!cleaned) return [];
        // In-memory TTL cache (20s) to avoid repeated SPARQL latency for the same term/type set
        try {
            const cacheKey = `s:${types.join(',')}::${cleaned.toLowerCase()}`;
            const hit = this._searchCache[cacheKey];
            if (hit && hit.expires > Date.now()) return hit.results;
        } catch(_){}

        // Period fast-path removed; period is manual URL now
        const norm = (s)=> s.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        // Build simplified query (prefLabel only first, altLabel pass second) for a given search string
        const buildQuery = (searchStr, useAlt=false, loosenType=false) => {
            // Prefixes reduce size and maybe avoid 406
            const prefixes = `PREFIX skos: <http://www.w3.org/2004/02/skos/core#>\nPREFIX nm: <http://nomisma.org/ontology#>\nPREFIX foaf: <http://xmlns.com/foaf/0.1/>`;
            const iriMap = {
                // Narrow "place" to mints to reduce complexity and avoid blocked clauses
                place: ['nm:Mint'],
                mint: ['nm:Mint'],
                person: ['foaf:Person'],
                authority: ['nm:Authority','foaf:Person'],
                period: ['nm:Period']
            };
            const iris = Array.from(new Set(types.flatMap(t=> iriMap[t] || [])));
            const valuesClause = (!loosenType && iris.length) ? `VALUES ?type { ${iris.join(' ')} }` : '';
            const labelPattern = useAlt ? 'skos:altLabel' : 'skos:prefLabel';
            const typeTriple = loosenType ? 'OPTIONAL { ?id a ?type . }' : '?id a ?type .';
            // When loosening (period only), skip LANG() exact filter – some period labels may lack language tag
            const langFilter = loosenType ? '' : "FILTER(LANG(?label)='en')";
            const safeTerm = norm(searchStr);
            return `${prefixes}\nSELECT DISTINCT ?id ?label ?type WHERE { ${valuesClause} ${typeTriple} ?id ${labelPattern} ?label ${langFilter} FILTER(CONTAINS(LCASE(?label), LCASE('${safeTerm}'))) FILTER(STRSTARTS(STR(?id),'http://nomisma.org/id/') || STRSTARTS(STR(?id),'https://nomisma.org/id/')) } LIMIT 12`;
        };
        const isPeriodOnly = false;
        // Expand search terms heuristically for period only (rome->roman, roman empire, roman republic; greece->greek, classical greece)
        const termVariants = (()=>{
            const base = [cleaned];
            if (!isPeriodOnly) return base;
            const t = cleaned.toLowerCase();
            const add = (s)=>{ if (s && !base.some(x=> x.toLowerCase()===s.toLowerCase())) base.push(s); };
            if (/\brome\b/.test(t)) { add('roman'); add('roman empire'); add('roman republic'); }
            if (/\broman\b/.test(t)) { add('roman empire'); add('roman republic'); }
            if (/\bgreece\b/.test(t)) { add('greek'); add('classical greece'); add('hellenistic'); }
            if (/\bgreek\b/.test(t)) { add('greece'); add('classical greece'); }
            return base.slice(0,5); // cap expansions
        })();
        const queries = [];
        for (const tv of termVariants){
            queries.push(buildQuery(tv, false, false));
            queries.push(buildQuery(tv, true, false));
            // no period-only loosen variants
        }

        // Attempts: focus on GET /query then /sparql
        const attemptDefs = [];
        const basesGet = ['https://nomisma.org/query','http://nomisma.org/query','https://nomisma.org/sparql','http://nomisma.org/sparql'];
        const getFormats = ['application%2Fsparql-results%2Bjson']; // drop 'json' pseudo format to reduce redirects
        const getAccepts = ['application/sparql-results+json'];
        for (const q of queries){
            for (const b of basesGet){ for (const fmt of getFormats){ for (const acc of getAccepts){ attemptDefs.push({ method:'GET', base:b, q, fmt, acc }); } } }
        }
        let rows = [];
        let periodRows = [];
        for (const att of attemptDefs){
            try {
                let res;
                if (att.method==='GET'){
                    const url = `${att.base}?query=${encodeURIComponent(att.q)}&format=${att.fmt}`;
                    const headers = { Accept: att.acc };
                    res = await this._fetchWithTimeout(url, { timeout: 12000, init:{ headers } });
                } else {
                    const headers = { 'Content-Type': att.pt.ct, Accept:'application/sparql-results+json, application/json;q=0.9, */*;q=0.1' };
                    const body = att.pt.body(att.q);
                    res = await this._fetchWithTimeout(att.base, { timeout: 12000, init:{ method:'POST', headers, body } });
                }
                if (!res.ok){ console.debug('Nomisma search HTTP', res.status, att.method, att.base); continue; }
                const ctype = res.headers.get('content-type') || '';
                const textRaw = await res.text();
                if (!/json/i.test(ctype) && !textRaw.trim().startsWith('{')){
                    // HTML homepage or error -> skip
                    console.debug('Nomisma non-JSON response', att.method, att.base, ctype, textRaw.slice(0,120));
                    continue;
                }
                let data; try { data = JSON.parse(textRaw); } catch(parseErr){ console.debug('Nomisma JSON parse error', parseErr.message); continue; }
                const bindings = data?.results?.bindings || [];
                if (bindings.length){
                    // If we find Period rows and the search is for periods, prioritize and stop
                    if (isPeriodOnly){
                        const pr = bindings.filter(r=> (r.type?.value||'').includes('nomisma.org/ontology#Period'));
                        if (pr.length){ periodRows = pr; break; }
                    }
                    if (!rows.length) rows = bindings; // keep first non-empty for fallback
                }
            } catch(e){ console.debug('Nomisma attempt error', att.method, att.base, e.message); }
        }
    const useRows = periodRows.length ? periodRows : rows;
        if (!useRows.length) return [];
        const typeMap = {
            'http://nomisma.org/ontology#Period':'Period',
            'http://nomisma.org/ontology#Mint':'Mint',
            'http://nomisma.org/ontology#Authority':'Authority',
            'http://xmlns.com/foaf/0.1/Person':'Person'
        };
        // Deduplicate by id; prefer first label (prefLabel query before altLabel) and preserve detected type
        const dedup = new Map();
        for (const r of useRows){
            const id = r.id?.value; if (!id) continue;
            if (!dedup.has(id)){
                const tIri = r.type?.value || null;
                dedup.set(id, { id, label: r.label?.value || id.split('/').pop(), typeIri: tIri, conceptType: typeMap[tIri] || (tIri ? 'Concept' : (isPeriodOnly ? 'Concept' : '')) });
            }
        }
        let items = Array.from(dedup.values());
        // If we found periodRows (isPeriodOnly), restrict to periods; otherwise prioritize periods at the top
        if (isPeriodOnly){
            const periods = items.filter(x=> x.typeIri === 'http://nomisma.org/ontology#Period');
            if (periods.length) items = periods; else {
                // No period concept; keep others but order by Authority/Person before Mint
                const rank = (x)=> x.typeIri==='http://nomisma.org/ontology#Authority'?1 : x.typeIri==='http://xmlns.com/foaf/0.1/Person'?2 : x.typeIri==='http://nomisma.org/ontology#Mint'?3 : 9;
                items.sort((a,b)=> rank(a)-rank(b));
            }
        } else {
            // General search: prefer periods first when mixed
            const rank = (x)=> x.typeIri==='http://nomisma.org/ontology#Period'?0 : x.typeIri==='http://nomisma.org/ontology#Authority'?1 : x.typeIri==='http://xmlns.com/foaf/0.1/Person'?2 : x.typeIri==='http://nomisma.org/ontology#Mint'?3 : 9;
            items.sort((a,b)=> rank(a)-rank(b));
        }
        const enriched = [];
        for (const it of items.slice(0,5)){
            try { const ni = await this._enrichNomisma(it.id); enriched.push({ ...it, qid: ni?.wikidata || null }); }
            catch(_){ enriched.push(it); }
        }
        const finalResults = enriched.concat(items.slice(5));
        try { const cacheKey = `s:${types.join(',')}::${cleaned.toLowerCase()}`; this._searchCache[cacheKey] = { results: finalResults, expires: Date.now() + 20000 }; } catch(_){ }
        return finalResults;
    }

    // Period enumeration helpers removed; period is manual URL now.

    // Nomisma SPARQL search by label/altLabel (broad types wrapper)
    async searchNomisma(term) {
        try {
            const types = ['person','authority','place','mint'];
            return await this.searchNomismaByType(term, types);
        } catch (_) {
            return [];
        }
    }

    // Deprecated fallback helpers removed (probeNomismaIds, authorityFallbackSuggestions)

    _toNomismaSlug(text) {
        if (!text) return '';
        return String(text)
            .trim()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    _candidateNomismaSlugs(text) {
        if (!text) return [];
        const base = String(text).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const lower = base.toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ').replace(/\s+/g, ' ').trim();
        const hyphen = lower.replace(/\s+/g, '-');
        const underscore = lower.replace(/\s+/g, '_');
        const compact = lower.replace(/\s+/g, '');
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
        const ask = 'ASK{}';
        const sparqlEndpoints = ['https://nomisma.org/sparql', 'http://nomisma.org/sparql'];
        for (const base of sparqlEndpoints) {
            try {
                const url = `${base}?query=${encodeURIComponent(ask)}&format=json`;
                const res = await this._fetchWithTimeout(url, { timeout: 10000 });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json().catch(() => null);
                if (data && (typeof data.boolean === 'boolean' || data.results)) { out.sparql.ok = true; break; }
            } catch (e) {
                out.sparql.error = e.message || String(e);
            }
        }
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

        // Delegate compare buttons (coin cards)
        // (Removed legacy card-level Compare button delegation)
    }

    // Compress an image file into a JPEG base64 with max dimension and quality
    async compressImage(file, { maxDim = 1600, quality = 0.85, mime } = {}) {
        try {
            const url = URL.createObjectURL(file);
            const img = await new Promise((res, rej) => {
                const im = new Image();
                im.onload = () => res(im);
                im.onerror = rej;
                im.src = url;
            });
            const { width, height } = img;
            let targetW = width, targetH = height;
            if (width > height) {
                if (width > maxDim) {
                    targetW = maxDim;
                    targetH = Math.round(height * (maxDim / width));
                }
            } else {
                if (height > maxDim) {
                    targetH = maxDim;
                    targetW = Math.round(width * (maxDim / height));
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            // Decide output format: preserve transparency for PNGs; otherwise JPEG
            const isPngInput = /png/i.test(file.type || '');
            const outMime = mime || (isPngInput ? 'image/png' : 'image/jpeg');
            if (outMime === 'image/jpeg') {
                // Fill with neutral grey so transparent areas don't turn black in JPEG
                let bg = '#efefef';
                try {
                    const cssBg = getComputedStyle(document.documentElement).getPropertyValue('--coin-bg').trim();
                    if (cssBg) bg = cssBg;
                } catch(_) {}
                ctx.fillStyle = bg;
                ctx.fillRect(0, 0, targetW, targetH);
            }
            ctx.drawImage(img, 0, 0, targetW, targetH);
            const dataUrl = canvas.toDataURL(outMime, quality);
            URL.revokeObjectURL(url);
            return dataUrl;
        } catch (e) {
            try { return await this.fileToBase64(file); } catch { return null; }
        }
    }

    // Build draft images from selected files (compress + assign default roles obv/rev)
    async _onImageFilesSelected(fileList){
        const files = Array.from(fileList || []);
        if (!files.length) return;
        const drafts = [];
        for (let i=0;i<files.length;i++){
            try {
                const url = await this.compressImage(files[i], { maxDim: 1600, quality: 0.85 });
                if (!url) continue;
                drafts.push({ url, role: null });
            } catch(_){}
        }
        // Preserve existing roles where possible, then fill defaults
        const had = Array.isArray(this._draftImages)? this._draftImages : [];
        // Attempt to keep obv/rev from previous selection by matching data URLs
        const keepRole = (u)=>{
            const m = had.find(x=> x.url===u && (x.role==='obv'||x.role==='rev'));
            return m? m.role : null;
        };
        let hasObv = false, hasRev = false;
        // First pass: keep prior roles
        drafts.forEach(d=>{ const r=keepRole(d.url); if (r){ d.role=r; if (r==='obv') hasObv=true; if (r==='rev') hasRev=true; } });
        // Second pass: assign defaults
        drafts.forEach((d,idx)=>{
            if (!d.role){
                if (!hasObv){ d.role='obv'; hasObv=true; }
                else if (!hasRev){ d.role='rev'; hasRev=true; }
                else { d.role=null; }
            }
        });
        this._draftImages = drafts;
        this._renderImageDraftList();
    }

    _renderImageDraftList(){
        const host = document.getElementById('imageDraftList'); if (!host) return;
        const items = Array.isArray(this._draftImages)? this._draftImages : [];
        if (!items.length){ host.innerHTML = '<em style="font-size:0.8rem;color:#6b7280;">No images selected yet.</em>'; return; }
        host.innerHTML = items.map((it,idx)=>{
            const role = it.role==='obv' ? 'obv' : (it.role==='rev' ? 'rev' : '');
            const badge = role? `<span class="role-badge ${role}">${role==='obv'?'Obverse':'Reverse'}</span>` : '<span class="role-badge">Extra</span>';
            return `
                <div class="image-draft" data-index="${idx}">
                    <img src="${it.url}" alt="coin image ${idx+1}">
                    <div class="img-meta">${badge}<span style="font-size:11px;color:#94a3b8;">${idx+1}</span></div>
                    <div class="img-actions">
                        <button type="button" class="btn-secondary btn-sm" data-act="set-obv">Set Obv</button>
                        <button type="button" class="btn-secondary btn-sm" data-act="set-rev">Set Rev</button>
                        <button type="button" class="btn-secondary btn-sm" data-act="remove">Remove</button>
                    </div>
                </div>`;
        }).join('');
        // Wire item actions
        host.querySelectorAll('.image-draft .btn-secondary').forEach(btn=>{
            btn.addEventListener('click', (e)=>{
                const card = e.target.closest('.image-draft'); if (!card) return;
                const idx = parseInt(card.getAttribute('data-index'),10);
                const act = e.target.getAttribute('data-act');
                if (act==='remove'){ this._removeDraftImage(idx); return; }
                if (act==='set-obv'){ this._setImageRole(idx,'obv'); return; }
                if (act==='set-rev'){ this._setImageRole(idx,'rev'); return; }
            });
        });
    }

    _setImageRole(idx, role){
        if (!Array.isArray(this._draftImages)) return;
        // Clear role from any other
        this._draftImages.forEach((d,i)=>{ if (d.role===role) d.role=null; });
        if (this._draftImages[idx]) this._draftImages[idx].role = role;
        this._renderImageDraftList();
    }

    _removeDraftImage(idx){
        if (!Array.isArray(this._draftImages)) return;
        this._draftImages.splice(idx,1);
        this._renderImageDraftList();
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
            const sExact = coin.struck_date?.exact || null;
            const sNote = coin.struck_date?.note || '';
            const sRange = this._formatDateRange(sExact);
            const pLabel = (typeof coin.period === 'object') ? (coin.period.label || '') : (coin.period || '');
            const date = escape([pLabel, sRange, sNote].filter(Boolean).join(' '));
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
            let refs = escape(this._combinedReferencesText(coin));
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
                    while (descEl.scrollHeight > maxH && fontPx > minPx) {
                        fontPx -= 0.5;
                        descEl.style.fontSize = fontPx + 'px';
                    }
                    if (descEl.scrollHeight > maxH) {
                        descEl.classList.add('fade');
                    }
                }
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
        const activeSort = this._currentSort || 'struck';
        this._sortCoinsInPlace(activeSort);
        const grid = document.getElementById('coinsGrid');
        const emptyState = document.getElementById('emptyState');

        if (this.coins.length === 0) {
            grid.innerHTML = '';
            emptyState.innerHTML = '<p>🪙 Your collection is empty. Add your first coin to get started!</p>';
            emptyState.style.display = 'block';
            this._updateExportScopeState();
            return;
        }

        const visibleCoins = this.coins.filter(coin => this._coinMatchesSearch(coin));
        if (visibleCoins.length === 0) {
            grid.innerHTML = '';
            emptyState.innerHTML = '<p>No coins match your search.</p>';
            emptyState.style.display = 'block';
            this._updateExportScopeState();
            return;
        }

        emptyState.style.display = 'none';
        grid.innerHTML = visibleCoins.map(coin => this.createCoinCard(coin)).join('');
    // (Compare buttons removed)

        // Add event listeners to cards (full-card click and print select only)
        visibleCoins.forEach(coin => {
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
        this._updateExportScopeState();
    }

    _sortCoinsInPlace(sortBy = 'struck'){
        const mode = sortBy || 'struck';
        switch (mode) {
            case 'newest':
                this.coins.sort((a, b) => new Date(b.addedDate) - new Date(a.addedDate));
                break;
            case 'oldest':
                this.coins.sort((a, b) => new Date(a.addedDate) - new Date(b.addedDate));
                break;
            case 'name':
                this.coins.sort((a, b) => (a.name||'').localeCompare(b.name||''));
                break;
            case 'struck':
            default:
                this.coins.sort((a, b) => {
                    const aVal = this._getStruckDateSortValue(a);
                    const bVal = this._getStruckDateSortValue(b);
                    if (aVal !== bVal) return aVal - bVal;
                    return (a.name||'').localeCompare(b.name||'');
                });
                break;
        }
        return mode;
    }

    // Create HTML for a coin card
    createCoinCard(coin) {
    const faces = this._resolveCoinFaces(coin);
    const frontImgEsc = this.escapeHtml(faces.obv || this.PLACEHOLDER_IMAGE || '');
    const backImgEsc = this.escapeHtml(faces.rev || faces.obv || this.PLACEHOLDER_IMAGE || '');
        const checked = this.selectedForPrint.has(coin.id) ? 'checked' : '';
        const selectedCls = this.selectedForPrint.has(coin.id) ? ' selected' : '';
    const dateText = (()=>{ const range=this._formatDateRange(coin.struck_date?.exact); const note=coin.struck_date?.note||''; const periodLabel=(coin.period && typeof coin.period==='object'? (coin.period.label||'') : (coin.period||'')); return [periodLabel, range, note].filter(Boolean).join(' '); })();
        const originText = (coin.origin && typeof coin.origin === 'object') ? (coin.origin?.label || '') : (coin.origin || '');
        const rulerText = (coin.ruler && typeof coin.ruler === 'object') ? (coin.ruler?.label || '') : (coin.ruler || '');
        
        return `
            <div class="coin-card${selectedCls}" data-card-id="${coin.id}">
                <div class="coin-card-images">
                    <div class="coin-3d" aria-hidden="true">
                        <div class="coin-rotator">
                            <img class="coin-face coin-front" src="${frontImgEsc}" alt="${coin.name}">
                            <img class="coin-face coin-back" src="${backImgEsc}" alt="${coin.name} (reverse)">
                        </div>
                    </div>
                    
                    ${coin.model3D ? '<span class="coin-card-badge">3D</span>' : ''}
                </div>
                <div class="coin-card-content">
                    <h3>${coin.name}</h3>
                    <label class="print-select">
                        <input id="select-${coin.id}" type="checkbox" ${checked} /> Select
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

    _getCoinsForScope(scope = 'all') {
        if (scope === 'selection') {
            const hasSelection = this.selectedForPrint && this.selectedForPrint.size > 0;
            if (!hasSelection) return [];
            const selectedIds = new Set(this.selectedForPrint);
            return this.coins.filter(c => selectedIds.has(c.id));
        }
        return this.coins.slice();
    }

    _getSelectedExportScope() {
        const scoped = document.querySelector('input[name="exportScope"]:checked');
        return scoped ? scoped.value : 'all';
    }

    _updateExportScopeState() {
        const totalNode = document.querySelector('[data-total-count]');
        if (totalNode) totalNode.textContent = String(this.coins.length);
        const selectedCount = this.selectedForPrint ? this.selectedForPrint.size : 0;
        const selectedNode = document.querySelector('[data-selection-count]');
        if (selectedNode) selectedNode.textContent = String(selectedCount);
        const selectionLabel = document.querySelector('[data-export-selection-label]');
        const selectionRadio = document.getElementById('exportScopeSelection');
        const hasSelection = selectedCount > 0;
        if (selectionRadio) {
            selectionRadio.disabled = !hasSelection;
            if (!hasSelection && selectionRadio.checked) {
                const fullRadio = document.querySelector('input[name="exportScope"][value="all"]');
                if (fullRadio) fullRadio.checked = true;
            }
        }
        if (selectionLabel) selectionLabel.classList.toggle('disabled', !hasSelection);
    }

    _formatBytes(bytes) {
        if (typeof bytes !== 'number' || !isFinite(bytes) || bytes < 0) return '—';
        if (bytes < 1024) return `${Math.round(bytes)} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    async _gatherStorageStats() {
        const stats = { usage: null, quota: null, idbBytes: 0, lsBytes: 0, coinsBytes: 0, imagesBytes: 0 };
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const est = await navigator.storage.estimate();
                stats.usage = est?.usage ?? null;
                stats.quota = est?.quota ?? null;
            }
        } catch (_) {}
        try {
            const json = JSON.stringify(this.coins);
            stats.coinsBytes = new Blob([json]).size;
            stats.imagesBytes = this.coins.reduce((sum, coin) => {
                if (!Array.isArray(coin.images)) return sum;
                return sum + coin.images.reduce((inner, img) => inner + Math.ceil(((img?.length || 0) * 3) / 4), 0);
            }, 0);
        } catch (_) {}
        try {
            stats.idbBytes = await assetStorage.estimateUsage();
        } catch (_) {}
        try {
            let total = 0;
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                total += (key ? key.length : 0) + ((localStorage.getItem(key) || '').length);
            }
            stats.lsBytes = Math.ceil(total * 2);
        } catch (_) {}
        return stats;
    }

    async _loadStorageStats() {
        const fields = document.querySelectorAll('[data-storage-value]');
        fields.forEach(node => { node.textContent = '…'; });
        const stats = await this._gatherStorageStats();
        this._renderStorageStats(stats);
    }

    _renderStorageStats(stats = {}) {
        const setField = (name, text) => {
            const el = document.querySelector(`[data-storage-value="${name}"]`);
            if (el) el.textContent = text;
        };
        const usageStr = this._formatBytes(stats.usage);
        const quotaStr = this._formatBytes(stats.quota);
        const pct = (typeof stats.usage === 'number' && typeof stats.quota === 'number' && stats.quota > 0)
            ? `${((stats.usage / stats.quota) * 100).toFixed(1)}%`
            : null;
        setField('usage', pct ? `${usageStr} (${pct})` : usageStr);
        setField('quota', quotaStr);
        setField('coins', this._formatBytes(stats.coinsBytes));
        setField('images', this._formatBytes(stats.imagesBytes));
        setField('local', this._formatBytes(stats.lsBytes));
        setField('indexed', this._formatBytes(stats.idbBytes));
    }

    openDataModal() {
        const modal = document.getElementById('dataModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        this._updateExportScopeState();
        this._loadStorageStats();
    }

    closeDataModal() {
        const modal = document.getElementById('dataModal');
        if (!modal) return;
        if (modal.classList.contains('hidden')) return;
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
    }

    // Update floating print bar visibility and count
    updatePrintBar() {
        const bar = document.getElementById('printBar');
        const count = this.selectedForPrint.size;
        if (!bar) return;
        bar.querySelector('[data-count]').textContent = String(count);
        bar.style.display = count > 0 ? 'flex' : 'none';
        this._updateExportScopeState();
    }

    // View coin details in modal
    viewCoin(id) {
        const coin = this.coins.find(c => c.id === id);
        if (!coin) return;

        const modalBody = document.getElementById('modalBody');
        const snap = (this.coins.find(x => x.id === coin.id)?.facts_snapshot) || null;
        const nnbsp = '\u202F';

        const chip = (src) => {
            const label = src==='nomisma'?'Nomisma': src==='wikidata'?'Wikidata': src==='wikipedia'?'Wikipedia': src==='ocre'?'OCRE':'You';
            return `<span class="source-chip ${this.escapeHtml(src)}">${this.escapeHtml(label)}</span>`;
        };

        const formatNum = (v, opts = {}) => {
            if (v == null || v === '') return '';
            const num = Number(String(v).replace(/[^0-9.\-]/g, ''));
            if (!isFinite(num)) return '';
            const fmt = new Intl.NumberFormat(navigator.language || 'en', { maximumFractionDigits: 2, ...opts });
            return fmt.format(num);
        };
        const formatUnit = (v, unit) => {
            const s = formatNum(v);
            return s ? `${s}${nnbsp}${unit}` : '';
        };
        const formatCompactDateRange = (exact) => {
            if (!exact) return '';
            const fy = exact.from?.year, fe = exact.from?.era || 'CE';
            const ty = exact.to?.year, te = exact.to?.era || 'CE';
            const approx = exact.approx ? 'c. ' : '';
            if (fy && ty) return fe === te ? `${approx}${fy}–${ty} ${fe}` : `${approx}${fy} ${fe} – ${ty} ${te}`;
            if (fy) return `${approx}${fy} ${fe}`;
            if (ty) return `${approx}${ty} ${te}`;
            return '';
        };
        const graceful = (s) => {
            const t = String(s || '').trim();
            return t ? this.escapeHtml(t) : '—';
        };
        const formatDateOnly = () => {
            const exact = coin.struck_date?.exact || null;
            const note = coin.struck_date?.note || '';
            const txt = formatCompactDateRange(exact);
            const main = graceful([note, txt].filter(Boolean).join(' '));
            return `${main}${chip('user')}`;
        };
        const formatPeriod = () => {
            const nm = snap?.nomisma_period || null;
            const lbl = (typeof coin.period === 'object') ? (coin.period.label || '') : '';
            const uri = (typeof coin.period === 'object' && coin.period.nomisma_uri) ? this._normalizeNomismaUrl(coin.period.nomisma_uri) : null;
            if (!lbl && !uri && !nm) return '';
            const labelText = graceful(lbl || nm?.label || '');
            const main = uri ? `<a href="${this.escapeHtml(uri)}" target="_blank" rel="noopener" title="Open on nomisma.org">${labelText}</a>` : labelText;
            const note = nm?.definition ? `<div class="dl-note">${this.escapeHtml(nm.definition)}</div>` : '';
            const src = nm ? chip('nomisma') : chip('user');
            return `${main}${src}${note}`;
        };
        const formatOrigin = () => {
            if (!coin.origin) return '';
            const nm = snap?.nomisma_origin || null;
            const nmLabel = nm?.label || null;
            const labelRaw = nmLabel || ((typeof coin.origin === 'object') ? (coin.origin.label || '') : (coin.origin || ''));
            const label = labelRaw ? (labelRaw.charAt(0).toUpperCase() + labelRaw.slice(1)) : '';
            const uri = (typeof coin.origin === 'object' && coin.origin.nomisma_uri) ? this._normalizeNomismaUrl(coin.origin.nomisma_uri) : null;
            const main = (uri && label) ? `<a href="${this.escapeHtml(uri)}" target="_blank" rel="noopener" title="Open on nomisma.org">${this.escapeHtml(label)}</a>` : this.escapeHtml(label);
            const note = nm?.definition ? `<div class="dl-note">${this.escapeHtml(nm.definition)}</div>` : '';
            const src = nm ? chip('nomisma') : chip('user');
            return `${main}${src}${note}`;
        };
        const matLabel = (coin.material && typeof coin.material === 'object') ? (coin.material.label || '') : (coin.material || '');
        const matUri = this._mapMaterialToNomisma(coin.material);
        const formatMaterial = () => {
            if (!matLabel) return '';
            const nm = snap?.nomisma_material || null;
            if (!matUri) return `${this.escapeHtml(matLabel)}${chip('user')}${nm?.definition ? `<div class="dl-note">${this.escapeHtml(nm.definition)}</div>` : ''}`;
            const m = String(matLabel).match(/^(.*?)(\s*\([^)]*\))?$/);
            const base = (m && m[1]) ? m[1] : matLabel;
            const suffix = (m && m[2]) ? m[2] : '';
            const main = `<a href="${this.escapeHtml(matUri)}" target="_blank" rel="noopener" title="Open on nomisma.org">${this.escapeHtml(base)}</a>${this.escapeHtml(suffix)}`;
            const note = nm?.definition ? `<div class="dl-note">${this.escapeHtml(nm.definition)}</div>` : '';
            return `${main}${chip('nomisma')}${note}`;
        };
        const authorityInfo = snap?.authority_info || null;
    const nmRulerLabel = snap?.nomisma_ruler?.label || (typeof coin.ruler === 'object' ? coin.ruler.label : '') || '';
        const resolvedRulerLabel = authorityInfo?.label || nmRulerLabel || '';
        const reignText = (() => {
            const c = authorityInfo?.claims_parsed?.reign || null;
            if (!c) return '';
            const exact = { from: c.start || null, to: c.end || null };
            const s = formatCompactDateRange(exact);
            return s ? `r. ${s}` : '';
        })();
        const hasNomismaGroup = !!(snap?.nomisma_period || snap?.nomisma_origin || snap?.nomisma_ruler);
        const hasOcreGroup = Array.isArray(coin.typeSeriesUris) && coin.typeSeriesUris.some(u => /numismatics\.org\/ocre\/id\//i.test(u));

                const refsHtml = (()=>{
            const srefs = Array.isArray(coin.referencesStructured)? coin.referencesStructured : [];
            const free = (coin.references||'').trim();
            const hasOcre = Array.isArray(coin.typeSeriesUris) && coin.typeSeriesUris.some(u => /numismatics\.org\/ocre\/id\//i.test(u));
            const ricRefs = srefs.filter(r => (r.authority||'').toUpperCase()==='RIC');
            const otherRefs = hasOcre ? srefs.filter(r => (r.authority||'').toUpperCase()!=='RIC') : srefs;
            if (!otherRefs.length && !free) return '';
            const items = otherRefs.map(r=>{
                const link = this._enrichmentUrlForRef(r);
                const label = this.escapeHtml(r.formatted||'');
                const metaBits = [r.volume?`Vol ${this.escapeHtml(r.volume)}`:'', r.series? this.escapeHtml(r.series):'', r.suffix?`Suffix ${this.escapeHtml(r.suffix)}`:''].filter(Boolean).join(' · ');
                const main = link? `<a href=\"${this.escapeHtml(link)}\" target=\"_blank\" rel=\"noopener\">${label}</a>` : label;
                return `<li title=\"Source: You\">${main}${metaBits? ` <span class=\"text-muted\">(${metaBits})</span>`:''}</li>`;
            }).join('');
            const list = items? `<ul class=\"ref-list\" style=\"margin:0.25rem 0 0.5rem 1rem;\">${items}</ul>` : '';
            const freeHtml = free? `<div class=\"dl\"><dt>Notes</dt><dd title=\"Source: You\">${this.escapeHtml(free)}</dd></div>` : '';
            // Allow resolving an OCRE canonical type from RIC if not yet linked
            const resolveBlock = (!hasOcre && ricRefs.length)
              ? `<div class=\"dl\"><dt>Link to OCRE</dt><dd><button type=\"button\" id=\"resolveOcreBtn\" class=\"btn-secondary\">Resolve from RIC</button> <span id=\"resolveOcreNote\" class=\"text-muted\" style=\"margin-left:8px;\"></span></dd></div>
                 <div class=\"dl\"><dt>Manual</dt><dd><input id=\"manualOcreInput\" type=\"url\" placeholder=\"https://numismatics.org/ocre/id/ric...\" style=\"width:100%;max-width:420px;padding:6px 8px;\"> <button type=\"button\" id=\"manualOcreSaveBtn\" class=\"btn-secondary\">Link</button></dd></div>`
              : '';
                        // Greek catalogs helper (HGC/SNG) with manual type link
                        const greekRefs = srefs.filter(r => ['HGC','SNG'].includes(String(r.authority||'').toUpperCase()));
                        const hasGreekRef = greekRefs.length > 0;
                        const hasGreekType = Array.isArray(coin.typeSeriesUris) && coin.typeSeriesUris.some(u => /numismatics\.org\/(pella|sco|pco)\/id\//i.test(u));
                        const greekQuery = greekRefs.map(r => r.formatted || '').filter(Boolean).join(' OR ');
                        const greekBlock = (!hasGreekType && hasGreekRef)
                            ? `<div class=\"dl\"><dt>Greek Catalogs</dt><dd>${greekQuery? `<a class=\"btn-link\" href=\"https://numismatics.org/search/results?q=${encodeURIComponent(greekQuery)}\" target=\"_blank\" rel=\"noopener\">Search ANS</a>`:''}</dd></div>
                                 <div class=\"dl\"><dt>Manual</dt><dd><input id=\"manualGreekTypeInput\" type=\"url\" placeholder=\"https://numismatics.org/pella/id/...\" style=\"width:100%;max-width:420px;padding:6px 8px;\"> <button type=\"button\" id=\"manualGreekTypeSaveBtn\" class=\"btn-secondary\">Link</button> <span id=\"manualGreekTypeNote\" class=\"text-muted\" style=\"margin-left:8px;\"></span></dd></div>`
                            : '';
            const refsTitleChips = chip('user');
                        return list || freeHtml || resolveBlock || greekBlock ? `<div class=\"card collapsible\"><h3 class=\"collapsible-head\"><span class=\"caret\"></span>References ${refsTitleChips}</h3><div class=\"collapse-body\">${list}${freeHtml}${resolveBlock}${greekBlock}</div></div>` : '';
        })();
        // Conflict detection placeholder: compare user-entered vs authoritative enriched values
        const conflicts = [];
        const norm = s => String(s||'').trim().toLowerCase();
        const valuesMatch = (field, userVal, authVal) => {
            const a = norm(userVal);
            const b = norm(authVal);
            if (a && a === b) return true;
            if (field === 'Material') {
                const strip = (txt) => String(txt || '')
                    .replace(/\([^)]*\)/g, '')
                    .replace(/\b(ae|ar|av|el|bi|cu)\b/gi, '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();
                const strippedUser = strip(userVal);
                const strippedAuth = strip(authVal);
                if (strippedUser && strippedAuth && strippedUser === strippedAuth) return true;
                const uriUser = this._mapMaterialToNomisma(userVal);
                const uriAuth = this._mapMaterialToNomisma(authVal);
                if (uriUser && uriAuth && uriUser === uriAuth) return true;
            }
            return false;
        };
        const userAuthority = (coin.ruler && typeof coin.ruler==='object')? (coin.ruler.label||'') : coin.ruler||'';
        const authAuthority = snap?.nomisma_ruler?.label || snap?.authority_info?.label || '';
        if (userAuthority && authAuthority && !valuesMatch('Authority', userAuthority, authAuthority)) conflicts.push({ field:'Authority', user:userAuthority, authoritative:authAuthority });
        const userMint = (coin.origin && typeof coin.origin==='object')? (coin.origin.label||'') : coin.origin||'';
        const authMint = snap?.nomisma_origin?.label || snap?.mint_info?.label || '';
        if (userMint && authMint && !valuesMatch('Mint', userMint, authMint)) conflicts.push({ field:'Mint', user:userMint, authoritative:authMint });
        const userMaterial = (typeof coin.material==='object')? (coin.material.label||'') : coin.material||'';
        const authMaterial = snap?.nomisma_material?.label || snap?.material_info?.label || '';
        if (userMaterial && authMaterial && !valuesMatch('Material', userMaterial, authMaterial)) conflicts.push({ field:'Material', user:userMaterial, authoritative:authMaterial });
        const userPeriod = (coin.period && typeof coin.period==='object')? (coin.period.label||'') : '';
        const authPeriod = snap?.nomisma_period?.label || snap?.period_info?.label || '';
        if (userPeriod && authPeriod && !valuesMatch('Period', userPeriod, authPeriod)) conflicts.push({ field:'Period', user:userPeriod, authoritative:authPeriod });
        const conflictHtml = conflicts.length ? `<div class=\"card collapsible conflict-card\"><h3 class=\"collapsible-head\"><span class=\"caret\"></span>Potential Conflicts <span class=\"badge-warning\">${conflicts.length}</span></h3><div class=\"collapse-body\"><p class=\"conflict-intro\">Differences between your entries and authoritative sources:</p><ul class=\"conflict-list\">${conflicts.map(c=> `<li><strong>${this.escapeHtml(c.field)}:</strong> You: <em>${this.escapeHtml(c.user)}</em> · Source: <em>${this.escapeHtml(c.authoritative)}</em></li>`).join('')}</ul><p class=\"conflict-note\">Review and decide which value is correct. (Early prototype)</p></div></div>` : '';

        // Redesigned layout (header, view tools, hero area, context columns) inserted below.
        const subtitleParts = [];
        const matShort = (()=>{ const m = coin.material; if (!m) return ''; const lbl = (typeof m==='object')? (m.label||'') : String(m); const code = (typeof m==='object' && m.code)? m.code : ''; return [lbl, code?`(${code})`:''].filter(Boolean).join(' '); })();
        if (matShort) subtitleParts.push(matShort);
        if (coin.weight!=null) subtitleParts.push(formatUnit(coin.weight,'g'));
        if (coin.diameter!=null) subtitleParts.push(formatUnit(coin.diameter,'mm'));
        const dateSubtitle = (coin.struck_date?.exact)? formatCompactDateRange(coin.struck_date.exact) : '';
        if (dateSubtitle) subtitleParts.push(dateSubtitle);
        const subtitleLine = subtitleParts.join(' · ');
        const headerHtml = `
            <div class="modal-header">
                            <div style="flex:1;min-width:280px;">
                                <h2>${this.escapeHtml(coin.name)}</h2>
                                ${subtitleLine? `<div class="subtitle-line">${this.escapeHtml(subtitleLine)}</div>`:''}
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                <div class="more-menu">
                  <button id="moreMenuBtn" class="btn-secondary" style="padding:0.4rem 0.8rem;">More ▾</button>
                                    <div class="more-dropdown" id="moreDropdown">
                                        <button type="button" id="menuEditBtn">Edit</button>
                    <button type="button" id="refreshSnapshotBtn">Refresh snapshot</button>
                                        <button type="button" id="compareThisBtn">Compare</button>
                    <button type="button" id="museumModeBtn">Museum Mode</button>
                  </div>
                </div>
              </div>
            </div>`;
        const viewTools = this._hasCoinImageSource(coin) ? `<div class="modal-media-tools">
            <div class="tool-group tool-views" role="group" aria-label="View">
                <div class="tool-title">View</div>
                <div class="tool-row">
                    <button type="button" class="tool-btn" data-view="normal" aria-pressed="true">Normal</button>
                    <button type="button" class="tool-btn" data-view="invert">Invert</button>
                    <button type="button" class="tool-btn" data-view="edge">Edge</button>
                </div>
            </div>
            <div class="tool-group tool-intensity">
                <div class="tool-title">Intensity</div>
                <input id="detailIntensity" type="range" min="0" max="100" value="60" />
            </div>
            <div class="tool-group tool-bg" role="group" aria-label="Background">
                <div class="tool-title">Background</div>
                <div class="tool-row">
                    <button type="button" class="tool-btn swatch-btn" data-bg="none" title="None"><span class="swatch swatch-none"></span></button>
                    <button type="button" class="tool-btn swatch-btn" data-bg="bg-grey" title="Neutral Grey"><span class="swatch swatch-grey"></span></button>
                    <button type="button" class="tool-btn swatch-btn" data-bg="bg-warm" title="Warm Parchment"><span class="swatch swatch-warm"></span></button>
                    <button type="button" class="tool-btn swatch-btn" data-bg="bg-teal" title="Deep Teal"><span class="swatch swatch-teal"></span></button>
                    <button type="button" class="tool-btn swatch-btn" data-bg="bg-charcoal" title="Charcoal"><span class="swatch swatch-charcoal"></span></button>
                </div>
            </div>
            <div class="tool-group tool-actions">
                <div class="tool-title">Tools</div>
                <div class="tool-row">
                    <button id="detailMagnifierBtn" type="button" class="tool-btn" aria-pressed="false" title="Magnifier">🔍</button>
                    <button id="detailResetBtn" type="button" class="tool-btn" title="Reset view settings">Reset</button>
                </div>
            </div>
        </div>` : '';
        const viewToolsCard = viewTools ? `<div class="card image-tools-card collapsible collapsed" id="imageToolsCard"><h3 class="collapsible-head"><span class="caret"></span>Image Tools</h3><div class="collapse-body">${viewTools}</div></div>` : '';
        const obvCaption = this.escapeHtml(coin.obverse||'');
        const revCaption = this.escapeHtml(coin.reverse||'');
        const heroFaces = [];
        const heroObv = this._getCoinFace(coin, 'obv');
        const heroRev = this._getCoinFace(coin, 'rev');
        if (heroObv) heroFaces.push({ url: heroObv, label: 'OBVERSE', caption: obvCaption, role: 'obv' });
        if (heroRev && heroRev !== heroObv) heroFaces.push({ url: heroRev, label: 'REVERSE', caption: revCaption, role: 'rev' });
        if (heroFaces.length < 2) {
            const extras = this._collectCoinImageSources(coin).filter(src => src && src !== heroObv && src !== heroRev);
            if (extras.length) heroFaces.push({ url: extras[0], label: heroFaces.length ? 'DETAIL' : 'REVERSE', caption: revCaption || obvCaption, role: 'extra' });
        }
        const heroImagesHtml = heroFaces.length? `<div class="hero-images">${heroFaces.map(face => {
            const altFace = face.role==='obv' ? 'obverse' : (face.role==='rev' ? 'reverse' : 'detail');
            return `<div class=\"face-card\"><div class=\"face-media\"><img class=\"img-main\" src=\"${face.url}\" alt=\"${this.escapeHtml(coin.name)} ${altFace}\"></div><div class=\"face-caption-label\" title=\"From your input\">${face.label} – From you</div>${face.caption? `<div class=\"face-caption-text\">${face.caption}</div>`:''}</div>`;
        }).join('')}</div>`:'';
        const heroVisualBlock = viewToolsCard && heroImagesHtml
            ? `<div class="hero-images-stack">${viewToolsCard}${heroImagesHtml}</div>`
            : heroImagesHtml;
        // Essentials rows captured semantically (dt/dd directly inside one <dl>)
        const capFirst = (s)=>{ const t=String(s||''); return t ? t.charAt(0).toUpperCase()+t.slice(1) : t; };
        const essentialsRows=[]; const pushEss=(lbl,val,sources=[])=>{ if(!val) return; const order=['user','nomisma','ocre','wikidata','wikipedia']; const uniq=[]; sources.forEach(s=>{ if(order.includes(s) && !uniq.includes(s)) uniq.push(s); }); const textMap={ user:'You', nomisma:'Nomisma', ocre:'OCRE', wikidata:'Wikidata', wikipedia:'Wikipedia' }; const chipTitle = uniq.length? `Sources: ${uniq.map(s=> textMap[s]||s).join(', ')}`:'Source: You'; essentialsRows.push(`<dt>${this.escapeHtml(lbl)}</dt><dd title=\"${this.escapeHtml(chipTitle)}\"><span class=\"value-text\">${this.escapeHtml(val)}</span></dd>`); };
        const authorityVal = resolvedRulerLabel || (coin.ruler && typeof coin.ruler==='object'? (coin.ruler.label||'') : coin.ruler||''); const authoritySources=[]; if(coin.ruler) authoritySources.push('user'); if(snap?.nomisma_ruler) authoritySources.push('nomisma'); if(snap?.authority_info) authoritySources.push('wikidata');
        const denomVal = this._denominationFromName(coin.name||''); const denomSources = denomVal? ['user']:[];
        const periodVal = capFirst((coin.period && typeof coin.period==='object')? (coin.period.label||'') : ''); const periodSources=[]; if(periodVal) periodSources.push('user'); if(snap?.nomisma_period) periodSources.push('nomisma'); if(snap?.period_info) periodSources.push('wikidata');
        const mintValRaw = (coin.origin && typeof coin.origin==='object')? (coin.origin.label||'') : (coin.origin||'');
        const mintVal = capFirst(mintValRaw);
        const mintSources=[]; if(mintValRaw) mintSources.push('user'); if(snap?.nomisma_origin) mintSources.push('nomisma'); if(snap?.mint_info) mintSources.push('wikidata');
        const materialVal = capFirst(matLabel || ''); const materialSources=[]; if(materialVal) materialSources.push('user'); if(snap?.nomisma_material) materialSources.push('nomisma'); if(snap?.material_info) materialSources.push('wikidata');
        const dateVal = (coin.struck_date?.exact)? formatCompactDateRange(coin.struck_date.exact) : ''; const dateSources=[]; if(dateVal) dateSources.push('user');
        const wVal = (coin.weight!=null)? formatUnit(coin.weight,'g'):''; const dVal=(coin.diameter!=null)? formatUnit(coin.diameter,'mm'):'';
        pushEss('Date',dateVal,dateSources); pushEss('Period',periodVal,periodSources); pushEss('Authority',authorityVal,authoritySources); pushEss('Denomination',denomVal,denomSources); pushEss('Mint',mintVal,mintSources); pushEss('Material',materialVal,materialSources); pushEss('Weight',wVal,wVal?['user']:[]); pushEss('Diameter',dVal,dVal?['user']:[]);
        const essentialsHtml = `<div class=\"card essentials-card\"><h3>Essentials</h3><dl class=\"dl essentials-dl\">${essentialsRows.join('')}</dl><div class=\"essentials-helper\">Key facts used for search, filtering and labels.</div></div>`;
        const legendHtml = `<div class=\"legend-sources\">\n            <span class=\"legend-item\"><span class=\"source-chip user\" title=\"Your direct input\">You</span><span class=\"legend-desc\">Values you entered</span></span>\n            <span class=\"legend-item\"><span class=\"source-chip nomisma\" title=\"Authoritative numismatic concept from Nomisma.org\">Nomisma</span><span class=\"legend-desc\">Controlled numismatic concept</span></span>\n            <span class=\"legend-item\"><span class=\"source-chip ocre\" title=\"Canonical Roman Imperial type reference (OCRE)\">OCRE</span><span class=\"legend-desc\">Canonical type reference</span></span>\n            <span class=\"legend-item\"><span class=\"source-chip wikidata\" title=\"Structured entity from Wikidata\">Wikidata</span><span class=\"legend-desc\">Structured entity facts</span></span>\n            <span class=\"legend-item\"><span class=\"source-chip wikipedia\" title=\"Public encyclopedic summary\">Wikipedia</span><span class=\"legend-desc\">Summary & image</span></span>\n        </div>`;
        const heroHtml = `<div class=\"hero-grid\">${heroVisualBlock}</div><div class=\"essentials-row\">${essentialsHtml}</div>`;
        // Direct single-column context markup (no post-render merge) with standardized button classes
        modalBody.innerHTML = `${headerHtml}${heroHtml}
            <div class=\"context-single\">\n                ${coin.description ? `<div class=\"card collapsible\"><h3 class=\"collapsible-head\"><span class=\"caret\"></span>Description & Notes <span class=\"source-chip user\" title=\"Source: You\">You</span></h3><div class=\"collapse-body\"><p class=\"desc-clamp\" id=\"descText\" title=\"Source: You\">${this.escapeHtml(coin.description)}</p><button id=\"descToggle\" class=\"show-more btn-sm btn-secondary\" aria-expanded=\"false\" hidden>Show more</button></div></div>` : ''}\n                <div id=\"typeCardHost\"></div>\n                <div id=\"learnMoreCards\"></div>\n                ${legendHtml}\n                ${conflictHtml}\n                ${refsHtml}\n            </div>`;

        // Initialize clickable collapsible headers (toggle .collapsed)
        modalBody.querySelectorAll('.collapsible-head').forEach(head => {
            head.addEventListener('click', () => {
                const card = head.closest('.card');
                if (!card) return;
                card.classList.toggle('collapsed');
            });
        });

        // Wire OCRE resolve/link controls after DOM is in place
        try {
            const resolveBtn = document.getElementById('resolveOcreBtn');
            const resolveNote = document.getElementById('resolveOcreNote');
            if (resolveBtn) {
                resolveBtn.addEventListener('click', async () => {
                    resolveBtn.disabled = true;
                    if (resolveNote) resolveNote.textContent = 'Resolving…';
                    try {
                        const ricRef = (Array.isArray(coin.referencesStructured)? coin.referencesStructured : []).find(r => (r.authority||'').toUpperCase()==='RIC');
                        const uri = await this._resolveOcreFromRicRef(ricRef);
                        if (uri) {
                            const set = new Set(Array.isArray(coin.typeSeriesUris)? coin.typeSeriesUris : []);
                            set.add(uri);
                            coin.typeSeriesUris = Array.from(set);
                            this.saveCoins();
                            if (resolveNote) resolveNote.innerHTML = `Linked: <a href="${this.escapeHtml(uri)}" target="_blank" rel="noopener">${this.escapeHtml(uri)}\u200b</a>`;
                            setTimeout(()=> this.viewCoin(coin.id), 400);
                        } else {
                            if (resolveNote) resolveNote.textContent = 'No canonical OCRE type could be found for this reference.';
                        }
                    } catch(e) {
                        if (resolveNote) resolveNote.textContent = 'Failed to resolve OCRE type.';
                    } finally {
                        resolveBtn.disabled = false;
                    }
                });
            }
            const manualInput = document.getElementById('manualOcreInput');
            const manualSave = document.getElementById('manualOcreSaveBtn');
            if (manualSave && manualInput) {
                manualSave.addEventListener('click', () => {
                    const raw = (manualInput.value || '').trim();
                    const re = /^https?:\/\/numismatics\.org\/ocre\/id\/ric\.[^\s]+$/i;
                    const note = document.getElementById('resolveOcreNote');
                    if (!re.test(raw)) { if (note) note.textContent = 'Please paste a valid OCRE canonical type URL (https://numismatics.org/ocre/id/ric.*).'; return; }
                    const set = new Set(Array.isArray(coin.typeSeriesUris)? coin.typeSeriesUris : []);
                    set.add(raw);
                    coin.typeSeriesUris = Array.from(set);
                    this.saveCoins();
                    if (note) note.innerHTML = `Linked: <a href="${this.escapeHtml(raw)}" target="_blank" rel="noopener">${this.escapeHtml(raw)}\u200b</a>`;
                    setTimeout(()=> this.viewCoin(coin.id), 200);
                });
            }
        } catch(_) {}

        // Wire manual Greek type linker
        try {
            const greekInput = document.getElementById('manualGreekTypeInput');
            const greekSave = document.getElementById('manualGreekTypeSaveBtn');
            const greekNote = document.getElementById('manualGreekTypeNote');
            if (greekSave && greekInput){
                greekSave.addEventListener('click', () => {
                    const raw = (greekInput.value||'').trim();
                    const re = /^https?:\/\/numismatics\.org\/(pella|sco|pco)\/id\/[\w.-]+$/i;
                    if (!re.test(raw)) { if (greekNote) greekNote.textContent = 'Paste a valid PELLA/SCO/PCO type URL.'; return; }
                    const set = new Set(Array.isArray(coin.typeSeriesUris)? coin.typeSeriesUris : []);
                    set.add(raw);
                    coin.typeSeriesUris = Array.from(set);
                    this.saveCoins();
                    if (greekNote) greekNote.innerHTML = `Linked: <a href="${this.escapeHtml(raw)}" target="_blank" rel="noopener">${this.escapeHtml(raw)}\u200b</a>`;
                    setTimeout(()=> this.viewCoin(coin.id), 200);
                });
            }
        } catch(_) {}

        document.getElementById('coinModal').classList.remove('hidden');

        const menuEditBtn = document.getElementById('menuEditBtn');
        if (menuEditBtn) {
            menuEditBtn.addEventListener('click', () => {
                this.openEditCoin(coin.id);
                this.closeModal();
            });
        }
        const refreshBtn = document.getElementById('refreshSnapshotBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true; refreshBtn.textContent = 'Refreshing…';
                try { await this.enrichCoin(coin.id, { force: true, linksOnly: false }); } catch (_) {}
                this.viewCoin(coin.id);
            });
        }
        // Wire "More" dropdown in header
        const moreBtn = document.getElementById('moreMenuBtn');
        const moreDrop = document.getElementById('moreDropdown');
        if (moreBtn && moreDrop){
            const hide = ()=>{ moreDrop.style.display='none'; moreBtn.setAttribute('aria-expanded','false'); };
            const show = ()=>{ moreDrop.style.display='block'; moreBtn.setAttribute('aria-expanded','true'); };
            moreBtn.addEventListener('click', (e)=>{ e.stopPropagation(); const open = moreDrop.style.display==='block'; if (open) hide(); else show(); });
            document.addEventListener('click', (e)=>{ if (!moreDrop.contains(e.target) && e.target!==moreBtn) hide(); });
        }

        const exploreBtn = document.getElementById('exploreHistoryBtn');
        if (exploreBtn) {
            exploreBtn.addEventListener('click', async () => {
                await this.openHistoryExplorer(coin.id);
            });
        }

        const compareBtn = document.getElementById('compareThisBtn');
        if (compareBtn){
            compareBtn.addEventListener('click', ()=> this.openCompare(coin.id, null, false));
        }
        const museumBtn = document.getElementById('museumModeBtn');
        if (museumBtn){ museumBtn.addEventListener('click', ()=> this.openMuseumMode(coin.id)); }
        // (Image Tools visible by default; no menu button wiring)

        // Initialize detail view mode tools
        this._detailViewState = { view:'normal', intensity:60, bg:'none' };
        this._initDetailViewTools();

        const modalImgs = document.querySelectorAll('.hero-images .img-main, .modal-media .img-main, .modal-thumbs img');
        if (modalImgs && modalImgs.length > 0) {
            const urls = this._collectCoinImageSources(coin);
            if (!urls.length && this.PLACEHOLDER_IMAGE) urls.push(this.PLACEHOLDER_IMAGE);
            modalImgs.forEach((imgEl, idx) => {
                imgEl.style.cursor = 'zoom-in';
                imgEl.addEventListener('click', () => {
                    const tIdx = imgEl.getAttribute('data-thumb-index');
                    const start = tIdx ? parseInt(tIdx, 10) : idx;
                    document.querySelectorAll('.modal-thumbs img').forEach(t => t.classList.remove('selected'));
                    if (tIdx) imgEl.classList.add('selected');
                    this.openImageLightbox(urls, start);
                });
            });
        }

        if (coin.model3D) {
            setTimeout(() => this.init3DViewer(coin.model3D), this.VIEWER_INIT_DELAY);
        }

        const descEl = document.getElementById('descText');
        const toggle = document.getElementById('descToggle');
        if (descEl && toggle) {
            setTimeout(() => { if (descEl.scrollHeight > descEl.clientHeight + 4) toggle.hidden = false; }, 0);
            toggle.addEventListener('click', () => {
                const expanded = toggle.getAttribute('aria-expanded') === 'true';
                toggle.setAttribute('aria-expanded', String(!expanded));
                if (expanded) { descEl.classList.add('desc-clamp'); toggle.textContent = 'Show more'; }
                else { descEl.classList.remove('desc-clamp'); toggle.textContent = 'Show less'; }
            });
        }

        // Wire OCRE resolver button if present
        const resolveBtn = document.getElementById('resolveOcreBtn');
        const resolveNote = document.getElementById('resolveOcreNote');
        if (resolveBtn) {
            resolveBtn.addEventListener('click', async () => {
                resolveBtn.disabled = true;
                if (resolveNote) resolveNote.textContent = 'Resolving…';
                try {
                    const ricRef = (coin.referencesStructured||[]).find(r => (r.authority||'').toUpperCase()==='RIC');
                    const uri = await this._resolveOcreFromRicRef(ricRef);
                    if (uri) {
                        const set = new Set(Array.isArray(coin.typeSeriesUris)? coin.typeSeriesUris : []);
                        set.add(uri);
                        coin.typeSeriesUris = Array.from(set);
                        this.saveCoins();
                        if (resolveNote) resolveNote.innerHTML = `Linked: <a href="${this.escapeHtml(uri)}" target="_blank" rel="noopener">${this.escapeHtml(uri)}\u200b</a>`;
                        // Re-render basic info to show the new Type Series row
                        setTimeout(()=> this.viewCoin(coin.id), 400);
                    } else {
                        if (resolveNote) resolveNote.textContent = 'No canonical OCRE type could be found for this reference.';
                    }
                } catch (e) {
                    if (resolveNote) resolveNote.textContent = 'Failed to resolve OCRE type.';
                } finally {
                    resolveBtn.disabled = false;
                }
            });
        }
        // If a canonical OCRE type is linked, fetch and render type details card
        try {
            const typeHost = document.getElementById('typeCardHost');
            const ocreUri = (Array.isArray(coin.typeSeriesUris)? coin.typeSeriesUris : []).find(u => /numismatics\.org\/ocre\/id\//i.test(u));
            if (typeHost && ocreUri) {
                typeHost.innerHTML = `<div class="card"><h3>Type Details</h3><div>Loading…</div></div>`;
                (async()=>{
                    try {
                        const t = await this._fetchOcreTypeData(ocreUri);
                        const allSeries = Array.isArray(coin.typeSeriesUris)? coin.typeSeriesUris : [];
                        const ocreSeries = allSeries.filter(u=> /numismatics\.org\/ocre\/id\//i.test(u));
                        const ricRefs = (Array.isArray(coin.referencesStructured)? coin.referencesStructured : []).filter(r => (r.authority||'').toUpperCase()==='RIC');
                        typeHost.innerHTML = this._renderOcreTypeCard(t, ocreUri, { ocreSeries, ricRefs });
                        const head = typeHost.querySelector('.collapsible-head');
                        if (head) {
                            head.addEventListener('click', () => {
                                const card = head.closest('.card');
                                if (!card) return;
                                card.classList.toggle('collapsed');
                            });
                        }
                    } catch(e){
                        typeHost.innerHTML = `<div class="card"><h3>Type Details</h3><p>Open on OCRE:</p><a href="${this.escapeHtml(ocreUri)}" target="_blank" rel="noopener">${this.escapeHtml(ocreUri)}</a></div>`;
                    }
                })();
            } else if (typeHost) {
                const allSeries = Array.isArray(coin.typeSeriesUris)? coin.typeSeriesUris : [];
                if (allSeries.length){
                    const labelFor = (u)=>{
                        if (/\/pella\//i.test(u)) return 'PELLA Type';
                        if (/\/sco\//i.test(u)) return 'SCO Type';
                        if (/\/pco\//i.test(u)) return 'PCO Type';
                        if (/\/ocre\//i.test(u)) return 'OCRE Type';
                        return 'Catalog Type';
                    };
                    const rows = allSeries.map(u=> `<div class="dl"><dt>${labelFor(u)}</dt><dd><a href="${this.escapeHtml(u)}" target="_blank" rel="noopener">${this.escapeHtml(u)}</a></dd></div>`).join('');
                    typeHost.innerHTML = `<div class="card collapsible type-card"><h3 class="collapsible-head"><span class="caret"></span>Catalog References</h3><div class="collapse-body">${rows}<div class="dl-note">Linked catalog types are listed above. Detailed parsing is supported for OCRE; Greek series links open externally.</div></div></div>`;
                    const head = typeHost.querySelector('.collapsible-head');
                    if (head) head.addEventListener('click', ()=>{ const card=head.closest('.card'); if (card) card.classList.toggle('collapsed'); });
                }
            }
        } catch(_) {}
        const manualInput = document.getElementById('manualOcreInput');
        const manualSave = document.getElementById('manualOcreSaveBtn');
        if (manualSave && manualInput) {
            manualSave.addEventListener('click', () => {
                const raw = (manualInput.value || '').trim();
                const re = /^https?:\/\/numismatics\.org\/ocre\/id\/ric\.[^\s]+$/i;
                if (!re.test(raw)) {
                    if (resolveNote) resolveNote.textContent = 'Please paste a valid OCRE canonical type URL (https://numismatics.org/ocre/id/ric.*).';
                    return;
                }
                const set = new Set(Array.isArray(coin.typeSeriesUris)? coin.typeSeriesUris : []);
                set.add(raw);
                coin.typeSeriesUris = Array.from(set);
                this.saveCoins();
                if (resolveNote) resolveNote.innerHTML = `Linked: <a href="${this.escapeHtml(raw)}" target="_blank" rel="noopener">${this.escapeHtml(raw)}\u200b</a>`;
                setTimeout(()=> this.viewCoin(coin.id), 200);
            });
        }

        // Build Learn More cards (ruler first, then period)
        try {
            const lmHost = document.getElementById('learnMoreCards');
            if (lmHost) {
                const pinfo = snap?.period_info || null;
                const ainfo = snap?.authority_info || null;
                const minfo = snap?.mint_info || null;
                const matInfo = snap?.material_info || null;
                const nmPeriod = snap?.nomisma_period || null;
                const nmRuler = snap?.nomisma_ruler || null;
                const nmMint = snap?.nomisma_origin || null;
                const nmMaterial = snap?.nomisma_material || null;
                const truncate = (txt, chars=240) => {
                    if (!txt) return '';
                    const clean = String(txt).trim();
                    if (clean.length <= chars) return clean;
                    // Cut at sentence end if possible within range
                    const slice = clean.slice(0, chars);
                    const lastPeriod = slice.lastIndexOf('. ');
                    if (lastPeriod > 100) return slice.slice(0, lastPeriod+1).trim();
                    return slice.replace(/[\s,.]+$/,'') + '…';
                };
                const renderCard = (title, info, nmFallback, opts={}) => {
                    if (!info && !nmFallback) return '';
                    const label = info?.label || nmFallback?.label || title;
                    const fullDesc = info?.wikipedia?.extract || info?.description || nmFallback?.definition || '';
                    const isPeriod = opts.period === true;
                    const desc = isPeriod ? truncate(fullDesc, 220) : fullDesc;
                    const thumb = info?.wikipedia?.thumbnail?.source || '';
                    const wikiUrl = info?.wikipedia?.content_urls?.desktop?.page || null;
                    const wdUrl = info?.qid ? `https://www.wikidata.org/wiki/${info.qid}` : null;
                    const nmUrl = nmFallback?.uri || null;
                    // Determine precise provenance of displayed values (for tooltips only)
                    const labelSrc = info?.label ? 'Wikidata' : (nmFallback?.label ? 'Nomisma' : null);
                    const descSrc = info?.wikipedia?.extract ? 'Wikipedia' : (info?.description ? 'Wikidata' : (nmFallback?.definition ? 'Nomisma' : null));
                    const years = (() => {
                        if (title.includes('ruler')) {
                            const r = info?.claims_parsed?.reign || null;
                            if (r) {
                                const exact = { from: r.start || null, to: r.end || null };
                                const s = formatCompactDateRange(exact);
                                return s ? `r. ${this.escapeHtml(s)}` : '';
                            }
                        }
                        return '';
                    })();
                    const learnBtn = isPeriod ? `<div style=\"margin-top:6px\"><button type=\"button\" id=\"learnPeriodBtn\" class=\"btn-link\">Learn more about this period</button></div>` : '';
                    const mintCoords = opts.mint ? this._resolveMintCoordinates(info, nmFallback) : null;
                    const mapHtml = (opts.mint && mintCoords) ? this._renderMintMap(mintCoords, label) : '';
                    if (opts.mint) {
                        try {
                            if (mintCoords) {
                                console.debug('Mint map ready', { label, lat: mintCoords.lat, lon: mintCoords.lon, source: info?.coordinates ? 'snapshot' : (nmFallback?.coordinates ? 'nomisma' : 'synthetic') });
                            } else {
                                console.debug('Mint map missing coordinates', { label, hasSnapshot: !!info?.coordinates, hasNomisma: !!nmFallback?.coordinates });
                            }
                        } catch (_) {}
                    }
                    const secSources = [];
                    if (info?.qid || info?.label) secSources.push('wikidata');
                    if (info?.wikipedia?.extract) secSources.push('wikipedia');
                    if (nmFallback) secSources.push('nomisma');
                    const seen = new Set();
                    const chips = secSources.filter(s=>{ if(seen.has(s)) return false; seen.add(s); return true; }).map(src=>{
                        if (src==='wikipedia' && wikiUrl) return `<a class=\"source-chip wikipedia\" href=\"${this.escapeHtml(wikiUrl)}\" target=\"_blank\" rel=\"noopener\" title=\"Wikipedia: ${this.escapeHtml(wikiUrl)}\">Wikipedia</a>`;
                        if (src==='wikidata' && wdUrl) return `<a class=\"source-chip wikidata\" href=\"${this.escapeHtml(wdUrl)}\" target=\"_blank\" rel=\"noopener\" title=\"Wikidata: ${this.escapeHtml(info?.qid || '')}\">Wikidata</a>`;
                        if (src==='nomisma' && nmUrl) return `<a class=\"source-chip nomisma\" href=\"${this.escapeHtml(nmUrl)}\" target=\"_blank\" rel=\"noopener\" title=\"Nomisma: ${this.escapeHtml(nmUrl)}\">Nomisma</a>`;
                        return chip(src);
                    }).join(' ');
                    return `
                        <div class=\"card collapsible\">\n                            <h3 class=\"collapsible-head\"><span class=\"caret\"></span>${this.escapeHtml(title)} ${chips}</h3>\n                            <div class=\"collapse-body\">\n                                <div class=\"ruler-card\">\n                                    ${thumb ? `<img class=\"ruler-avatar\" src=\"${this.escapeHtml(thumb)}\" alt=\"\" aria-hidden=\"true\">` : ''}\n                                    <div>\n                                        <div class=\"ruler-name-row\"><div class=\"ruler-name\" title=\"${labelSrc?`Label from ${this.escapeHtml(labelSrc)}`:''}\">${this.escapeHtml(label)}</div> ${years ? `<span class=\"years\">${years}</span>` : ''}</div>\n                                        ${desc ? `<div class=\"ruler-desc\" title=\"${descSrc?`Summary from ${this.escapeHtml(descSrc)}`:''}\">${this.escapeHtml(desc)}</div>` : `<div class=\"ruler-desc\" style=\"color:#6b7280\">No additional summary available.</div>`}\n                                        ${learnBtn}\n                                    </div>\n                                </div>\n                                ${mapHtml}\n                            </div>\n                        </div>`;
                };
                const parts = [];
                if (ainfo || nmRuler) parts.push(renderCard('About the ruler', ainfo, nmRuler));
                if (pinfo || nmPeriod) parts.push(renderCard('About the period', pinfo, nmPeriod, { period: true }));
                if (matInfo || nmMaterial) parts.push(renderCard('About the material', matInfo, nmMaterial));
                if (minfo || nmMint) parts.push(renderCard('About the mint', minfo, nmMint, { mint: true }));
                lmHost.innerHTML = parts.join('');
                // Wire period learn button
                const lp = document.getElementById('learnPeriodBtn');
                if (lp) lp.addEventListener('click', ()=> this.openHistoryExplorer(coin.id));
                // Initialize collapsible headers (Learn More cards)
                lmHost.querySelectorAll('.collapsible-head').forEach(head => {
                    head.addEventListener('click', () => {
                        const card = head.closest('.card');
                        if (!card) return;
                        card.classList.toggle('collapsed');
                    });
                });
            }
        } catch (_) {}
    }

    openMuseumFromOverview(){
        if (!Array.isArray(this.coins) || this.coins.length === 0){
            alert('Add at least one coin to enter Museum Mode.');
            return;
        }
        const visibleCoins = this.coins.filter(coin => this._coinMatchesSearch(coin));
        if (!visibleCoins.length){
            alert('No coins match the current search. Clear the search to open Museum Mode.');
            return;
        }
        let startId = null;
        if (this.selectedForPrint && this.selectedForPrint.size){
            const preferred = visibleCoins.find(c => this.selectedForPrint.has(c.id));
            if (preferred) startId = preferred.id;
        }
        this.openMuseumMode(startId || visibleCoins[0].id);
    }

    // Museum Mode
    openMuseumMode(coinId){
        const overlay = document.getElementById('museumOverlay');
        const stage = document.getElementById('museumStage');
        const imgs = overlay ? overlay.querySelectorAll('.museum-img') : null;
        const plaque = document.getElementById('museumPlaque');
        const toolbar = document.getElementById('museumToolbar');
        if (!overlay || !stage || !imgs || imgs.length<2 || !plaque || !toolbar) return;
        let startIdx = typeof coinId !== 'undefined' ? this.coins.findIndex(c=> c.id===coinId) : -1;
        if (startIdx < 0) startIdx = this.coins.length ? 0 : -1;
        if (startIdx < 0){
            alert('Add at least one coin to enter Museum Mode.');
            return;
        }
        const startCoinId = this.coins[startIdx]?.id;
        this._museum = {
            order:'random', list:[], index:0,
            face:'obv', currentFace:'obv', bg:'white', playing:false, speed:10000,
            timer:null, hideControlsTimer:null,
            _overlayEl:null, _onPointerShow:null, _onKeyDown:null, _onClickAdvance:null
        };
        this._museum.list = this._getMuseumList(this._museum.order);
        const seededIndex = startCoinId ? this._museum.list.findIndex(c=> c.id===startCoinId) : -1;
        this._museum.index = Math.max(0, seededIndex);
        overlay.classList.remove('hidden');
        // Default panel background white
        const panel = stage.querySelector('.museum-panel');
        if (panel){ panel.classList.remove('panel-white','panel-grey','panel-black'); panel.classList.add('panel-white'); }
        this._museumBindControls();
        this._museum.currentFace = this._museum.face;
        this._museumSetCoin(this._museum.index, true);
        this._museumShowControlsTemporarily();
        // Interactions to reveal controls
        const show = ()=> this._museumShowControlsTemporarily();
        overlay.addEventListener('mousemove', show);
        overlay.addEventListener('touchstart', show, { passive:true });
        // Keep refs for cleanup on exit
        this._museum._onPointerShow = show;
        this._museum._overlayEl = overlay;
        // Keyboard navigation
        const onKey = (e)=>{
            if (e.key==='Escape') { this._museumExit(); return; }
            if (e.key==='ArrowRight') { this._museumStep(1); }
            if (e.key==='ArrowLeft') { this._museumStep(-1); }
        };
        document.addEventListener('keydown', onKey);
        this._museum._onKeyDown = onKey;
        // Click anywhere on coin to advance
        const imgWrap = overlay.querySelector('.museum-img-wrap');
        if (imgWrap){
            const onClick = ()=> this._museumStep(1);
            imgWrap.addEventListener('click', onClick);
            this._museum._onClickAdvance = onClick;
        }
    }

    _museumBindControls(){
        const st = this._museum; if (!st) return;
        const playBtn = document.getElementById('museumPlayBtn');
        const speedSel = document.getElementById('museumSpeed');
        const bgSel = document.getElementById('museumBg');
        const faceSel = document.getElementById('museumFace');
        const orderSel = document.getElementById('museumOrder');
        const exitBtn = document.getElementById('museumExitBtn');
        if (playBtn){ playBtn.onclick = ()=>{ st.playing = !st.playing; playBtn.textContent = st.playing? 'Pause':'Play'; if (st.playing) this._museumStart(); else this._museumStop(); }; }
        if (speedSel){ speedSel.value=String(st.speed); speedSel.onchange = ()=>{ st.speed = parseInt(speedSel.value,10)||10000; if (st.playing){ this._museumStop(); this._museumStart(); } }; }
        if (bgSel){ bgSel.value=st.bg; bgSel.onchange = ()=>{ st.bg = bgSel.value; this._museumApplyBg(); }; }
        if (faceSel){ faceSel.value=st.face; faceSel.onchange = ()=>{ st.face = faceSel.value; st.currentFace = st.face; this._museumSetCoin(st.index, false, true); }; }
        if (orderSel){
            orderSel.value=st.order;
            orderSel.onchange = ()=>{
                const currentId = st.list[st.index]?.id;
                st.order = orderSel.value;
                st.list = this._getMuseumList(st.order);
                const idx = st.list.findIndex(c=> c.id===currentId);
                st.index = idx>=0 ? idx : 0;
                this._museumSetCoin(st.index, true);
            };
        }
        if (exitBtn){ exitBtn.onclick = ()=> this._museumExit(); }
    }

    _museumApplyBg(){
        const panel = document.querySelector('#museumStage .museum-panel'); if (!panel) return;
        panel.classList.remove('panel-white','panel-grey','panel-black');
        const st = this._museum; const cls = st.bg==='black'? 'panel-black' : (st.bg==='grey'? 'panel-grey':'panel-white');
        panel.classList.add(cls);
    }

    _museumShowControlsTemporarily(){
        const stage = document.getElementById('museumStage'); if (!stage) return;
        const st = this._museum; if (!st) return;
        stage.classList.add('show-controls');
        if (st.hideControlsTimer) clearTimeout(st.hideControlsTimer);
        st.hideControlsTimer = setTimeout(()=> stage.classList.remove('show-controls'), 2500);
    }

    _getMuseumList(order){
        const arr = this.coins.slice();
        const safeNum = (v)=>{ if (!v) return null; const n = Number(String(v).replace(/[^0-9\-]/g,'')); return isNaN(n)? null : n; };
        if (order==='date'){
            arr.sort((a,b)=>{
                const ay = a.struck_date?.exact?.from?.year || a.struck_date?.exact?.to?.year || safeNum(a.period_year) || 0;
                const by = b.struck_date?.exact?.from?.year || b.struck_date?.exact?.to?.year || safeNum(b.period_year) || 0;
                return (ay||0) - (by||0);
            });
        } else if (order==='mint'){
            const lab = (c)=> (typeof c.origin==='object')? (c.origin.label||'') : (c.origin||'');
            arr.sort((a,b)=> lab(a).localeCompare(lab(b)));
        } else if (order==='acq'){
            // Fallback: use id ascending if acquisition date not tracked
            arr.sort((a,b)=> (a.id||0) - (b.id||0));
        } else if (order==='random'){
            for (let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
        }
        return arr;
    }

    _museumSetCoin(index, immediate=false, faceOnly=false){
        const st = this._museum; if (!st) return;
        const overlay = document.getElementById('museumOverlay'); if (!overlay) return;
        const imgs = overlay.querySelectorAll('.museum-img'); if (!imgs || imgs.length<2) return;
        const plaque = document.getElementById('museumPlaque'); if (!plaque) return;
        const coin = st.list[index]; if (!coin) return;
        st.index = index;
        const faces = this._resolveCoinFaces(coin);
        const obv = faces.obv;
        const rev = faces.rev;
        const showingReverse = st.currentFace==='rev';
        const src = showingReverse ? rev : obv;
        // Crossfade
        const [imgA, imgB] = imgs;
        const currentVisible = imgA.classList.contains('visible') ? imgA : imgB;
        const nextImg = currentVisible===imgA ? imgB : imgA;
        if (!faceOnly || nextImg.getAttribute('src')!==src){
            nextImg.src = src;
            nextImg.classList.add('visible');
            currentVisible.classList.remove('visible');
        }
        const faceLabelNode = overlay.querySelector('[data-museum-face-label]');
        const faceTextNode = overlay.querySelector('[data-museum-face-text]');
        if (faceLabelNode) faceLabelNode.textContent = showingReverse ? 'Reverse' : 'Obverse';
        if (faceTextNode){
            const faceDescRaw = showingReverse ? coin.reverse : coin.obverse;
            const faceDesc = faceDescRaw ? this._typographyRefine(this._smartQuotes(faceDescRaw, true)) : '';
            faceTextNode.textContent = faceDesc || 'Tap to advance';
        }
        // Premium plaque content
        const mintRaw = (coin.origin && typeof coin.origin==='object')? (coin.origin.label||'') : (coin.origin||'');
        const mint = mintRaw ? this._smartQuotes(mintRaw,false) : '';
        const dateTextRaw = this._formatDateRange(coin.struck_date?.exact) || '';
        const dateText = this._typographyRefine(dateTextRaw);
        const material = this._materialLabel(coin.material);
        const denom = this._denominationFromName(coin.name||'');
        const materialWithCode = (()=>{
            if (!material) return '';
            const codeRaw = (coin.material && coin.material.code) ? String(coin.material.code).trim() : '';
            const code = codeRaw ? codeRaw.toUpperCase() : '';
            return code ? `${material} (${code})` : material;
        })();
        const rulerRaw = (coin.ruler && typeof coin.ruler==='object')? (coin.ruler.label||'') : (coin.ruler||'');
        const ruler = rulerRaw ? this._smartQuotes(rulerRaw,false) : '';
        // Info lines order: denomination, ruler, metal
        const infoArr = [denom, ruler, materialWithCode].filter(Boolean);
        const descFull = (coin.description && coin.description.trim().length>10) ? coin.description.trim() : '';
        const descTrunc = descFull && descFull.length>480 ? descFull.slice(0,477)+'…' : descFull;
        const descSmart = descTrunc ? this._typographyRefine(this._smartQuotes(descTrunc, true)) : '';
        const metaPieces = [dateText, mint].filter(Boolean);
        const metaLine = metaPieces.length? metaPieces.join(' \u00A0•\u00A0 ') : '';
        const titleSmart = this._smartQuotes(coin.name||'', false);
        plaque.innerHTML = `
            <div class="m-heading">
                <div class="m-collection-label">THE COLLECTION</div>
                <div class="m-line m-name">${this.escapeHtml(titleSmart||'')}</div>
                <div class="m-rule"></div>
            </div>
            ${metaLine? `<div class="m-line m-meta">${this.escapeHtml(metaLine)}</div>`:''}
            ${infoArr.length? `<div class="m-info-group">${infoArr.map(x=> `<div class="m-info-line">${this.escapeHtml(this._smartQuotes(x,false))}</div>`).join('')}</div>`:''}
            ${descSmart? `<div class="m-desc"><p>${this.escapeHtml(descSmart)}</p></div>`:''}
        `;
    }

    _museumHasTwoFaces(coin){
        if (!coin) return false;
        const faces = this._resolveCoinFaces(coin);
        return !!(faces.rev && faces.rev !== faces.obv);
    }

    _museumStep(dir){
        const st = this._museum; if (!st) return;
        const coin = st.list[st.index];
        const twoFaces = this._museumHasTwoFaces(coin);
        if (dir > 0){
            if (twoFaces && st.currentFace==='obv'){
                st.currentFace = 'rev';
                this._museumSetCoin(st.index, false, true);
                return;
            }
            // advance to next coin, reset to starting face
            const next = (st.index + 1) % st.list.length;
            st.currentFace = st.face || 'obv';
            this._museumSetCoin(next);
            return;
        } else {
            if (twoFaces && st.currentFace==='rev'){
                st.currentFace = 'obv';
                this._museumSetCoin(st.index, false, true);
                return;
            }
            // move to previous coin, show its reverse if available, else starting face
            const prev = (st.index - 1 + st.list.length) % st.list.length;
            const prevCoin = st.list[prev];
            st.currentFace = this._museumHasTwoFaces(prevCoin) ? 'rev' : (st.face || 'obv');
            this._museumSetCoin(prev);
            return;
        }
    }

    _museumStart(){
        const st = this._museum; if (!st) return;
        if (st.timer) clearInterval(st.timer);
        st.timer = setInterval(()=> this._museumStep(1), st.speed||10000);
    }

    _museumStop(){ const st = this._museum; if (st?.timer){ clearInterval(st.timer); st.timer=null; } }

    _museumExit(){
        const overlay = document.getElementById('museumOverlay'); if (!overlay) return;
        this._museumStop();
        // cleanup listeners
        if (this._museum?._overlayEl && this._museum?._onPointerShow){
            try { this._museum._overlayEl.removeEventListener('mousemove', this._museum._onPointerShow); } catch(e){}
            try { this._museum._overlayEl.removeEventListener('touchstart', this._museum._onPointerShow); } catch(e){}
        }
        if (this._museum?._onKeyDown){ try { document.removeEventListener('keydown', this._museum._onKeyDown); } catch(e){} }
        if (this._museum?._onClickAdvance && this._museum?._overlayEl){
            try { this._museum._overlayEl.querySelector('.museum-img-wrap')?.removeEventListener('click', this._museum._onClickAdvance); } catch(e){}
        }
        this._museum = null;
        overlay.classList.add('hidden');
    }

    _materialLabel(codeOrText){
        if (!codeOrText) return '';
        if (typeof codeOrText === 'object'){
            if (codeOrText.label) return String(codeOrText.label).trim();
            if (codeOrText.code) return this._materialLabel(codeOrText.code);
        }
        const raw = String(codeOrText).trim();
        const key = raw.toUpperCase();
        const map = { AR:'Silver', AV:'Gold', AE:'Bronze', EL:'Electrum', BI:'Billon', CU:'Copper' };
        if (map[key]) return map[key];
        return raw;
    }

    _denominationFromName(name){
        if (!name) return '';
        const toks = ['denarius','antoninianus','aureus','as','dupondius','sestertius','solidus','follis','drachm','tetradrachm','obol','stater','didrachm','victoriatus'];
        const lower = name.toLowerCase();
        for (const t of toks){
            const re = new RegExp(`(?:^|[^a-z])(${t})(?:[^a-z]|$)`,`i`);
            const m = lower.match(re);
            if (m) return t.charAt(0).toUpperCase()+t.slice(1);
        }
        return '';
    }

    _smartQuotes(str, wrapIfQuoted=false){
        if (!str) return '';
        let s = String(str);
        // Replace straight double quotes with “ and ” heuristically
        // Opening quotes: start of string or after whitespace/([{
        s = s.replace(/(^|[\s([{])"/g, '$1“');
        // Remaining quotes become closing
        s = s.replace(/"/g, '”');
        // Single quotes basic (avoid contractions)
        s = s.replace(/(^|[\s([{])'(?!\w)/g, '$1‘').replace(/'(?!\w)/g, '’');
        if (wrapIfQuoted && !/^“/.test(s)) s = '“' + s + (s.endsWith('”')? '' : '”');
        return s;
    }

    _typographyRefine(str){
        if (!str) return '';
        let s = String(str);
        // En-dash for ranges (space-hyphen-space)
        s = s.replace(/\s-\s/g, ' – ');
        // Ellipsis
        s = s.replace(/\.\.\./g, '…');
        // Normalize multiple spaces
        s = s.replace(/\s{2,}/g, ' ');
        return s.trim();
    }

    _initDetailViewTools(){
        const st = this._detailViewState || { view:'normal', intensity:60, bg:'none', magnifier:false, magSize:240, magFactor:3 };
        const intSel = document.getElementById('detailIntensity');
        const resetBtn = document.getElementById('detailResetBtn');
        const viewBtns = Array.from(document.querySelectorAll('.tool-views .tool-btn'));
        const bgBtns = Array.from(document.querySelectorAll('.tool-bg .swatch-btn'));
        const magBtn = document.getElementById('detailMagnifierBtn');
        const updateViewSelUI = ()=>{
            viewBtns.forEach(b=>{ const on = b.getAttribute('data-view')===st.view; b.setAttribute('aria-pressed', on?'true':'false'); b.classList.toggle('selected', on); });
        };
        const updateBgSelUI = ()=>{
            bgBtns.forEach(b=>{ const on = (b.getAttribute('data-bg')=== (st.bg||'none')); b.classList.toggle('selected', on); b.setAttribute('aria-pressed', on?'true':'false'); });
        };
        viewBtns.forEach(b=> b.onclick = ()=>{ st.view = b.getAttribute('data-view') || 'normal'; updateViewSelUI(); this._applyDetailViewStyles(); this._updateDetailIntensityDisabled(); });
        bgBtns.forEach(b=> b.onclick = ()=>{ st.bg = b.getAttribute('data-bg') || 'none'; updateBgSelUI(); this._applyDetailViewStyles(); });
        if (magBtn){ magBtn.onclick = ()=>{ st.magnifier = !st.magnifier; magBtn.classList.toggle('selected', st.magnifier); magBtn.setAttribute('aria-pressed', st.magnifier?'true':'false'); if (st.magnifier){ st.magSize=240; st.magFactor=3; this._updateMagnifierSize(240); this._updateMagnifierZoom(3); } this._setMagnifierEnabled(st.magnifier); }; }
        if (intSel){ intSel.value = String(st.intensity); intSel.oninput = ()=>{ st.intensity = parseInt(intSel.value,10)||0; this._applyDetailViewStyles(); }; }
        if (resetBtn){ resetBtn.onclick = ()=>{ st.view='normal'; st.intensity=60; st.bg='none'; st.magnifier=false; st.magSize=240; st.magFactor=3; updateViewSelUI(); updateBgSelUI(); if(intSel) intSel.value='60'; if(magBtn){ magBtn.classList.remove('selected'); magBtn.setAttribute('aria-pressed','false'); } this._applyDetailViewStyles(); this._updateDetailIntensityDisabled(); this._setMagnifierEnabled(false); this._updateMagnifierSize(240); this._updateMagnifierZoom(3); }; }
        updateViewSelUI();
        updateBgSelUI();
        this._applyDetailViewStyles();
        this._updateDetailIntensityDisabled();
        this._attachMagnifierHandlers();
    }

    _applyDetailViewStyles(){
        const st = this._detailViewState || { view:'normal', intensity:60, bg:'none' };
        const wraps = document.querySelectorAll('.hero-images .face-media, .modal-media .img-wrap');
        const imgs = document.querySelectorAll('.hero-images .img-main, .modal-media .img-main');
        const filter = this._computeFilter(st.view, st.intensity);
        wraps.forEach(w => {
            let bg = '';
            if (st.bg==='bg-grey') bg = '#d4d4d4';
            else if (st.bg==='bg-warm') bg = '#f4e8d2';
            else if (st.bg==='bg-teal') bg = '#0d3a4a';
            else if (st.bg==='bg-charcoal') bg = '#2a2a2a';
            w.style.background = bg || '';
        });
        imgs.forEach(img => {
            if (st.view==='paper') { img.style.mixBlendMode = 'multiply'; img.style.filter = ''; }
            else { img.style.mixBlendMode = ''; img.style.filter = filter; }
        });
    }

    _updateDetailIntensityDisabled(){
        const st = this._detailViewState || null; const intSel = document.getElementById('detailIntensity'); if (!intSel || !st) return;
        const supports = ['edge'];
        const disable = !supports.includes(st.view);
        intSel.disabled = disable; intSel.style.opacity = disable? '0.4':'1';
    }

    _ensureMagnifier(){
        if (this._magnifierLens) return this._magnifierLens;
        const d = document.createElement('div');
        d.className = 'magnifier-lens';
        d.style.display = 'none';
        const img = document.createElement('img');
        img.className = 'magnifier-img';
        img.style.position = 'absolute';
        img.style.left = '0';
        img.style.top = '0';
        img.style.transformOrigin = '0 0';
        img.style.userSelect = 'none';
        img.style.pointerEvents = 'none';
        d.appendChild(img);
        document.body.appendChild(d);
        this._magnifierLens = d;
        this._magnifierImg = img;
        return d;
    }
    _attachMagnifierHandlers(){
        const imgs = document.querySelectorAll('.hero-images .img-main');
        const lens = this._ensureMagnifier();
        const move = (img, ev)=>{
            if (!this._detailViewState?.magnifier) return;
            const rect = img.getBoundingClientRect();
            const size = this._detailViewState.magSize || 140;
            const s = this._detailViewState.magFactor || 1.8;
            const x = Math.max(rect.left, Math.min(ev.clientX, rect.right));
            const y = Math.max(rect.top, Math.min(ev.clientY, rect.bottom));
            const lx = x - size/2; const ly = y - size/2;
            lens.style.width = size + 'px'; lens.style.height = size + 'px';
            lens.style.left = Math.round(lx) + 'px'; lens.style.top = Math.round(ly) + 'px';
            // Match background from wrapper to preserve blend effects
            try {
                const wrap = img.closest('.face-media');
                const bg = wrap ? window.getComputedStyle(wrap).backgroundColor : '';
                lens.style.background = bg || '';
            } catch(_){ lens.style.background = ''; }
            // Prepare inner magnified image with same filtering as source
            if (this._magnifierImg){
                this._magnifierImg.src = img.src;
                this._magnifierImg.style.width = rect.width + 'px';
                this._magnifierImg.style.height = rect.height + 'px';
                this._magnifierImg.style.filter = img.style.filter || '';
                this._magnifierImg.style.mixBlendMode = img.style.mixBlendMode || '';
                const px = x - rect.left;
                const py = y - rect.top;
                const tx = (size/2) - px * s;
                const ty = (size/2) - py * s;
                this._magnifierImg.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${s})`;
            }
            lens.style.display = 'block';
        };
        imgs.forEach(img=>{
            img.addEventListener('mouseenter', (e)=>{ if (this._detailViewState?.magnifier) { this._ensureMagnifier(); } });
            img.addEventListener('mousemove', (e)=> move(img, e));
            img.addEventListener('mouseleave', ()=>{ if (this._magnifierLens) this._magnifierLens.style.display='none'; });
        });
    }
    _setMagnifierEnabled(on){ if (!on && this._magnifierLens) this._magnifierLens.style.display='none'; }
    _updateMagnifierSize(px){ if (this._magnifierLens) { this._magnifierLens.style.width = px+'px'; this._magnifierLens.style.height = px+'px'; } }
    _updateMagnifierZoom(f){ /* state-only; next mousemove applies */ }

    // Open Compare Mode; coinA required, coinB optional
    openCompare(coinAId, coinBId, promptB=false){
        const overlay = document.getElementById('compareOverlay');
        const panel = document.getElementById('comparePanel');
        const wrapA = document.querySelector('#compareSideA .compare-image-wrap');
        const wrapB = document.querySelector('#compareSideB .compare-image-wrap');
        const selA = document.getElementById('compareSelectA');
        const selB = document.getElementById('compareSelectB');
        const tableHost = document.getElementById('compareTableHost');
        if (!overlay || !panel || !wrapA || !wrapB || !selA || !selB || !tableHost) return;
        const coinA = this.coins.find(c=> c.id === coinAId); if (!coinA) return;
        let coinB = (coinBId!=null) ? this.coins.find(c=> c.id===coinBId) : null;
        if (!coinB && !promptB){
            coinB = this.coins.find(c=> c.id !== coinAId) || coinA;
        }
        this._compareState = { aId: coinA.id, bId: coinB? coinB.id : null, mode:'obv', view:'normal', bg:'none', intensity:60, fullscreen:false, zoom:{scale:1,x:0,y:0}, dragging:false, dragOrigin:null };
        overlay.classList.remove('hidden');
        this._populateCompareSelect(selA, coinA.id);
        this._populateCompareSelect(selB, coinB? coinB.id : null, coinA.id, { placeholder:true });
        this._renderCompareImages();
        this._renderComparisonTable();
        this._wireCompareTools();
        // Close handlers
        const close = ()=> { overlay.classList.add('hidden'); }; 
        document.getElementById('closeCompareBtn')?.addEventListener('click', close, { once:true });
        overlay.addEventListener('click', (e)=>{ if (e.target===overlay) close(); });
        document.addEventListener('keydown', (e)=>{ if (e.key==='Escape') close(); }, { once:true });
    }

    // Open Compare with no preselected coins
    openCompareBlank(){
        const overlay = document.getElementById('compareOverlay');
        const panel = document.getElementById('comparePanel');
        const wrapA = document.querySelector('#compareSideA .compare-image-wrap');
        const wrapB = document.querySelector('#compareSideB .compare-image-wrap');
        const selA = document.getElementById('compareSelectA');
        const selB = document.getElementById('compareSelectB');
        const tableHost = document.getElementById('compareTableHost');
        if (!overlay || !panel || !wrapA || !wrapB || !selA || !selB || !tableHost) return;
        this._compareState = { aId: null, bId: null, mode:'obv', view:'normal', bg:'none', intensity:60, fullscreen:false, zoom:{scale:1,x:0,y:0}, dragging:false, dragOrigin:null };
        overlay.classList.remove('hidden');
        this._populateCompareSelect(selA, null, undefined, { placeholder:true });
        this._populateCompareSelect(selB, null, null, { placeholder:true });
        // Placeholders in image areas
        wrapA.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:0.9rem;">Select coin A to compare</div>`;
        wrapB.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:0.9rem;">Select coin B to compare</div>`;
        // Table guidance
        tableHost.innerHTML = `<div style="padding:12px;color:#6b7280;">Select coins to see technical and iconography comparison.</div>`;
        this._wireCompareTools();
        // Close handlers
        const close = ()=> { overlay.classList.add('hidden'); };
        document.getElementById('closeCompareBtn')?.addEventListener('click', close, { once:true });
        overlay.addEventListener('click', (e)=>{ if (e.target===overlay) close(); });
        document.addEventListener('keydown', (e)=>{ if (e.key==='Escape') close(); }, { once:true });
    }

    _populateCompareSelect(sel, selectedId, excludeId, opts={}){
        if (!sel) return;
        const options = this.coins.filter(c=> excludeId? c.id!==excludeId : true).map(c=> `<option value="${c.id}" ${c.id===selectedId?'selected':''}>${this.escapeHtml(c.name)}</option>`);
        if (opts.placeholder){ options.unshift(`<option value="" ${selectedId? '':'selected'} disabled>Select coin…</option>`); }
        sel.innerHTML = options.join('');
        sel.onchange = ()=>{
            const st = this._compareState; if (!st) return;
            const newId = parseInt(sel.value,10);
            if (sel.id==='compareSelectA'){ st.aId = newId; if (st.aId===st.bId){ const other = this.coins.find(c=> c.id!==st.aId); if (other) st.bId=other.id; }}
            else { st.bId = newId; if (st.aId===st.bId){ const other = this.coins.find(c=> c.id!==st.aId); if (other) st.bId=other.id; }}
            this._populateCompareSelect(document.getElementById('compareSelectA'), st.aId);
            this._populateCompareSelect(document.getElementById('compareSelectB'), st.bId, st.aId, { placeholder:true });
            this._renderCompareImages();
            this._renderComparisonTable();
        };
        // if prompting B selection, focus it
        if (opts.placeholder && sel.id==='compareSelectB' && !selectedId){ sel.focus(); }
    }

    _wireCompareTools(){
        const st = this._compareState; if (!st) return;
        const modes = ['compareSideObvBtn','compareSideRevBtn'];
        modes.forEach(id=>{
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.onclick = ()=>{
                const mode = btn.getAttribute('data-mode');
                st.mode = mode;
                modes.forEach(i=>{ const b=document.getElementById(i); if (b){ b.setAttribute('aria-pressed', b===btn?'true':'false'); }});
                this._renderCompareImages();
            };
        });
        const fsBtn = document.getElementById('compareFullscreenBtn');
        if (fsBtn){ fsBtn.onclick = ()=>{ st.fullscreen = !st.fullscreen; document.getElementById('comparePanel')?.classList.toggle('fullscreen', st.fullscreen); }; }
        // Reset only zoom/pan and face mode
        const resetBtn = document.getElementById('compareResetBtn');
        if (resetBtn){ resetBtn.onclick = ()=>{ st.zoom = { scale:1, x:0, y:0 }; st.mode='obv'; document.getElementById('compareSideObvBtn')?.setAttribute('aria-pressed','true'); document.getElementById('compareSideRevBtn')?.setAttribute('aria-pressed','false'); this._applyCompareTransforms(); this._renderCompareImages(); }; }
        // Zoom/pan handlers
        const wraps = [document.querySelector('#compareSideA .compare-image-wrap'), document.querySelector('#compareSideB .compare-image-wrap')];
        wraps.forEach(w=>{
            if (!w) return;
            w.onwheel = (e)=>{ e.preventDefault(); const delta = e.deltaY<0? 0.08 : -0.08; st.zoom.scale = Math.min(8, Math.max(0.4, st.zoom.scale + delta)); this._applyCompareTransforms(); };
            w.onmousedown = (e)=>{ st.dragging = true; st.dragOrigin = { x:e.clientX, y:e.clientY, ox:st.zoom.x, oy:st.zoom.y }; w.style.cursor='grabbing'; };
            window.addEventListener('mouseup', ()=>{ st.dragging=false; w.style.cursor='grab'; });
            window.addEventListener('mousemove', (e)=>{ if (!st.dragging) return; const dx = e.clientX - st.dragOrigin.x; const dy = e.clientY - st.dragOrigin.y; st.zoom.x = st.dragOrigin.ox + dx; st.zoom.y = st.dragOrigin.oy + dy; this._applyCompareTransforms(); });
        });
        this._wireCompareImageClicks();
    }

    _applyCompareTransforms(){
        const st = this._compareState; if (!st) return;
        const imgs = document.querySelectorAll('.compare-image-wrap img');
        imgs.forEach(img=>{ img.style.transform = `translate(calc(-50% + ${st.zoom.x}px), calc(-50% + ${st.zoom.y}px)) scale(${st.zoom.scale})`; });
    }

    // Compare no longer applies view/background filters

    _computeFilter(view, intensity){
        const t = Math.max(0, Math.min(100, intensity||0)) / 100;
        if (view==='study'){
            const c = (1 + 0.4*t).toFixed(2);
            const b = (1 + 0.05*t).toFixed(2);
            return `grayscale(1) contrast(${c}) brightness(${b})`;
        }
        if (view==='metal'){
            const s = (1 - 0.3*t).toFixed(2);
            const c = (1 + 0.25*t).toFixed(2);
            const b = (1 + 0.03*t).toFixed(2);
            return `saturate(${s}) contrast(${c}) brightness(${b})`;
        }
        if (view==='edge'){
            const c = (1 + 0.6*t).toFixed(2);
            const b = (1 + 0.08*t).toFixed(2);
            const s = (1 - 0.2*t).toFixed(2);
            const ds = (2 + 3*t).toFixed(1);
            return `grayscale(0.15) contrast(${c}) brightness(${b}) saturate(${s}) drop-shadow(0 0 ${ds}px rgba(0,0,0,0.35))`;
        }
        if (view==='invert'){
            return 'invert(1) contrast(1.2)';
        }
        return '';
    }

    // Intensity control removed in Compare mode

    _wireCompareImageClicks(){
        const st = this._compareState; if (!st) return;
        const wrapA = document.querySelector('#compareSideA .compare-image-wrap');
        const wrapB = document.querySelector('#compareSideB .compare-image-wrap');
        const coinA = this.coins.find(c=> c.id===st.aId);
        const coinB = st.bId? this.coins.find(c=> c.id===st.bId) : null;
        const pickFace = (coin)=>{
            if (!coin) return [];
            const faces = this._resolveCoinFaces(coin);
            if (st.mode==='rev') return [faces.rev];
            return [faces.obv];
        };
        if (wrapA){ wrapA.style.cursor='zoom-in'; wrapA.onclick = ()=>{ const imgs = pickFace(coinA); if (imgs.length) this.openImageLightbox(imgs,0); }; }
        if (wrapB && coinB){ wrapB.style.cursor='zoom-in'; wrapB.onclick = ()=>{ const imgs = pickFace(coinB); if (imgs.length) this.openImageLightbox(imgs,0); }; }
    }

    _renderCompareImages(){
        const st = this._compareState; if (!st) return;
        const wrapA = document.querySelector('#compareSideA .compare-image-wrap');
        const wrapB = document.querySelector('#compareSideB .compare-image-wrap');
        if (!wrapA || !wrapB) return;
        const coinA = st.aId!=null ? this.coins.find(c=> c.id===st.aId) : null;
        const coinB = st.bId!=null ? this.coins.find(c=> c.id===st.bId) : null;
        const mode = st.mode;
        const buildImgs = (obv, rev, sideLabel)=>{
            if (mode==='obv') return `<img data-face="obv" src="${obv}" alt="${this.escapeHtml(sideLabel)} obverse">`;
            if (mode==='rev') return `<img data-face="rev" src="${rev}" alt="${this.escapeHtml(sideLabel)} reverse">`;
            return `<img src="${obv}" alt="${this.escapeHtml(sideLabel)}">`;
        };
        if (!coinA){
            wrapA.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:0.9rem;">Select coin A to compare</div>`;
        } else {
            const facesA = this._resolveCoinFaces(coinA);
            wrapA.innerHTML = buildImgs(facesA.obv, facesA.rev, 'A');
        }
        if (!coinB){
            wrapB.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:0.9rem;">Select coin B to compare</div>`;
        } else {
            const facesB = this._resolveCoinFaces(coinB);
            wrapB.innerHTML = buildImgs(facesB.obv, facesB.rev, 'B');
        }
        this._applyCompareTransforms();
    }

    _renderComparisonTable(){
        const st = this._compareState; if (!st) return;
        const tableHost = document.getElementById('compareTableHost'); if (!tableHost) return;
        const a = st.aId!=null ? this.coins.find(c=> c.id===st.aId) : null; const b = st.bId!=null ? this.coins.find(c=> c.id===st.bId) : null;
        if (!a){
            tableHost.innerHTML = `<div style="padding:12px;color:#6b7280;">Select coins to see technical and iconography comparison.</div>`;
            return;
        }
        const normNum = v=>{ if (v==null||v==='') return null; const n=parseFloat(String(v).replace(/[^0-9.\-]/g,'')); return isNaN(n)? null : n; };
        const diffClassNum = (va,vb,{absMm=3, pct=0.15}={})=>{ if (va==null||vb==null) return ''; const d=Math.abs(va-vb); const p = d/Math.max(va,vb); return (d>=absMm || p>=pct)? 'diff-high':''; };
        const weightA = normNum(a.weight); const weightB = b? normNum(b.weight) : null;
        const diamA = normNum(a.diameter); const diamB = b? normNum(b.diameter) : null;
        const matA = (a.material && typeof a.material==='object')? (a.material.label||'') : (a.material||'');
        const matB = b? ((b.material && typeof b.material==='object')? (b.material.label||'') : (b.material||'')) : '';
        const rulerA = (typeof a.ruler==='object')? (a.ruler.label||'') : (a.ruler||'');
        const rulerB = b? ((typeof b.ruler==='object')? (b.ruler.label||'') : (b.ruler||'')) : '';
        const originA = (typeof a.origin==='object')? (a.origin.label||'') : (a.origin||'');
        const originB = b? ((typeof b.origin==='object')? (b.origin.label||'') : (b.origin||'')) : '';
        const periodA = (typeof a.period==='object')? (a.period.label||'') : (a.period||'');
        const periodB = b? ((typeof b.period==='object')? (b.period.label||'') : (b.period||'')) : '';
        const refsA = this._combinedReferencesText(a); const refsB = b? this._combinedReferencesText(b) : '';
        // Iconography similarity
        const tokens = s=> new Set(String(s||'').toLowerCase().split(/[^a-z0-9]+/).filter(w=> w.length>2 && !['and','the','with','for','from','into','over','under','between','left','right','above','below','behind','front','reverse','obverse','legend','showing','holding','standing'].includes(w)));
        const iconA = new Set([...tokens(a.obverse), ...tokens(a.reverse)]);
        const iconB = b? new Set([...tokens(b.obverse), ...tokens(b.reverse)]) : new Set();
        const inter = new Set([...iconA].filter(x=> iconB.has(x))); const union = new Set([...iconA, ...iconB]);
        const similarity = b? (union.size? Math.round((inter.size/union.size)*100) : 0) : 0;
        const meterClass = similarity>=70? 'high': similarity>=35? 'medium':'low';
        const overlapStr = b? (inter.size? Array.from(inter).slice(0,6).join(', ') : '—') : 'Select coin B to compute similarity';
        const iconRow = `<div class="compare-meter ${meterClass}">${b? similarity+'% similar':'—'}</div><div style="font-size:0.75rem;color:#555;margin-top:4px;">${this.escapeHtml(overlapStr)}</div>`;
        const row = (label, va, vb, cls='')=> `<tr class="${cls}"><th class="cell-label">${this.escapeHtml(label)}</th><td>${this.escapeHtml(va||'—')}</td><td>${this.escapeHtml(vb||'—')}</td></tr>`;
        const numRow = (label, va, vb, unit, cls) => {
            const formatNum = v => v==null? null : (Number.isInteger(v)? v : Math.round(v*100)/100);
            const fa = formatNum(va); const fb = formatNum(vb);
            return row(label,
                fa!=null? `${fa} ${unit}`:'',
                fb!=null? `${fb} ${unit}`:'',
                cls
            );
        };
        const textRow = (label, va, vb, cls='') => row(label, va||'', vb||'', cls);

        const rows = [
            numRow('Weight', weightA, weightB, 'g', diffClassNum(weightA, weightB, { absMm: 0.4, pct: 0.06 })),
            numRow('Diameter', diamA, diamB, 'mm', diffClassNum(diamA, diamB, { absMm: 1.5, pct: 0.08 })),
            textRow('Metal', matA, matB),
            textRow('Ruler / Authority', rulerA, rulerB),
            textRow('Origin', originA, originB),
            textRow('Period', periodA, periodB),
            row('References', refsA, refsB)
        ];
        rows.push(`<tr class="iconography-row"><th class="cell-label">Iconography Overlap</th><td colspan="2">${iconRow}</td></tr>`);
        tableHost.innerHTML = `<table class="compare-table"><tbody>${rows.join('')}</tbody></table>`;
    }

    // Extract known type-series URIs or infer CRRO IDs from reference text
    _extractTypeSeriesFromReferences(refText) {
        if (!refText) return [];
        const out = new Set();
        const ocreRe = /https?:\/\/numismatics\.org\/ocre\/id\/[^\s,;\)\]]+/gi;
        let m;
        while ((m = ocreRe.exec(refText)) !== null) out.add(m[0]);
        const crroRe = /https?:\/\/numismatics\.org\/crro\/id\/[^\s,;\)\]]+/gi;
        while ((m = crroRe.exec(refText)) !== null) out.add(m[0]);
        // Greek/other ANS series IDs
        const pellaRe = /https?:\/\/numismatics\.org\/pella\/id\/[^\s,;\)\]]+/gi;
        while ((m = pellaRe.exec(refText)) !== null) out.add(m[0]);
        const scoRe = /https?:\/\/numismatics\.org\/sco\/id\/[^\s,;\)\]]+/gi;
        while ((m = scoRe.exec(refText)) !== null) out.add(m[0]);
        const pcoRe = /https?:\/\/numismatics\.org\/pco\/id\/[^\s,;\)\]]+/gi;
        while ((m = pcoRe.exec(refText)) !== null) out.add(m[0]);
        // Crawford / RRC numeric references -> CRRO inferred URI
        const crawfordRe = /\b(?:RRC|Crawford)\s*(\d{1,4})([ABab]?)/g;
        while ((m = crawfordRe.exec(refText)) !== null) {
            const num = m[1];
            out.add(`https://numismatics.org/crro/id/rrc-${num}`);
        }
        return Array.from(out);
    }
    _structuredRefsCombinedForExtraction(coin){
        if (!coin) return '';
        const structured = Array.isArray(coin.referencesStructured)? coin.referencesStructured.map(r=> r.formatted).join('; ') : '';
        const free = coin.references || '';
        return [structured, free].filter(Boolean).join('; ');
    }
    _formatStructuredRef(r){
        if (!r || !r.authority) return '';
        const a = r.authority.toUpperCase();
        if (a==='RIC') {
            // Desired order: RIC <volume> <number> <authority/section>
            const parts = ['RIC'];
            if (r.volume) parts.push(r.volume);
            if (r.number) parts.push(String(r.number));
            if (r.suffix) parts.push(String(r.suffix));
            return parts.join(' ').replace(/\s+/g,' ').trim();
        }
        if (a==='RRC' || a==='CRAWFORD') return ['RRC', r.number].filter(Boolean).join(' ');
        if (a==='CPE') return ['CPE', r.volume, r.number].filter(Boolean).join(' ');
        if (a==='HGC') return ['HGC', r.volume, r.number? (', '+r.number):''].filter(Boolean).join(' ').replace(/\s+,/,' ,');
        if (a==='SNG') return ['SNG', r.series, r.number].filter(Boolean).join(' ');
        if (a==='OTHER') return [r.customAuthority||'Other', r.number].filter(Boolean).join(' ');
        return '';
    }
    _enrichmentUrlForRef(r){
        if (!r) return null;
        if (r.authority==='RIC') return `https://numismatics.org/ocre/results?q=${encodeURIComponent(r.formatted)}`;
        if (r.authority==='RRC') return `https://numismatics.org/crro/results?q=${encodeURIComponent(r.number||'')}`;
        if (r.authority==='CPE') return `https://numismatics.org/pco/results?q=${encodeURIComponent(r.formatted)}`;
        if (r.authority && String(r.authority).toUpperCase()==='HGC') return `https://numismatics.org/search/results?q=${encodeURIComponent(r.formatted)}`;
        if (r.authority && String(r.authority).toUpperCase()==='SNG') return `https://numismatics.org/search/results?q=${encodeURIComponent(r.formatted)}`;
        return null;
    }
    // Best-effort resolver: find canonical OCRE type URI from a RIC structured ref
    async _resolveOcreFromRicRef(ref){
        try {
            if (!ref || String(ref.authority).toUpperCase()!=='RIC') return null;
            const q = encodeURIComponent(this._formatStructuredRef(ref));
            const candidates = [
                `https://numismatics.org/ocre/results?q=${q}&format=json`,
                `https://numismatics.org/ocre/apis?q=${q}`,
                `https://numismatics.org/ocre/results?q=${q}`
            ];
            const reCanon = /https?:\/\/numismatics\.org\/ocre\/id\/ric\.[^"'<>\s]+/i;
            for (const url of candidates){
                try {
                    if (this._debug) console.debug('ocre:resolve try', url);
                    const res = await this._fetchWithTimeout(url, { timeout: 12000, retries: 1, init: { headers: { Accept: 'application/json, application/atom+xml, text/html;q=0.5, */*;q=0.1' } }, throwOnHTTPError: false });
                    if (!res || (!res.ok && res.status!==200)) { if (this._debug) console.debug('ocre:resolve http', res && res.status); continue; }
                    const ct = (res.headers.get('content-type')||'').toLowerCase();
                    const body = await res.text();
                    const m = body.match(reCanon);
                    if (m && m[0]) { if (this._debug) console.debug('ocre:resolve matched', m[0]); return m[0]; }
                } catch(_) { /* try next */ }
            }
            return null;
        } catch(_) { return null; }
    }
    _parseOcreIdFromUri(uri){
        try { const m = String(uri||'').match(/\/ocre\/id\/([^\s#?]+)/i); return m? m[1] : null; } catch(_) { return null; }
    }
    async _fetchOcreTypeData(ocreUri){
        const base = String(ocreUri||'').replace(/[#?].*$/,'');
        const tries = [
            { url: base.endsWith('.jsonld') ? base : base + '.jsonld', hdrs: { Accept: 'application/ld+json, application/json;q=0.9, */*;q=0.1' } },
            { url: base, hdrs: { Accept: 'application/ld+json' } }
        ];
        let data = null, lastErr = null, usedUrl = null, ctSeen = null;
        for (const t of tries){
            try {
                if (this._debug) console.debug('ocre:type fetch try', t.url, t.hdrs);
                const res = await this._fetchWithTimeout(t.url, { timeout: 15000, retries: 0, init: { headers: t.hdrs }, throwOnHTTPError: false });
                if (!res || !res.ok) { lastErr = new Error('HTTP '+(res?res.status:'?')); if (this._debug) console.debug('ocre:type fetch http', res && res.status); continue; }
                const ct = (res.headers.get('content-type')||''); ctSeen = ct; usedUrl = t.url;
                if (!/json/i.test(ct)) { lastErr = new Error('Not JSON: '+ct); if (this._debug) console.debug('ocre:type fetch not json', ct); continue; }
                data = await res.json();
                break;
            } catch (e) { lastErr = e; if (this._debug) console.debug('ocre:type fetch error', e && e.message); }
        }
        if (!data) throw lastErr || new Error('OCRE JSON-LD unavailable');
        if (this._debug) console.debug('ocre:type got JSON-LD', { url: usedUrl, contentType: ctSeen });
        const graph = Array.isArray(data['@graph']) ? data['@graph'] : [data];
        if (this._debug) console.debug('ocre:type graph size', graph.length);
        const mainId = base;
        const byId = new Map(); graph.forEach(n=>{ if (n && n['@id']) byId.set(n['@id'], n); });
        const pick = (obj, keys)=>{ for (const k of keys){ if (obj && obj[k]!=null) return obj[k]; } return null; };
        const getEn = (v)=>{
            if (v==null) return '';
            if (Array.isArray(v)){
                const en = v.find(x=> x['@language']==='en') || v[0];
                return (en && (en['@value']||en['value']||'')) || '';
            }
            if (typeof v==='object') return v['@value'] || v.value || '';
            return String(v||'');
        };
        const getLabel = (node)=> getEn(pick(node, ['http://www.w3.org/2004/02/skos/core#prefLabel','skos:prefLabel','label']));
        const norm = (s)=> String(s||'').replace(/^https?:/i,'').split('#')[0];
        const baseNorm = norm(mainId);
        const slug = mainId.split('/').pop();
        const firstRefId = (r)=>{ if (!r) return null; if (Array.isArray(r)){ const it=r[0]; return (typeof it==='object')? it['@id'] : String(it); } return (typeof r==='object')? r['@id'] : String(r); };
        const prettyFromUri = (u)=>{ try { const s = String(u||'').split('/').pop().replace(/_/g,' '); return s ? (s.charAt(0).toUpperCase()+s.slice(1)) : ''; } catch(_) { return ''; } };
        let refNode = null;
        // Exact match (http/https/fragment-insensitive)
        refNode = graph.find(n => norm(n['@id']) === baseNorm) || null;
        // Ends-with slug
        if (!refNode) refNode = graph.find(n => {
            const id = String(n['@id']||'');
            return id.endsWith('/'+slug) || id.endsWith('/id/'+slug) || norm(id).endsWith('/id/'+slug);
        }) || null;
        // Node with type-side properties
        if (!refNode) refNode = graph.find(n => {
            const hasObv = !!(n['http://nomisma.org/ontology#hasObverse'] || n['nmo:hasObverse']);
            const hasRev = !!(n['http://nomisma.org/ontology#hasReverse'] || n['nmo:hasReverse']);
            const id = String(n['@id']||'');
            return (hasObv || hasRev) && /numismatics\.org\/ocre\/id\//i.test(id);
        }) || null;
        // Any OCRE id node as last resort
        if (!refNode) refNode = graph.find(n => /numismatics\.org\/ocre\/id\//i.test(String(n['@id']||''))) || null;
        if (!refNode) { if (this._debug) console.debug('ocre:type node not found for', mainId, 'fallbacks exhausted'); throw new Error('Type node not found'); }
        if (this._debug) console.debug('ocre:type primary node', refNode['@id']);
        const takeRefLabel = (node, props)=>{
            const raw = pick(node, props);
            const ids = Array.isArray(raw) ? raw : (raw? [raw] : []);
            for (const it of ids){ const id = (typeof it==='object' ? it['@id'] : String(it)); if (!id) continue; const n = byId.get(id); if (n){ const lbl=getLabel(n); if (lbl) return lbl; } }
            return '';
        };
        const label = getLabel(refNode) || this._parseOcreIdFromUri(mainId) || 'OCRE Type';
        const temporalStr = getEn(pick(refNode, ['http://purl.org/dc/terms/temporal','dcterms:temporal'])) || '';
        const denomination = takeRefLabel(refNode, ['http://nomisma.org/ontology#hasDenomination','nmo:hasDenomination']);
        const mint = takeRefLabel(refNode, ['http://nomisma.org/ontology#hasMint','nmo:hasMint']);
        const authority = takeRefLabel(refNode, ['http://nomisma.org/ontology#hasAuthority','nmo:hasAuthority']);
        const obvRef = pick(refNode, ['http://nomisma.org/ontology#hasObverse','nmo:hasObverse']);
        const revRef = pick(refNode, ['http://nomisma.org/ontology#hasReverse','nmo:hasReverse']);
        const obvNode = byId.get(firstRefId(obvRef));
        const revNode = byId.get(firstRefId(revRef));
        const obvLegend = obvNode ? getEn(pick(obvNode, ['http://nomisma.org/ontology#hasLegend','nmo:hasLegend','legend'])) : '';
        const obvType = obvNode ? (getEn(pick(obvNode, ['http://nomisma.org/ontology#hasTypeDescription','nmo:hasTypeDescription','dcterms:description','type'])) || '') : '';
        const revLegend = revNode ? getEn(pick(revNode, ['http://nomisma.org/ontology#hasLegend','nmo:hasLegend','legend'])) : '';
        const revType = revNode ? (getEn(pick(revNode, ['http://nomisma.org/ontology#hasTypeDescription','nmo:hasTypeDescription','dcterms:description','type'])) || '') : '';

        // Denomination, Mint, Authority, Material, Manufacture: prefer in-graph label, else fallback to URI slug
        const denomRef = pick(refNode, ['http://nomisma.org/ontology#hasDenomination','nmo:hasDenomination']);
        const mintRef = pick(refNode, ['http://nomisma.org/ontology#hasMint','nmo:hasMint']);
        const authRef = pick(refNode, ['http://nomisma.org/ontology#hasAuthority','nmo:hasAuthority']);
        const matRef  = pick(refNode, ['http://nomisma.org/ontology#hasMaterial','nmo:hasMaterial']);
        const manufRef= pick(refNode, ['http://nomisma.org/ontology#hasManufacture','nmo:hasManufacture']);

        const denomId = firstRefId(denomRef); const denomLbl = denomId ? (getLabel(byId.get(denomId)) || prettyFromUri(denomId)) : '';
        const mintId  = firstRefId(mintRef);  const mintLbl  = mintId  ? (getLabel(byId.get(mintId))  || prettyFromUri(mintId))  : '';
        const authId  = firstRefId(authRef);  const authLbl  = authId  ? (getLabel(byId.get(authId))  || prettyFromUri(authId))  : '';
        const matId   = firstRefId(matRef);   const matLbl   = matId   ? (getLabel(byId.get(matId))   || prettyFromUri(matId))   : '';
        const manufId = firstRefId(manufRef); const manufLbl = manufId ? (getLabel(byId.get(manufId)) || prettyFromUri(manufId)) : '';

        // Date: prefer explicit start/end years if present
        const start = pick(refNode, ['http://nomisma.org/ontology#hasStartDate','nmo:hasStartDate']);
        const end   = pick(refNode, ['http://nomisma.org/ontology#hasEndDate','nmo:hasEndDate']);
        const yearVal = (v)=>{
            const val = Array.isArray(v) ? v[0] : v; if (!val) return '';
            const raw = (typeof val==='object') ? (val['@value'] || val.value || '') : String(val);
            const m = String(raw).match(/-?\d+/); if (!m) return '';
            const n = parseInt(m[0],10); if (!isFinite(n)) return '';
            return String(Math.abs(n));
        };
        const y1 = yearVal(start), y2 = yearVal(end);
        const date = y1 && y2 ? (y1===y2 ? y1 : `${y1} – ${y2}`) : (y1 || y2 || temporalStr);

        const result = {
            label,
            date,
            denomination: denomLbl,
            denominationUrl: denomId || '',
            denominationDesc: '',
            mint: mintLbl,
            mintUrl: mintId || '',
            mintDesc: '',
            authority: authLbl,
            authorityUrl: authId || '',
            authorityDesc: '',
            material: matLbl,
            materialUrl: matId || '',
            materialDesc: '',
            manufacture: manufLbl,
            manufactureUrl: manufId || '',
            manufactureDesc: '',
            obvLegend, obvType, revLegend, revType
        };
        // Enrich Nomisma-linked concept labels and short descriptions (structured-only)
        try {
            const targets = [
                { k: 'denomination', id: denomId },
                { k: 'mint', id: mintId },
                { k: 'authority', id: authId },
                { k: 'material', id: matId },
                { k: 'manufacture', id: manufId }
            ].filter(x => !!x.id && /nomisma\.org\/id\//i.test(String(x.id)));
            if (targets.length){
                const jobs = targets.map(async ({k, id}) => {
                    try {
                        const info = await this._enrichNomisma(id);
                        if (info) {
                            if (info.label) result[k] = info.label;
                            const desc = (info.definition || '').trim();
                            if (desc) result[`${k}Desc`] = desc;
                        }
                    } catch(_){}
                });
                await Promise.allSettled(jobs);
            }
        } catch(_){ }
        // Best-effort examples extraction from JSON-LD graph
        try {
            const mainNorm = (s)=> String(s||'').replace(/^https?:/i,'').split('#')[0];
            const baseMain = mainNorm(mainId);
            const toArr = (v)=> Array.isArray(v) ? v : (v!=null ? [v] : []);
            const getIdStr = (v)=> {
                if (!v) return '';
                if (typeof v === 'string') return v;
                if (v && typeof v === 'object') return v['@id'] || v['@value'] || '';
                return '';
            };
            const getFirstUrl = (v)=> {
                const a = toArr(v);
                for (const it of a){ const s = getIdStr(it); if (s) return s; }
                return '';
            };
            const labelOf = (n)=> getEn(pick(n, ['http://www.w3.org/2004/02/skos/core#prefLabel','skos:prefLabel','rdfs:label','label'])) || '';
            const examples = [];
            for (const n of graph){
                const dep = n['http://xmlns.com/foaf/0.1/depiction'] || n['foaf:depiction'];
                if (!dep) continue;
                // Gather references that might connect the object node to this type
                const refs = [];
                const pushRefs = (val)=>{
                    if (!val) return;
                    const arr = toArr(val);
                    for (const it of arr){ const s = getIdStr(it); if (s) refs.push(s); }
                };
                pushRefs(n['http://nomisma.org/ontology#hasTypeSeriesItem']);
                pushRefs(n['nmo:hasTypeSeriesItem']);
                pushRefs(n['http://purl.org/dc/terms/isPartOf']);
                pushRefs(n['dcterms:isPartOf']);
                pushRefs(n['skos:related']);
                const match = refs.some(r => mainNorm(r) === baseMain);
                if (!match) continue;
                const img = getFirstUrl(dep);
                if (!img) continue;
                examples.push({ id: getIdStr(n['@id']||''), img, label: labelOf(n) });
            }
            if (examples.length){
                const seen = new Set();
                result.examples = examples.filter(x => {
                    const k = x.img; if (!k || seen.has(k)) return false; seen.add(k); return true;
                }).slice(0, 8);
            } else {
                result.examples = [];
            }
            if (this._debug) console.debug('ocre:type parsed', result);
        } catch (e) {
            if (this._debug) console.debug('ocre:type examples parse error', e && e.message);
            if (this._debug) console.debug('ocre:type parsed', result);
        }
        return result;
    }
    _renderOcreTypeCard(typ, ocreUri, extra){
        // Render without per-row OCRE chips (only header carries provenance)
        const rows = [];
        const asLink = (label, url)=> url ? `<a href="${this.escapeHtml(url)}" target="_blank" rel="noopener">${this.escapeHtml(label)}</a>` : this.escapeHtml(label);
        const addTxt = (k,v)=>{ if (v) rows.push(`<div class=\"dl\"><dt>${this.escapeHtml(k)}</dt><dd title=\"Source: OCRE\">${this.escapeHtml(v)}</dd></div>`); };
        const addLink = (k, label, url, desc)=>{
            if (!label) return;
            const main = asLink(label, url);
            const value = main + (desc ? `<div class=\"dl-note\">${this.escapeHtml(desc)}</div>` : '');
            const title = url ? `OCRE: ${this.escapeHtml(url)}` : 'Source: OCRE';
            rows.push(`<div class=\"dl\"><dt>${this.escapeHtml(k)}</dt><dd title=\"${title}\">${value}</dd></div>`);
        };
        // Top banner references: prefer RIC label as link text but keep OCRE link
        try {
            const series = (extra && Array.isArray(extra.ocreSeries) && extra.ocreSeries.length)? extra.ocreSeries : (ocreUri ? [ocreUri] : []);
            const ricRefs = (extra && Array.isArray(extra.ricRefs)) ? extra.ricRefs : [];
            if (series && series.length){
                const labelFromRic = (idx)=>{
                    const r = ricRefs[idx] || ricRefs[0] || null;
                    return r && r.formatted ? r.formatted : null;
                };
                const html = series.map((u,idx)=>{
                    const text = labelFromRic(idx) || u.split('/').pop();
                    return asLink(text, u);
                }).join(', ');
                rows.push(`<div class=\"dl\"><dt>RIC Reference(s)</dt><dd title=\"Source: OCRE\">${html}<div class=\"dl-note\">This section is built from digital catalog links (OCRE/RI Coinage). They enrich denomination, mint, authority, legends, and examples.</div></dd></div>`);
            }
        } catch(_){}
        // Core OCRE-derived facts
        addTxt('Date', typ.date);
        addLink('Denomination', typ.denomination, typ.denominationUrl, typ.denominationDesc);
        addLink('Mint', typ.mint, typ.mintUrl, typ.mintDesc);
        addLink('Authority', typ.authority, typ.authorityUrl, typ.authorityDesc);
        addLink('Material', typ.material, typ.materialUrl, typ.materialDesc);
        addLink('Manufacture', typ.manufacture, typ.manufactureUrl, typ.manufactureDesc);
        if (typ.obvLegend || typ.obvType){ rows.push(`<div class=\"dl\"><dt>Obverse</dt><dd>${this.escapeHtml([typ.obvLegend, typ.obvType].filter(Boolean).join(' — '))}</dd></div>`); }
        if (typ.revLegend || typ.revType){ rows.push(`<div class=\"dl\"><dt>Reverse</dt><dd>${this.escapeHtml([typ.revLegend, typ.revType].filter(Boolean).join(' — '))}</dd></div>`); }
        let examplesBlock = `<a class=\"btn-link\" href=\"${this.escapeHtml(ocreUri)}\" target=\"_blank\" rel=\"noopener\">Examples of this type</a>`;
        if (Array.isArray(typ.examples) && typ.examples.length){
            const thumbs = typ.examples.map(x => {
                const href = (x.id && String(x.id).startsWith('http')) ? x.id : ocreUri;
                const title = this.escapeHtml(x.label || '');
                const img = this.escapeHtml(x.img);
                return `<a class=\"ex-thumb\" href=\"${href}\" target=\"_blank\" rel=\"noopener\" title=\"${title}\"><img loading=\"lazy\" src=\"${img}\" alt=\"${title}\"></a>`;
            }).join('');
            examplesBlock = `
            <div class=\"examples\">
              <div class=\"examples-label\">Examples of this type</div>
              <div class=\"examples-grid\">${thumbs}</div>
              <div class=\"examples-more\"><a class=\"btn-link\" href=\"${this.escapeHtml(ocreUri)}\" target=\"_blank\" rel=\"noopener\">Open on OCRE</a></div>
            </div>`;
        }
        const ocreChip = ocreUri ? `<a class=\"source-chip ocre\" href=\"${this.escapeHtml(ocreUri)}\" target=\"_blank\" rel=\"noopener\" title=\"OCRE: ${this.escapeHtml(ocreUri)}\">OCRE</a>` : `<span class=\"source-chip ocre\">OCRE</span>`;
        return `<div class=\"card collapsible type-card\"><h3 class=\"collapsible-head\"><span class=\"caret\"></span>Catalog References ${ocreChip}</h3><div class=\"collapse-body\">${rows.join('')}<div style=\"margin-top:8px\" class=\"external-text\">${examplesBlock}</div></div></div>`;
    }
    _combinedReferencesText(coin){
        if (!coin) return '';
        const s = Array.isArray(coin.referencesStructured)? coin.referencesStructured.map(r=> r.formatted).filter(Boolean).join('; ') : '';
        const t = coin.references || '';
        return [s,t].filter(Boolean).join('; ');
    }
    _renderStructuredRefsList(){
        const host = document.getElementById('structuredRefsList'); if (!host) return;
        const items = Array.isArray(this._draftStructuredRefs)? this._draftStructuredRefs : [];
        if (!items.length){ host.innerHTML = '<em style="font-size:0.75rem;color:#666;">No structured references added yet.</em>'; return; }
        host.innerHTML = items.map((r,i)=>{
            const link = this._enrichmentUrlForRef(r);
            const chips = `<span class=\"structured-ref-chip\">${this.escapeHtml(r.authority)}</span>`;
            const meta = [r.volume?`Vol ${this.escapeHtml(r.volume)}`:'', r.series? this.escapeHtml(r.series):'', r.suffix?`Suffix ${this.escapeHtml(r.suffix)}`:'', r.source? this.escapeHtml(r.source):''].filter(Boolean).join(' · ');
            return `<div class=\"structured-ref-item\" data-index=\"${i}\"><div class=\"structured-ref-main\"><div class=\"structured-ref-label\">${chips} ${this.escapeHtml(r.formatted)}</div><div class=\"structured-ref-meta\">${meta || ''}${link? `<span class=\"structured-ref-links\"><a href=\"${this.escapeHtml(link)}\" target=\"_blank\" rel=\"noopener\">Open</a></span>`:''}</div></div><div><button type=\"button\" class=\"structured-ref-edit\" title=\"Edit\">✎</button> <button type=\"button\" class=\"structured-ref-remove\" aria-label=\"Remove reference\">✕</button></div></div>`;
        }).join('');
        host.querySelectorAll('.structured-ref-remove').forEach(btn=>{
            btn.onclick = ()=>{
                const parent = btn.closest('.structured-ref-item');
                const idx = parent? parseInt(parent.getAttribute('data-index'),10): -1;
                if (idx>=0){ this._draftStructuredRefs.splice(idx,1); this._renderStructuredRefsList(); }
            };
        });
        host.querySelectorAll('.structured-ref-edit').forEach(btn=>{
            btn.onclick = ()=>{
                const parent = btn.closest('.structured-ref-item');
                const idx = parent? parseInt(parent.getAttribute('data-index'),10): -1;
                if (idx>=0){
                    this._editingRefIndex = idx;
                    const r = this._draftStructuredRefs[idx];
                    const formWrap = document.getElementById('structuredRefForm');
                    const sel = document.getElementById('refAuthoritySelect');
                    if (sel){ sel.value = r.authority || 'OTHER'; }
                    this._buildStructuredDynamicFields(sel.value);
                    this._populateStructuredFieldsFromRef(r);
                    if (formWrap) formWrap.classList.remove('hidden');
                }
            };
        });
    }
    _buildStructuredDynamicFields(authority){
        const dynFields = document.getElementById('refDynamicFields'); if (!dynFields) return;
        const field = (id,label,ph='')=> `<label style=\"display:flex;flex-direction:column;gap:4px;min-width:120px;flex:1 1 120px;\"><span style=\"font-size:0.7rem;text-transform:uppercase;letter-spacing:.06em;\">${label}</span><input type=\"text\" id=\"${id}\" placeholder=\"${ph}\" style=\"padding:0.4rem 0.55rem;\" /></label>`;
        let html='';
        if (authority==='RIC') html = field('refVol','Volume','IV') + field('refSuffix','Authority/Section','Gordian III') + field('refNum','Number','51');
        else if (authority==='RRC') html = field('refNum','Number','44/5');
        else if (authority==='CPE') html = field('refVol','Volume','I') + field('refNum','Number','505');
        else if (authority==='HGC') html = field('refVol','Volume','4') + field('refNum','Number','1597');
        else if (authority==='SNG') html = field('refSeries','Series','Copenhagen') + field('refNum','Number','87');
        else if (authority==='OTHER') html = field('refCustomAuth','Catalog','Svoronos') + field('refNum','Number','713');
        dynFields.innerHTML = html;
    }
    _saveStructuredRef(){
        const authority = document.getElementById('refAuthoritySelect')?.value || 'OTHER';
        const get = id => document.getElementById(id)?.value.trim() || '';
        const ref = { authority };
        if (authority==='RIC'){ ref.volume=get('refVol'); ref.number=get('refNum'); ref.suffix=get('refSuffix'); ref.source='OCRE'; ref.canEnrich=true; }
        else if (authority==='RRC'){ ref.number=get('refNum'); ref.source='CRRO'; ref.canEnrich=true; }
        else if (authority==='CPE'){ ref.volume=get('refVol'); ref.number=get('refNum'); ref.source='PCO'; ref.canEnrich=true; }
        else if (authority==='HGC'){ ref.volume=get('refVol'); ref.number=get('refNum'); ref.source='SEARCH'; ref.canEnrich='maybe'; }
        else if (authority==='SNG'){ ref.series=get('refSeries'); ref.number=get('refNum'); ref.source='SEARCH'; ref.canEnrich='maybe'; }
        else { ref.customAuthority=get('refCustomAuth'); ref.number=get('refNum'); ref.source='OTHER'; ref.canEnrich=false; }
        ref.formatted = this._formatStructuredRef(ref);
        if (!ref.formatted){ alert('Incomplete reference.'); return; }
        if (this._editingRefIndex != null && this._editingRefIndex >= 0){
            this._draftStructuredRefs[this._editingRefIndex] = ref;
        } else {
            this._draftStructuredRefs.push(ref);
        }
        this._editingRefIndex = -1;
        this._renderStructuredRefsList();
        const formWrap = document.getElementById('structuredRefForm'); if (formWrap) formWrap.classList.add('hidden');
        const dynFields = document.getElementById('refDynamicFields'); if (dynFields) dynFields.innerHTML='';
    }
    _populateStructuredFieldsFromRef(r){
        if (!r) return;
        const set = (id, v)=>{ const el = document.getElementById(id); if (el) el.value = v!=null ? String(v) : ''; };
        const a = (r.authority||'OTHER').toUpperCase();
        if (a==='RIC') { set('refVol', r.volume); set('refNum', r.number); set('refSuffix', r.suffix); }
        else if (a==='RRC'){ set('refNum', r.number); }
        else if (a==='CPE'){ set('refVol', r.volume); set('refNum', r.number); }
        else if (a==='HGC'){ set('refVol', r.volume); set('refNum', r.number); }
        else if (a==='SNG'){ set('refSeries', r.series); set('refNum', r.number); }
        else { set('refCustomAuth', r.customAuthority); set('refNum', r.number); }
        // keep source as computed; no source field to set
    }
    _initReferenceUI(){
        if (!this._draftStructuredRefs) this._draftStructuredRefs = [];
        const addBtn = document.getElementById('addStructuredRefBtn');
        const formWrap = document.getElementById('structuredRefForm');
        const authoritySel = document.getElementById('refAuthoritySelect');
        const dynFields = document.getElementById('refDynamicFields');
        const saveBtn = document.getElementById('saveStructuredRefBtn');
        const cancelBtn = document.getElementById('cancelStructuredRefBtn');
        if (!addBtn || !formWrap || !authoritySel || !dynFields || !saveBtn || !cancelBtn) return;
        addBtn.onclick = ()=>{ this._editingRefIndex = -1; formWrap.classList.remove('hidden'); this._buildStructuredDynamicFields(authoritySel.value); };
        authoritySel.onchange = ()=> this._buildStructuredDynamicFields(authoritySel.value);
        cancelBtn.onclick = ()=>{ this._editingRefIndex = -1; formWrap.classList.add('hidden'); dynFields.innerHTML=''; };
        saveBtn.onclick = ()=> this._saveStructuredRef();
        this._renderStructuredRefsList();
    }

    // Simple lightbox with zoom and navigation
    openImageLightbox(images, startIndex = 0) {
        if (!images || images.length === 0) return;
        let idx = Math.max(0, Math.min(startIndex, images.length - 1));
        let scale = 1;
        let tx = 0, ty = 0;
        let isPanning = false, startX = 0, startY = 0;
        let canZoom = true;

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

        const assessZoomability = () => {
            try {
                const stage = overlay.querySelector('.ilb-stage');
                const cw = stage.clientWidth, ch = stage.clientHeight;
                const nw = imgEl.naturalWidth, nh = imgEl.naturalHeight;
                canZoom = (nw > cw) || (nh > ch);
                if (btnIn) btnIn.disabled = !canZoom;
                if (btnOut) btnOut.disabled = !canZoom;
            } catch(_) { canZoom = true; }
        };
        const updateImg = () => {
            imgEl.style.maxWidth = 'min(90vw, 1600px)';
            imgEl.style.maxHeight = '90vh';
            imgEl.style.objectFit = 'contain';
            imgEl.src = images[idx];
            scale = 1; tx = 0; ty = 0; applyTransform();
            // Apply current detail view style or compare style
            try {
                const st = this._detailViewState || null;
                if (st){
                    const filter = this._computeFilter(st.view, st.intensity);
                    if (st.view==='paper'){ imgEl.style.mixBlendMode = 'multiply'; imgEl.style.filter = ''; }
                    else { imgEl.style.mixBlendMode = ''; imgEl.style.filter = filter; }
                    const stage = overlay.querySelector('.ilb-stage');
                    if (stage){
                        let bg = '';
                        if (st.bg==='bg-grey') bg = '#d4d4d4';
                        else if (st.bg==='bg-warm') bg = '#f4e8d2';
                        else if (st.bg==='bg-teal') bg = '#0d3a4a';
                        else if (st.bg==='bg-charcoal') bg = '#2a2a2a';
                        stage.style.background = bg || '';
                    }
                } else if (this._compareState){
                    const cs = this._compareState;
                    const filter = this._computeFilter(cs.view, cs.intensity);
                    if (cs.view==='paper'){ imgEl.style.mixBlendMode = 'multiply'; imgEl.style.filter=''; }
                    else { imgEl.style.mixBlendMode=''; imgEl.style.filter=filter; }
                    const stage = overlay.querySelector('.ilb-stage');
                    if (stage){
                        let bg='';
                        if (cs.bg==='bg-grey') bg='#d4d4d4';
                        else if (cs.bg==='bg-warm') bg='#f4e8d2';
                        else if (cs.bg==='bg-teal') bg='#0d3a4a';
                        else if (cs.bg==='bg-charcoal') bg='#2a2a2a';
                        stage.style.background = bg || '';
                    }
                }
            } catch(_) {}
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
        btnIn && btnIn.addEventListener('click', () => { if (canZoom) zoomBy(0.25); });
        btnOut && btnOut.addEventListener('click', () => { if (canZoom) zoomBy(-0.25); });
        btnPrev && btnPrev.addEventListener('click', prev);
        btnNext && btnNext.addEventListener('click', next);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        const stage = overlay.querySelector('.ilb-stage');
        stage.addEventListener('wheel', (e) => { if (!canZoom) return; e.preventDefault(); zoomBy(e.deltaY > 0 ? -0.2 : 0.2); }, { passive: false });
        stage.addEventListener('mousedown', (e) => { if (!canZoom || scale <= 1) return; isPanning = true; startX = e.clientX - tx; startY = e.clientY - ty; stage.style.cursor = 'grabbing'; });
        window.addEventListener('mousemove', (e) => { if (!isPanning) return; tx = e.clientX - startX; ty = e.clientY - startY; applyTransform(); });
        window.addEventListener('mouseup', () => { if (!isPanning) return; isPanning = false; stage.style.cursor = 'grab'; });
        stage.addEventListener('dblclick', () => { if (!canZoom) return; if (scale === 1) { scale = 2; } else { scale = 1; tx = 0; ty = 0; } applyTransform(); });

        const onKey = (e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowLeft') prev();
            else if (e.key === 'ArrowRight') next();
            else if (e.key === '+') zoomBy(0.25);
            else if (e.key === '-') zoomBy(-0.25);
        };
        document.addEventListener('keydown', onKey);

        imgEl.addEventListener('load', assessZoomability);
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
    if (snap.period_info) cards.push(mkCard(snap.period_info.label || ((coin.period && typeof coin.period==='object')? (coin.period.label||'') : (coin.period||'')) || 'Period', snap.period_info));
    // Replace legacy date usage with period label
    if (snap.period_info) { /* updated above; clean duplication handled */ }
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

    // History Explorer: open overlay and render basic timeline, rulers, events (stub)
    async openHistoryExplorer(coinId){
        const coin = this.coins.find(c => c.id === coinId);
        if (!coin) return;
        const overlay = document.getElementById('historyOverlay');
        const btnClose = document.getElementById('closeHistoryBtn');
        const btnTrace = document.getElementById('toggleTraceBtn');
        const timelineHost = document.getElementById('timelineHost');
        const notice = document.getElementById('timelineNotice');
        const rulersHost = document.getElementById('rulersHost');
        const eventsHost = document.getElementById('eventsHost');
        if (!overlay || !timelineHost || !rulersHost || !eventsHost) return;

        const trace = this._traceCreate({ coinId, coinName: coin.name });
        this._activeTrace = trace;

        // Ensure container isn't constrained by the old events grid layout
        try { eventsHost.classList.remove('events-wrap'); } catch(_) {}

        // Open overlay immediately and show lightweight placeholders
        overlay.classList.remove('hidden');
        if (notice) { notice.style.display = 'none'; notice.textContent = ''; }
        timelineHost.innerHTML = '<div class="timeline-bar"></div><div class="timeline-labels"><div>Loading…</div><div></div></div>';
        rulersHost.innerHTML = '<span class="ruler-chip">Loading…</span>';
        eventsHost.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span class="spinner sm"></span><em>Loading overview…</em></div>';
        const overviewTitleEl = overlay.querySelector('.events-section h3');
        if (overviewTitleEl) overviewTitleEl.textContent = 'Period Overview';

        // Resolve period QID (prefer snapshot -> coin.period.wikidata_qid -> enrichment on demand)
        let qid = null;
        let qidPath = 'none';
        const tQid0 = (window.performance?.now?.()||Date.now());
        try {
            const snap = coin.facts_snapshot || {};
            qid = snap?.nomisma_period?.wikidata || snap?.period_info?.qid || null;
            if (qid) qidPath = 'snapshot';
            if (!qid && coin.period && typeof coin.period === 'object') { qid = coin.period.wikidata_qid || null; if (qid) qidPath='coin.period.wikidata_qid'; }
            if (!qid && coin.period && coin.period.nomisma_uri) {
                try { const nm = await this._enrichNomisma(coin.period.nomisma_uri, trace); qid = nm?.wikidata || null; if (qid) qidPath='nomisma.enrich'; } catch(e){ console.error('history: enrichNomisma failed', e); }
            }
        } catch(e){ console.error('history: resolve period QID error', e); }
        const tQidDur = (window.performance?.now?.()||Date.now()) - tQid0;
        this._tracePush(trace, { type:'resolve-qid', label:'period QID', durationMs: Math.round(tQidDur), note: qid ? `via ${qidPath}` : 'not found' });

        console.log('history: period QID', qid || '(none)');

        // Fetch period range if we have a QID
        let periodRange = null;
        if (qid) {
            const t0 = (window.performance?.now?.()||Date.now());
            try { periodRange = await this._fetchPeriodRange(qid); } catch(e){ console.error('history: _fetchPeriodRange error', e); }
            const dur = (window.performance?.now?.()||Date.now()) - t0;
            this._tracePush(trace, { type:'wikidata-entity', label:'period-range', durationMs: Math.round(dur), resultCount: periodRange?2:0 });
        } else {
            console.warn('history: no period QID available; overview may be empty');
        }

        if (periodRange) {
            console.log('history: period range', periodRange);
        }

        // Render timeline
        this._renderTimeline(timelineHost, notice, periodRange, coin.struck_date?.exact || null);

        // Fetch and render rulers sequence as chips; highlight coin's ruler
        const coinRulerQid = (()=>{
            const snap = coin.facts_snapshot || {};
            return snap?.authority_info?.qid || (coin.ruler && typeof coin.ruler==='object' ? (coin.ruler.wikidata_qid||null) : null) || null;
        })();
        let rulers = [];
        if (qid) {
            const t0 = (window.performance?.now?.()||Date.now());
            try { rulers = await this._fetchRulersForPeriod(qid, trace); } catch(_){ }
            const dur = (window.performance?.now?.()||Date.now()) - t0;
            this._tracePush(trace, { type:'wdqs', label:'rulers', durationMs: Math.round(dur), resultCount: rulers.length });
        }
        if (rulers.length){
            rulersHost.innerHTML = rulers.map(r=>{
                const active = coinRulerQid && r.qid && r.qid.toUpperCase() === coinRulerQid.toUpperCase();
                const title = (r.start||r.end) ? ` title="${this.escapeHtml(`${r.start? (r.start.year+" "+r.start.era):''}${r.start&&r.end?'–':''}${r.end? (r.end.year+" "+r.end.era):''}`)}"` : '';
                const data = r.qid ? ` data-qid="${this.escapeHtml(r.qid)}"` : '';
                return `<button type="button" class="ruler-chip ${active?'active':''}"${title}${data}>${this.escapeHtml(r.label||r.qid||'')}</button>`;
            }).join('');
            // Wire chip clicks to open in-app profile
            rulersHost.querySelectorAll('.ruler-chip[data-qid]').forEach(el=>{
                el.addEventListener('click', ()=>{
                    const q = el.getAttribute('data-qid'); if (q) this.openRulerProfile(q);
                });
            });
        } else {
            const fallbackLabel = (()=>{ const snap=coin.facts_snapshot||{}; return snap?.authority_info?.label || snap?.nomisma_ruler?.label || (coin.ruler && typeof coin.ruler==='object'? (coin.ruler.label||'') : (coin.ruler||'')); })();
            rulersHost.innerHTML = fallbackLabel ? `<span class="ruler-chip active">${this.escapeHtml(fallbackLabel)}</span>` : '<em>No rulers found for this period.</em>';
        }

        // Overview + events
        let overview = null;
        if (qid) {
            const t0 = (window.performance?.now?.()||Date.now());
            try { overview = await this._fetchPeriodOverview(qid, trace); } catch(e){ console.error('history: _fetchPeriodOverview error', e); }
            const dur = (window.performance?.now?.()||Date.now()) - t0;
            this._tracePush(trace, { type:'overview', label:'overview aggregate', durationMs: Math.round(dur) });
        }
        let periodInfo = (()=>{ try { return coin.facts_snapshot?.period_info || null; } catch(_) { return null; } })();
        if (!periodInfo && qid) {
            const t0 = (window.performance?.now?.()||Date.now());
            try { periodInfo = await this._enrichWikidataEntity(qid, 'period', trace); } catch(e) { console.error('history: enrich period entity failed', e); }
            const dur = (window.performance?.now?.()||Date.now()) - t0;
            this._tracePush(trace, { type:'wikidata-entity', label:'period entity', durationMs: Math.round(dur), resultCount: periodInfo?1:0 });
        }
        const summaryHtml = (()=>{
            const title = periodInfo?.label || '';
            const extractFull = periodInfo?.wikipedia?.extract || periodInfo?.description || '';
            const intro = (()=>{ const t = String(extractFull||'').split(/(?<=\.)\s+/).slice(0,2).join(' '); return t.length>320? t.slice(0,317)+'…' : t; })();
            const dateRangeLabel = (()=>{
                if (!periodRange) return '';
                const fmt = (p)=> p? `${p.year} ${p.era||'CE'}`:'';
                const a = fmt(periodRange.start), b = fmt(periodRange.end);
                if (a && b) return `${a} – ${b}`;
                return a || b || '';
            })();
            if (!title && !intro) return '';
            return `
                <div class="period-header">
                    <h2 class="period-title">${this.escapeHtml(title)}</h2>
                    ${dateRangeLabel? `<div class="period-range">${this.escapeHtml(dateRangeLabel)}</div>`:''}
                    ${intro? `<p class="period-intro">${this.escapeHtml(intro)}</p>`:''}
                </div>`;
        })();
        // debug logs
        if (overview) {
            try {
                console.log('overview people', overview.people.length, overview.people.slice(0,3));
                console.log('overview states', overview.states.length, overview.states.slice(0,3));
                console.log('overview cities', overview.cities.length, overview.cities.slice(0,3));
                console.log('overview culture', overview.culture.length, overview.culture.slice(0,3));
                console.log('overview science', overview.science.length, overview.science.slice(0,3));
                console.log('overview coinage', overview.coinage.length, overview.coinage.slice(0,3));
                console.log('overview dynasties', overview.dynasties.length, overview.dynasties.slice(0,3));
                console.log('overview movements', overview.movements.length, overview.movements.slice(0,3));
            } catch(e) { console.error('history: overview logging failed', e); }
        }

        let events = [];
        if (qid) {
            const originQid = (()=>{
                const snap=coin.facts_snapshot||{};
                return snap?.nomisma_origin?.wikidata || (coin.origin && typeof coin.origin==='object'? (coin.origin.wikidata_qid||null) : null) || null;
            })();
            const t0 = (window.performance?.now?.()||Date.now());
            try { events = await this._fetchPeriodEvents(qid, { rulers, periodRange, originQid, struckExact: coin.struck_date?.exact || null }, trace); } catch(e){ console.error('history: _fetchPeriodEvents error', e); }
            const dur = (window.performance?.now?.()||Date.now()) - t0;
            this._tracePush(trace, { type:'events', label:'events aggregate', durationMs: Math.round(dur), resultCount: events.length });
        }
        console.log('history: events', events.length, events.slice(0,3));
        // Build single-column article layout
        const blocks = [];
        if (summaryHtml) blocks.push(summaryHtml);
        if (overview) {
            const pickLabels = (arr, n=3)=> (arr||[]).slice(0,n).map(x=> x.label).filter(Boolean);
            const hi = [];
            const ppl = pickLabels(overview.people); if (ppl.length) hi.push(`Notable people: ${this.escapeHtml(ppl.join(', '))}.`);
            const sts = pickLabels(overview.states); if (sts.length) hi.push(`Important states: ${this.escapeHtml(sts.join(', '))}.`);
            const cts = pickLabels(overview.cities); if (cts.length) hi.push(`Key cities: ${this.escapeHtml(cts.join(', '))}.`);
            const cul = pickLabels(overview.culture); if (cul.length) hi.push(`Art & culture: ${this.escapeHtml(cul.join(', '))}.`);
            const sci = pickLabels(overview.science); if (sci.length) hi.push(`Science & scholarship: ${this.escapeHtml(sci.join(', '))}.`);
            const dny = pickLabels(overview.dynasties); if (dny.length) hi.push(`Dynasties: ${this.escapeHtml(dny.join(', '))}.`);
            if (hi.length) blocks.push(`<div class="ov-section"><h4>Highlights</h4><ul class="ov-bullets">${hi.map(s=>`<li>${s}</li>`).join('')}</ul></div>`);

            const simpleTags = (title, items, cap=8) => {
                if (!items || !items.length) return '';
                const top = items.slice(0, cap);
                return `<div class="ov-section"><h4>${this.escapeHtml(title)}</h4><div class="simple-list">${top.map(x=>`<span class="tag">${this.escapeHtml(x.label||x.qid)}</span>`).join('')}</div></div>`;
            };
            const statesDyn = simpleTags('States & dynasties', [...(overview.states||[]), ...(overview.dynasties||[])]);
            if (statesDyn) blocks.push(statesDyn);
            const cities = simpleTags('Cities & regions', overview.cities||[]);
            if (cities) blocks.push(cities);
        }

        // Card sections (grid) and events
        const capN = 4;
        const sections = [
            { title: 'Notable people', items: (overview?.people||[]).slice(0, capN) },
            { title: 'Art & culture / Artifacts', items: ([...(overview?.culture||[]), ...(overview?.artifacts||[])]).slice(0, capN) },
            { title: 'Science & scholarship', items: (overview?.science||[]).slice(0, capN) },
            { title: 'Coinage & economy', items: (overview?.coinage||[]).slice(0, capN) }
        ];
        const eventsCap = 6;
        const eventsShow = (events||[]).slice(0, eventsCap);

        // Collect QIDs to enrich for source links
        const wantedQids = new Set();
        sections.forEach(sec => (sec.items||[]).forEach(x => x.qid && wantedQids.add(x.qid)));
        eventsShow.forEach(ev => ev.qid && wantedQids.add(ev.qid));
        const linkMap = new Map();
        const linkFetches = Array.from(wantedQids).slice(0, 24).map(async q => {
            try {
                const cached = this.getCache(`wikidata:${q}`);
                const info = cached || await this._enrichWikidataEntity(q, 'generic');
                const wiki = info?.wikipedia?.content_urls?.desktop?.page || null;
                const wd = q ? `https://www.wikidata.org/wiki/${q}` : null;
                linkMap.set(q, { wiki, wd });
            } catch (_) {
                linkMap.set(q, { wiki: null, wd: q ? `https://www.wikidata.org/wiki/${q}` : null });
            }
        });
        try { await Promise.all(linkFetches); } catch(_) {}

        // Add context provenance for how the root period was resolved (Nomisma → Wikidata → Wikipedia)
        try {
            const nmUri = (coin.period && typeof coin.period==='object') ? (coin.period.nomisma_uri||null) : null;
            if (qid && nmUri){
                const wikiUrl = periodInfo?.wikipedia?.content_urls?.desktop?.page || null;
                const wdUrl = `https://www.wikidata.org/wiki/${qid}`;
                const hops = [`Nomisma ${nmUri}`, '→ exactMatch', `wd:${qid}`];
                if (wikiUrl) hops.push('→ wikipedia');
                this._traceAddProvenance(trace, { section: 'Context', qid, label: periodInfo?.label || qid, hops, wd: wdUrl, wiki: wikiUrl });
            }
        } catch(_){}

        // Build provenance hops for sections and events being displayed
        const pathLabel = (secTitle)=>{
            if (secTitle === 'Notable people') return 'root(QID) → WDQS: item P31 Q5; item P2348 period; period (P361)* root';
            if (secTitle === 'Cities & regions') return 'root(QID) → WDQS: item P31/P279* Q515; item P2348 period; period (P361)* root';
            if (secTitle === 'Art & culture / Artifacts') return 'root(QID) → WDQS: item (culture/artifact); item P2348 period; period (P361)* root';
            if (secTitle === 'Science & scholarship') return 'root(QID) → WDQS: item (science); item P2348 period; period (P361)* root';
            if (secTitle === 'Coinage & economy') return 'root(QID) → WDQS: item (coinage); item P2348 period; period (P361)* root';
            return 'root(QID) → WDQS';
        };
        const addProvForSection = (sec)=>{
            const hopsStr = pathLabel(sec.title);
            (sec.items||[]).forEach(it=>{
                const links = linkMap.get(it.qid) || {};
                this._traceAddProvenance(trace, { section: sec.title, qid: it.qid, label: it.label||it.qid, hops: [hopsStr, links.wiki?'→ wikipedia':''], wd: links.wd||null, wiki: links.wiki||null });
            });
        };
        sections.forEach(addProvForSection);
        const addProvForEvent = (ev)=>{
            const links = linkMap.get(ev.qid) || {};
            const sourcePath = ev && ev.title ? (ev.source||'') : '';
            const human = {
                'P710_RULER': 'root(QID) → WDQS: event P710 any-ruler; actor period family → event',
                'P361_PERIOD': 'root(QID) → WDQS: event part-of period',
                'WAR_P710_PERIOD': 'root(QID) → WDQS: war with actor in period',
                'BATTLE_OF_WAR': 'root(QID) → WDQS: war (subset) → battle',
                'LOCATION': 'origin QID → WDQS: event located-in/within origin'
            }[sourcePath] || 'root(QID) → WDQS: events';
            this._traceAddProvenance(trace, { section: 'Conflicts & events', qid: ev.qid, label: ev.title||ev.qid, hops: [human, links.wiki?'→ wikipedia':''], wd: links.wd||null, wiki: links.wiki||null });
        };
        eventsShow.forEach(addProvForEvent);

        const lifeSubtitle = (p) => {
            if (!p) return '';
            const y = (t) => { if (!t) return null; const m = String(t).match(/^[+-]?(\d{1,4})-/); if (!m) return null; return parseInt(m[1],10); };
            const a = y(p.b), b = y(p.d);
            if (!a && !b) return '';
            const toStr = (n)=> (n==null?'': String(n));
            return `${toStr(a)}${(a!=null||b!=null)?'–':''}${toStr(b)}`;
        };

        const renderCard = (it) => {
            const img = it.image ? `<img class="thumb" src="${this.escapeHtml(it.image)}" alt="">` : '';
            const sub = it.b || it.d ? `<div class="subtitle">${this.escapeHtml(lifeSubtitle(it))}</div>` : '';
            const links = (()=>{
                const h = linkMap.get(it.qid) || {};
                const a = [];
                if (h.wiki) a.push(`<a href="${this.escapeHtml(h.wiki)}" target="_blank" rel="noopener">Wikipedia</a>`);
                if (h.wd) a.push(`<a href="${this.escapeHtml(h.wd)}" target="_blank" rel="noopener">Wikidata</a>`);
                return a.length ? `<div class="card-links">${a.join(' · ')}</div>` : '';
            })();
            return `<div class="entity-card">`+
                   `${img}`+
                   `<div class="inner">`+
                   `<div class="title">${this.escapeHtml(it.label || it.qid || '')}</div>`+
                   `${sub}`+
                   `</div>`+
                   `${links}`+
                   `</div>`;
        };

        sections.forEach(sec => {
            const grid = (sec.items || []).map(renderCard).join('');
            if (!grid) return;
            blocks.push(`<div class="ov-section"><h4>${this.escapeHtml(sec.title)}</h4><div class="entity-grid">${grid}</div></div>`);
        });

        // Conflicts & events at bottom of main
        if (eventsShow.length) {
            const evCards = eventsShow.map(ev => {
                const links = (()=>{
                    const h = linkMap.get(ev.qid) || {};
                    const a = [];
                    if (h.wiki) a.push(`<a href="${this.escapeHtml(h.wiki)}" target="_blank" rel="noopener">Wikipedia</a>`);
                    if (h.wd) a.push(`<a href="${this.escapeHtml(h.wd)}" target="_blank" rel="noopener">Wikidata</a>`);
                    return a.length ? `<div class="card-links">${a.join(' · ')}</div>` : '';
                })();
                return `<div class="event-card">`+
                       `<div class="event-title">${this.escapeHtml(ev.title||'')}</div>`+
                       `<div class="event-year">${this.escapeHtml(String(ev.year||''))}</div>`+
                       `${ev.imageUrl ? `<img src="${this.escapeHtml(ev.imageUrl)}" alt="thumbnail" style="width:100%;height:120px;object-fit:cover;border-radius:8px;margin:6px 0;"/>` : ''}`+
                       `${ev.description ? `<div class="event-desc">${this.escapeHtml(ev.description)}</div>` : ''}`+
                       `${links}`+
                       `</div>`;
            }).join('');
            blocks.push(`<div class="ov-section"><h4>Conflicts & events</h4><div class="entity-grid">${evCards}</div></div>`);
        }

        // Assemble single-column content
        eventsHost.innerHTML = `<div class="history-overview">${blocks.join('')}</div>`;

        const traceBtn = btnTrace;
        if (traceBtn) {
            traceBtn.onclick = () => {
                const sec = document.getElementById('traceSection');
                const host = document.getElementById('traceHost');
                if (!sec || !host) return;
                if (sec.style.display === 'none') { this._renderTrace(this._traceFinish(trace), host); sec.style.display = 'block'; }
                else { sec.style.display = 'none'; }
            };
        }

        try {
            const done = this._traceFinish(trace);
            const total = (done.finishedAt && done.startedAt) ? Math.round(done.finishedAt - done.startedAt) : null;
            if (total != null) {
                const byType = {};
                done.steps.forEach(s=>{ const k=s.type||'other'; byType[k]=(byType[k]||0)+(s.durationMs||0); });
                console.groupCollapsed('History trace timing');
                console.log('Total', total, 'ms');
                Object.keys(byType).sort((a,b)=>byType[b]-byType[a]).forEach(k=> console.log(`${k}: ${Math.round(byType[k])} ms`));
                const slow = [...done.steps].sort((a,b)=> (b.durationMs||0)-(a.durationMs||0)).slice(0,5);
                console.table(slow.map(s=>({ type:s.type,label:s.label,durationMs:s.durationMs,rows:s.resultCount||'',note:s.note||'' })));
                console.groupEnd();
            }
        } catch(_){}

        // Wire close
        const close = () => overlay.classList.add('hidden');
        btnClose && (btnClose.onclick = close);
        overlay.addEventListener('click', (e)=>{ if (e.target === overlay) close(); });
        const onKey = (e)=>{ if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey, { once: true });
    }

    // Ruler Profile overlay
    async openRulerProfile(qid){
        const overlay = document.getElementById('rulerOverlay');
        const body = document.getElementById('rulerBody');
        const closeBtn = document.getElementById('closeRulerBtn');
        if (!overlay || !body) return;
        overlay.classList.remove('hidden');
        body.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span class="spinner sm"></span> Loading ruler…</div>';
        const close = ()=> overlay.classList.add('hidden');
        closeBtn && (closeBtn.onclick = close);
        overlay.addEventListener('click', (e)=>{ if (e.target===overlay) close(); });
        document.addEventListener('keydown', (e)=>{ if (e.key==='Escape') close(); }, { once:true });

        let info = null;
        try { info = await this._enrichWikidataEntity(qid, 'authority'); } catch(_){}

        const label = info?.label || qid;
        const reign = info?.claims_parsed?.reign || null;
        const dateText = (()=>{
            if (!reign) return '';
            const exact = { from: reign.start||null, to: reign.end||null };
            return this._formatDateRange(exact) || '';
        })();
        const portrait = info?.wikipedia?.thumbnail?.source || '';
        const summary = info?.wikipedia?.extract || info?.description || '';
        const wikiUrl = info?.wikipedia?.content_urls?.desktop?.page || null;
        const wdUrl = qid ? `https://www.wikidata.org/wiki/${qid}` : null;
        // Try to find a Nomisma link via any coin in collection for this ruler
        let nomismaUrl = null;
        for (const c of this.coins){
            const rq = (typeof c.ruler==='object') ? (c.ruler.wikidata_qid||null) : null;
            const snapQ = c.facts_snapshot?.authority_info?.qid || null;
            if ((rq && rq.toUpperCase()===qid.toUpperCase()) || (snapQ && snapQ.toUpperCase()===qid.toUpperCase())){
                if (typeof c.ruler==='object' && c.ruler.nomisma_uri){ nomismaUrl = this._normalizeNomismaUrl(c.ruler.nomisma_uri); break; }
                if (c.facts_snapshot?.nomisma_ruler?.uri){ nomismaUrl = c.facts_snapshot.nomisma_ruler.uri; break; }
            }
        }

        // Collect coins for this ruler
        const coins = this.coins.filter(c => {
            const rq = (typeof c.ruler==='object') ? (c.ruler.wikidata_qid||null) : null;
            const snapQ = c.facts_snapshot?.authority_info?.qid || null;
            return (rq && rq.toUpperCase()===qid.toUpperCase()) || (snapQ && snapQ.toUpperCase()===qid.toUpperCase());
        }).slice(0,20);

        const coinsHtml = coins.length ? coins.map(c => {
            const img = this._getCoinFace(c, 'obv') || this.PLACEHOLDER_IMAGE;
            return `<div class="coins-mini-card"><img src="${img}" alt="thumb"/><div>${this.escapeHtml(c.name||'Untitled')}</div></div>`;
        }).join('') : '<em>No coins in your collection linked to this ruler yet.</em>';

        body.innerHTML = `
            <div class="ruler-profile">
                ${portrait ? `<img class="ruler-portrait" src="${this.escapeHtml(portrait)}" alt="${this.escapeHtml(label)}">` : `<div class="ruler-portrait"></div>`}
                <div>
                    <h2>${this.escapeHtml(label)}</h2>
                    ${dateText ? `<div class="ruler-dates">r. ${this.escapeHtml(dateText)}</div>` : ''}
                    ${summary ? `<div class="ruler-summary">${this.escapeHtml(summary)}</div>` : ''}
                    <div class="ruler-links">
                        ${wikiUrl ? `<a class="btn-link" href="${this.escapeHtml(wikiUrl)}" target="_blank" rel="noopener">🌐 Wikipedia</a>` : ''}
                        ${wdUrl ? `<a class="btn-link" href="${this.escapeHtml(wdUrl)}" target="_blank" rel="noopener">🗄️ Wikidata</a>` : ''}
                        ${nomismaUrl ? `<a class="btn-link" href="${this.escapeHtml(nomismaUrl)}" target="_blank" rel="noopener">🔗 Nomisma</a>` : ''}
                    </div>
                </div>
            </div>
            <div class="divider"></div>
            <div>
                <h3>Your Coins for this Ruler</h3>
                <div class="coins-mini-grid">${coinsHtml}</div>
            </div>
        `;
    }

    _renderTimeline(host, noticeEl, periodRange, struckExact){
        if (!host) return;
        host.innerHTML = '';
        const fmtLabel = (p) => p ? `${p.year} ${p.era||'CE'}` : '';
        if (!periodRange) {
            if (noticeEl){
                noticeEl.style.display='block';
                noticeEl.textContent = 'Link a Nomisma period (with a Wikidata QID) to plot the full timeline.';
            }
            return;
        }
        if (noticeEl) noticeEl.style.display='none';
        const startY = this._eraNum(periodRange.start);
        const endY = this._eraNum(periodRange.end);
        if (startY == null || endY == null || endY <= startY) {
            if (noticeEl){ noticeEl.style.display='block'; noticeEl.textContent = 'Could not resolve a valid period date range.'; }
            return;
        }
        const bar = document.createElement('div');
        bar.className = 'timeline-bar';
        const range = document.createElement('div');
        range.className = 'timeline-range';
        bar.appendChild(range);
        // Highlight struck range if present
        if (struckExact && (struckExact.from?.year || struckExact.to?.year)){
            const from = this._eraNum(struckExact.from) ?? this._eraNum(struckExact.to);
            const to = this._eraNum(struckExact.to) ?? this._eraNum(struckExact.from);
            if (from != null){
                const min = startY, max = endY, span = (max - min) || 1;
                const leftPct = Math.max(0, Math.min(100, ((from - min) / span) * 100));
                const rightVal = (to != null && to >= from) ? to : from;
                const widthPct = Math.max(2, Math.min(100, (((rightVal - from) || (span*0.01)) / span) * 100));
                const hi = document.createElement('div');
                hi.className = 'timeline-highlight';
                hi.style.left = leftPct + '%';
                hi.style.width = widthPct + '%';
                bar.appendChild(hi);
            }
        }
        const labels = document.createElement('div');
        labels.className = 'timeline-labels';
        labels.innerHTML = `<div>${this.escapeHtml(fmtLabel(periodRange.start))}</div><div>${this.escapeHtml(fmtLabel(periodRange.end))}</div>`;
        host.appendChild(bar);
        host.appendChild(labels);
    }

    _eraNum(p){
        if (!p || !p.year) return null;
        return (p.era === 'BCE') ? -Math.abs(parseInt(p.year,10)) : Math.abs(parseInt(p.year,10));
    }

    _yearFromFreeform(input){
        if (input == null) return null;
        const text = String(input).trim();
        if (!text) return null;
        const match = text.match(/(-?\d{1,4})/);
        if (!match) return null;
        const num = parseInt(match[1], 10);
        if (!Number.isFinite(num)) return null;
        if (/BCE/i.test(text) && num > 0) return -Math.abs(num);
        return num;
    }

    _getStruckDateSortValue(coin){
        if (!coin) return Number.POSITIVE_INFINITY;
        const exact = coin.struck_date?.exact;
        const fromVal = this._eraNum(exact?.from);
        if (fromVal != null) return fromVal;
        const toVal = this._eraNum(exact?.to);
        if (toVal != null) return toVal;
        const fallbackSources = [coin.struck_date?.note, coin.period_year, coin.date];
        for (const source of fallbackSources){
            const val = this._yearFromFreeform(source);
            if (val != null) return val;
        }
        return Number.POSITIVE_INFINITY;
    }

    _yearFromWikidataTime(t){
        if (!t || typeof t !== 'string') return null;
        const m = t.match(/^[+-]?(\d{1,4})-/);
        if (!m) return null;
        const y = parseInt(m[1],10);
        return t.startsWith('-') ? -y : y;
    }

    async _fetchPeriodRange(qid){
        if (!qid || !/^Q\d+$/i.test(qid)) return null;
        const cacheKey = `wikidata:period-range:${qid.toUpperCase()}`;
        const hit = this.getCache(cacheKey); if (hit) return hit;
        try {
            const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid.toUpperCase()}.json`;
            const res = await this._fetchWithTimeout(url, { timeout: 12000 });
            const data = await res.json();
            const ent = data?.entities?.[qid.toUpperCase()];
            if (!ent || !ent.claims) return null;
            const toYR = (t)=>{
                if (!t || typeof t !== 'string') return null;
                const m = t.match(/^[+-]?(\d{1,4})-/);
                if (!m) return null;
                const y = parseInt(m[1],10);
                const era = t.startsWith('-') ? 'BCE' : 'CE';
                return { year: y, era };
            };
            // Prefer explicit start/end time (P580/P582); fall back to inception (P571) and dissolved/abolished (P576)
            const startsP580 = (ent.claims.P580||[]).map(c=> toYR(c.mainsnak?.datavalue?.value?.time)).filter(Boolean);
            const endsP582 = (ent.claims.P582||[]).map(c=> toYR(c.mainsnak?.datavalue?.value?.time)).filter(Boolean);
            const startsP571 = (ent.claims.P571||[]).map(c=> toYR(c.mainsnak?.datavalue?.value?.time)).filter(Boolean);
            const endsP576 = (ent.claims.P576||[]).map(c=> toYR(c.mainsnak?.datavalue?.value?.time)).filter(Boolean);
            const starts = [...startsP580, ...startsP571];
            const ends = [...endsP582, ...endsP576];
            const start = starts.length ? starts.reduce((a,b)=> (this._eraNum(a) <= this._eraNum(b) ? a : b)) : null;
            const end = ends.length ? ends.reduce((a,b)=> (this._eraNum(a) >= this._eraNum(b) ? a : b)) : null;
            const range = (start && end) ? { start, end } : null;
            if (range) this.setCache(cacheKey, range, { ttlMs: 1000*60*60*24 });
            return range;
        } catch(_) { return null; }
    }

        // Fetch a broad overview for a period: people, states, cities, culture, science, coinage, dynasties, movements, artifacts
        async _fetchPeriodOverview(qid, trace=null){
            if (!qid || !/^Q\d+$/i.test(qid)) return null;
            const cacheKey = `wikidata:overview:${qid.toUpperCase()}`;
            const hit = this.getCache(cacheKey); if (hit) return hit;

            console.log('overview: start for QID', qid);

                            const sparql = async (label, query) => {
                try {
                        const t0 = (window.performance?.now?.()||Date.now());
                        const data = await this._wdqsQuery(label, query, { timeout: 20000, maxRetries: 3, trace });
                    const rows = (data?.results?.bindings || []).map(r => ({
                        qid: (r.item?.value || '').split('/').pop(),
                        label: r.itemLabel?.value || '',
                        image: r.img?.value || null,
                        b: r.b?.value || null,
                        d: r.d?.value || null
                    })).filter(x => x.qid);
                    console.log('overview fetch', label, rows.length);
                        const dur = (window.performance?.now?.()||Date.now()) - t0;
                        this._tracePush(trace, { type:'overview', label, durationMs: Math.round(dur), resultCount: rows.length });
                    return rows;
                } catch (e) {
                    console.error('overview fetch error', label, e);
                        this._tracePush(trace, { type:'overview', label, durationMs: null, error: e?.message||String(e) });
                    return [];
                }
            };
                                const Q = (id)=> `wd:${String(id||'').toUpperCase()}`;
                                const valuesRoot = `VALUES ?root { ${Q(qid)} }`;
                                const valuesMov = `VALUES ?movcls { wd:Q49757 wd:Q9554 wd:Q469613 }`;
                                const valuesArtifact = `VALUES ?aclass { wd:Q220659 wd:Q860861 wd:Q1792644 wd:Q1789863 wd:Q133067 wd:Q1021291 }`;

                                // Queries (bind period as ?root, then match items whose P2348 period is a subperiod of ?root)
                                const qqPeople = `
SELECT DISTINCT ?item ?itemLabel ?img ?b ?d WHERE {
    ${valuesRoot}
    ?item wdt:P31 wd:Q5 .
    ?item wdt:P2348 ?period .
    ?period (wdt:P361)* ?root .
    OPTIONAL { ?item wdt:P18 ?img }
    OPTIONAL { ?item wdt:P569 ?b }
    OPTIONAL { ?item wdt:P570 ?d }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 40`;

                                const qqStates = `
SELECT DISTINCT ?item ?itemLabel ?img WHERE {
    ${valuesRoot}
    ?item wdt:P2348 ?period .
    ?period (wdt:P361)* ?root .
    OPTIONAL { ?item wdt:P18 ?img }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 40`;

                                const qqCities = `
SELECT DISTINCT ?item ?itemLabel ?img WHERE {
    ${valuesRoot}
    ?item wdt:P31/wdt:P279* wd:Q515 .
    ?item wdt:P2348 ?period .
    ?period (wdt:P361)* ?root .
    OPTIONAL { ?item wdt:P18 ?img }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 40`;

                                const qqCulture = `
SELECT DISTINCT ?item ?itemLabel ?img WHERE {
    ${valuesRoot}
    ?item wdt:P2348 ?period .
    ?period (wdt:P361)* ?root .
    OPTIONAL { ?item wdt:P18 ?img }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 30`;

                                const qqScience = `
SELECT DISTINCT ?item ?itemLabel ?img WHERE {
    ${valuesRoot}
    ?item wdt:P2348 ?period .
    ?period (wdt:P361)* ?root .
    OPTIONAL { ?item wdt:P18 ?img }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 30`;

                                const qqCoin = `
SELECT DISTINCT ?item ?itemLabel ?img WHERE {
    ${valuesRoot}
    ?item wdt:P2348 ?period .
    ?period (wdt:P361)* ?root .
    OPTIONAL { ?item wdt:P18 ?img }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 30`;

                                const qqDyn = `
SELECT DISTINCT ?item ?itemLabel ?img WHERE {
    ${valuesRoot}
    ?item wdt:P31/wdt:P279* wd:Q3624078 .
    ?item wdt:P2348 ?period .
    ?period (wdt:P361)* ?root .
    OPTIONAL { ?item wdt:P18 ?img }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 30`;

                                const qqMov = `
SELECT DISTINCT ?item ?itemLabel ?img WHERE {
    ${valuesRoot}
    ${valuesMov}
    ?item wdt:P31/wdt:P279* ?movcls .
    ?item wdt:P2348 ?period .
    ?period (wdt:P361)* ?root .
    OPTIONAL { ?item wdt:P18 ?img }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 30`;

                                const qqArtifacts = `
SELECT DISTINCT ?item ?itemLabel ?img WHERE {
    ${valuesRoot}
    ${valuesArtifact}
    ?item wdt:P31/wdt:P279* ?aclass .
    ?item wdt:P2348 ?period .
    ?period (wdt:P361)* ?root .
    OPTIONAL { ?item wdt:P18 ?img }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 30`;

                // Run in parallel
                const [people, states, cities, culture, science, coinage, dynasties, movements, artifacts] = await Promise.all([
                    sparql('people', qqPeople),
                    sparql('states', qqStates),
                    sparql('cities', qqCities),
                    sparql('culture', qqCulture),
                    sparql('science', qqScience),
                    sparql('coinage', qqCoin),
                    sparql('dynasties', qqDyn),
                    sparql('movements', qqMov),
                    sparql('artifacts', qqArtifacts)
                ]);

                const overview = { people, states, cities, culture, science, coinage, dynasties, movements, artifacts };
                this.setCache(cacheKey, overview, { ttlMs: 1000*60*60*24 });
                return overview;
        }

    

    async _fetchRulersForPeriod(qid, trace=null){
        if (!qid || !/^Q\d+$/i.test(qid)) return [];
        const cacheKey = `wikidata:rulers:${qid.toUpperCase()}`;
        const hit = this.getCache(cacheKey); if (hit) return hit;
        const query = `
SELECT ?ruler ?rulerLabel ?start ?end WHERE {
  VALUES ?period { wd:${qid.toUpperCase()} }
  ?ruler wdt:P31 wd:Q5 .
  ?ruler p:P39 ?posStmt .
  ?posStmt ps:P39 ?position .
  OPTIONAL { ?posStmt pq:P580 ?start. }
  OPTIONAL { ?posStmt pq:P582 ?end. }
  OPTIONAL { ?posStmt pq:P1001 ?jurisdiction. }
  OPTIONAL { ?posStmt pq:P642 ?of. }
  FILTER( (?jurisdiction = ?period) || (?of = ?period) )
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?start`;
        try {
            const data = await this._wdqsQuery('rulers', query, { timeout: 60000, maxRetries: 2, trace });
            const toYR = (t)=>{ if (!t) return null; const m = String(t).match(/^[+-]?(\d{1,4})-/); if (!m) return null; const year = parseInt(m[1],10); const era = String(t).startsWith('-')?'BCE':'CE'; return { year, era }; };
            const rows = (data?.results?.bindings||[]).map(r=>({
                qid: (r.ruler?.value||'').split('/').pop(),
                label: r.rulerLabel?.value || '',
                start: toYR(r.start?.value || null),
                end: toYR(r.end?.value || null)
            }));
            this.setCache(cacheKey, rows, { ttlMs: 1000*60*60*24 });
            return rows;
        } catch(_) { return []; }
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
        this._searchTerm = String(searchTerm || '');
        this.renderCoins();
    }

    // Sort coins
    sortCoins(sortBy, { skipRender = false } = {}) {
        const mode = this._sortCoinsInPlace(sortBy || this._currentSort || 'struck');
        this._currentSort = mode;
        if (!skipRender) this.renderCoins();
    }
}

// Ensure a global asset storage instance
const assetStorage = (window.assetStorage instanceof Object) ? window.assetStorage : new AssetStorage();
window.assetStorage = assetStorage;

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    await assetStorage.init().catch(() => {});
    // Dynamically load Three.js libraries if available
    try {
        if (!window.THREE) {
            // Attempt to load from CDN
            const scripts = [
                'https://unpkg.com/three@0.160.0/build/three.min.js',
                'https://unpkg.com/three@0.160.0/examples/js/loaders/GLTFLoader.js',
                'https://unpkg.com/three@0.160.0/examples/js/loaders/OBJLoader.js',
                'https://unpkg.com/three@0.160.0/examples/js/controls/OrbitControls.js',
                'https://unpkg.com/three@0.160.0/examples/js/loaders/DRACOLoader.js'
            ];
            for (const src of scripts) {
                await new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
            }
        }
        if (window.THREE) {
            THREE = window.THREE;
            GLTFLoader = window.THREE.GLTFLoader || window.GLTFLoader;
            OBJLoader = window.THREE.OBJLoader || window.OBJLoader;
            OrbitControls = window.THREE.OrbitControls || window.OrbitControls;
            DRACOLoader = window.THREE.DRACOLoader || window.DRACOLoader;
            threeJsAvailable = true;
        }
    } catch (_) { threeJsAvailable = false; }
    new CoinCollection();
});
