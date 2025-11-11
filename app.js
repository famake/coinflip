// Ancient Coin Collection App
// Import Three.js dynamically if available
let THREE, GLTFLoader, OBJLoader, OrbitControls, DRACOLoader;
let jsPDFLib = null, html2canvasLib = null;
let threeJsAvailable = false;

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
    { label: 'Late Roman Empire', from: { year: 284, era: 'CE' }, to: { year: 476, era: 'CE' }, slug: 'late_roman_empire' },
    { label: 'Ancient Greece', from: { year: 800, era: 'BCE' }, to: { year: 31, era: 'BCE' } },
    { label: 'Archaic Greece', from: { year: 800, era: 'BCE' }, to: { year: 480, era: 'BCE' } },
    { label: 'Classical Greece', from: { year: 480, era: 'BCE' }, to: { year: 323, era: 'BCE' } },
    { label: 'Peloponnesian War', from: { year: 431, era: 'BCE' }, to: { year: 404, era: 'BCE' } },
    { label: 'Athenian Empire', from: { year: 454, era: 'BCE' }, to: { year: 404, era: 'BCE' } },
    { label: 'Hellenistic Period', from: { year: 323, era: 'BCE' }, to: { year: 31, era: 'BCE' } }
];

// Cache version (bump when enrichment logic changes)
const ENRICH_CACHE_VERSION = 1;

// Lightweight IndexedDB asset storage for large files (e.g., 3D models)
class AssetStorage {
    constructor() {
        this.db = null;
        this.DB_NAME = 'CoinflipDB';
        this.STORE = 'assets';
        const scored = [];
        for (const p of PERIOD_FALLBACK) {
            let score = 0;
            if (yearStart != null && overlaps(p)) score += 100;
            if (lc && p.label.toLowerCase().includes(lc)) score += 40;
            if (/roman empire|principate/.test(p.label.toLowerCase())) score += 10;
            scored.push({ p, score });
        }
    async delete(id) {
        await this.init();
        return await new Promise((resolve, reject) => {
            const req = this._txn('readwrite').delete(id);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    }
}

// Main application class (wraps previously top-level methods)
class CoinCollection {
    constructor() {
        this.coins = [];
        this.editingCoinId = null;
        this.selectedForPrint = new Set();
        this.currentViewer = null;
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
                    
                        const snap = (this.coins.find(x=>x.id===coin.id)?.facts_snapshot) || null;
                        const pinfo = snap && snap.period_info;
                        const nmUri = (typeof coin.date==='object' && coin.date.nomisma_uri) ? this._normalizeNomismaUrl(coin.date.nomisma_uri) : (snap?.nomisma_period?.uri || null);
                        const thumbSrc = pinfo?.wikipedia?.thumbnail?.source || null;
                        const avatar = thumbSrc ? `<img class="ruler-avatar" src="${this.escapeHtml(thumbSrc)}" alt="${this.escapeHtml(pinfo?.label||'')}">` : '<div class="skeleton sk-avatar"></div>';
                        const fallbackLabel = (typeof coin.date==='object' ? (coin.date.label || '') : '') || (snap?.nomisma_period?.label || '');
                        const label = this.escapeHtml(pinfo?.label || fallbackLabel || '—');
                        let descRaw = pinfo?.description || (pinfo?.wikipedia?.extract) || (snap?.nomisma_period?.definition) || '';
                        if (/video game/i.test(String(descRaw))) { descRaw = snap?.nomisma_period?.definition || ''; }
                        const desc = this.escapeHtml(descRaw || '');
                        const wikiUrl = pinfo?.wikipedia?.content_urls?.desktop?.page || pinfo?.wikipedia?.content_urls?.mobile?.page || null;
                        const wdUrl = pinfo?.qid ? `https://www.wikidata.org/wiki/${pinfo.qid}` : null;
                        // Show selected exact date range
                        const exact = (typeof coin.date==='object') ? (coin.date.exact || null) : null;
                        const years = exact ? this.escapeHtml((() => {
                            const fy = exact.from?.year, fe = exact.from?.era || 'CE';
                            const ty = exact.to?.year, te = exact.to?.era || 'CE';
                            const approx = exact.approx ? 'c. ' : '';
                            if (fy && ty) return `${approx}${fy} – ${ty} ${fe===te?fe:(fe+' / '+te)}`;
                            if (fy) return `${approx}${fy} ${fe}`;
                            if (ty) return `${approx}${ty} ${te}`;
                            return '';
                        })()) : '';
                        const wikiBtn = wikiUrl ? `<a class="btn-link" href="${this.escapeHtml(wikiUrl)}" target="_blank" rel="noopener">🌐 Wikipedia</a>` : '';
                        const wdBtn = wdUrl ? `<a class="btn-link" href="${this.escapeHtml(wdUrl)}" target="_blank" rel="noopener">🗄️ Wikidata</a>` : '';
                        const nmBtn = nmUri ? `<a class="btn-link" href="${this.escapeHtml(nmUri)}" target="_blank" rel="noopener">🔗 Nomisma</a>` : '';
                        if (!label && !desc && !wikiBtn && !wdBtn && !nmBtn) return '';
                        console.debug('Period enrichment', {
                            nomismaId: nmUri,
                            wikidata: pinfo?.qid || (snap?.nomisma_period?.wikidata) || null,
                            wikipedia: pinfo?.wikipedia?.title || null,
                            fromNomismaExactMatch: !!pinfo?.fromNomismaExactMatch
                        });
                        // Removed stray period-card injection (handled later in viewCoin modal template)
                        return '';
                    

    // LocalStorage TTL cache helpers
    _cacheKey(key) { return `enrichCache:v${ENRICH_CACHE_VERSION}:${key}`; }
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

    _normalizeNomismaUrl(idOrUrl) {
        if (!idOrUrl) return null;
        let s = String(idOrUrl).trim();
        // Accept nm:slug compact form
        const mNm = s.match(/^nm:(.+)$/i);
        if (mNm) s = `https://nomisma.org/id/${mNm[1]}`;
        // Extract slug if full URL
        const mFull = s.match(/^https?:\/\/nomisma\.org\/id\/([^#?]+)$/i) || s.match(/^https?:\/\/nomisma\.org\/id\/([^#?]+)\.jsonld$/i);
        let slug = null;
        if (mFull) {
            slug = mFull[1];
        } else if (!/^https?:/i.test(s)) {
            // treat as slug
            slug = s.replace(/^\/+/, '');
        }
        if (!slug) return null;
        slug = slug.replace(/\.jsonld$/i, '').replace(/\/$/, '');
        return `https://nomisma.org/id/${slug}`;
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

        // Wikidata enrichment for authority (strictly if QID is sourced from Nomisma exactMatch only)
        const qidAuthority = qidFromNomismaAuthority || null;
        if ((typeof coin.ruler === 'object' && coin.ruler.wikidata_qid) && coin.ruler.wikidata_qid !== qidAuthority) {
            console.warn('Blocked enrichment: QID not sourced from Nomisma exactMatch for ruler', { provided: coin.ruler.wikidata_qid, nomisma: qidAuthority });
        }
        if (qidAuthority) {
            try {
                const authInfo = await this._enrichWikidataEntity(qidAuthority, 'authority');
                if (authInfo) snapshot.authority_info = authInfo;
            } catch (e) { console.debug('Authority enrichment failed', e); }
        }
        // Mint enrichment (only if QID from Nomisma)
        const qidMint = qidFromNomismaMint || null;
        if ((typeof coin.origin === 'object' && coin.origin.wikidata_qid) && coin.origin.wikidata_qid !== qidMint) {
            console.warn('Blocked enrichment: QID not sourced from Nomisma exactMatch for mint', { provided: coin.origin.wikidata_qid, nomisma: qidMint });
        }
        if (qidMint) {
            try {
                const mintInfo = await this._enrichWikidataEntity(qidMint, 'mint');
                if (mintInfo) snapshot.mint_info = mintInfo;
            } catch (e) { console.debug('Mint enrichment failed', e); }
        }
        // Period enrichment (only if QID from Nomisma)
        const qidPeriod = qidFromNomismaPeriod || null;
        if ((typeof coin.date === 'object' && coin.date.wikidata_qid) && coin.date.wikidata_qid !== qidPeriod) {
            console.warn('Blocked enrichment: QID not sourced from Nomisma exactMatch for period', { provided: coin.date.wikidata_qid, nomisma: qidPeriod });
        }
        if (qidPeriod) {
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
            const res = await this._fetchWithTimeout(entityUrl, { timeout: 12000 });
            const data = await res.json();
            lastEntityJson = data;
            const ent = data.entities && data.entities[qid];
            if (ent && ent.sitelinks && ent.sitelinks.enwiki) {
                wikipedia = await this._fetchWikipediaSummary(ent.sitelinks.enwiki.title);
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
        const mother = (claims.P25 && claims.P25[0] && claims.P25[0].mainsnak && claims.P25[0].mainsnak.datavalue && claims.P25[0].mainsnak.datavalue.value && claims.P25[0].mainsnak.datavalue.value.id) || null;
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
        // Coordinates (common in Nomisma with WGS84)
        const lat = getNum(pickProp(node, ['http://www.w3.org/2003/01/geo/wgs84_pos#lat','geo:lat'])) || null;
        const lon = getNum(pickProp(node, ['http://www.w3.org/2003/01/geo/wgs84_pos#long','geo:long'])) || null;
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
        // Toggle form visibility; if opening and not editing, reset to a clean add form
        document.getElementById('toggleFormBtn').addEventListener('click', () => {
            const formWrap = document.getElementById('addCoinForm');
            const willShow = formWrap.classList.contains('hidden');
            formWrap.classList.toggle('hidden');
            if (willShow && !this.editingCoinId) {
                this.resetFormToAddMode();
                // Show again after reset collapsed it
                document.getElementById('addCoinForm').classList.remove('hidden');
            }
        });

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
        this._initScopedNomisma('period', {
            inputId: 'coinDate',
            buttonId: 'periodSearchBtn',
            suggestId: 'periodSuggest',
            chipId: 'periodChip',
            types: ['period']
        });

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
            const ids = ['originSuggest','rulerSuggest','periodSuggest'];
            ids.forEach(id => {
                const box = document.getElementById(id);
                if (!box || box.style.display === 'none') return;
                const input = id==='originSuggest'? document.getElementById('coinOrigin') : id==='rulerSuggest' ? document.getElementById('coinRuler') : document.getElementById('coinDate');
                const btn = id==='originSuggest'? document.getElementById('originSearchBtn') : id==='rulerSuggest'? document.getElementById('rulerSearchBtn') : document.getElementById('periodSearchBtn');
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
    const exportBtnJsonLd = document.getElementById('exportJsonLdBtn');
        const importBtnJson = document.getElementById('importJsonBtn');
        const importFile = document.getElementById('importJsonFile');
    if (exportBtnJson) exportBtnJson.addEventListener('click', () => this.exportCollection());
    if (exportBtnJsonLd) exportBtnJsonLd.addEventListener('click', () => this.exportCollectionJsonLd());
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

    // Build JSON-LD graph for the whole collection and download
    exportCollectionJsonLd() {
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
                    // Pattern-based inference for Crawford numbers (RRC/Crawford 1234)
                    const crawfordRe = /\b(?:RRC|Crawford)\s*(\d{1,4})([ABab]?)/g;
                    while ((m = crawfordRe.exec(s)) !== null) {
                        const num = m[1];
                        out.add(`https://numismatics.org/crro/id/rrc-${num}`);
                    }
                };
                addIf(coin.references);
                // Future: inspect other fields (external_ids) for explicit type URIs
                if (Array.isArray(coin.typeSeriesUris)) coin.typeSeriesUris.forEach(u=> out.add(u));
                return Array.from(out);
            };
            for (const coin of this.coins) {
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
                // Temporal information as readable label + exact years if present
                const dateLabel = (typeof coin.date === 'object') ? (coin.date.label || '') : (coin.date || '');
                const exact = (typeof coin.date === 'object') ? (coin.date.exact || null) : null;
                const dateText = [dateLabel, this._formatDateRange(exact)].filter(Boolean).join(' ');
                if (dateText) node['dcterms:temporal'] = [{ '@value': dateText }];
                // Type series items (e.g., OCRE URIs) if present in references
                const typeUris = extractTypeSeriesUris(coin);
                if (typeUris.length) {
                    node['nmo:hasTypeSeriesItem'] = typeUris.map(u => ({ '@id': u }));
                }
                // Obverse/Reverse images
                const img0 = coin.images && coin.images[0];
                const img1 = coin.images && coin.images[1];
                if (img0) {
                    const obvId = `${coinId}#obverse`;
                    node['nmo:hasObverse'] = [{ '@id': obvId }];
                    graph.push({ '@id': obvId, 'foaf:depiction': [{ '@id': img0 }] });
                }
                if (img1) {
                    const revId = `${coinId}#reverse`;
                    node['nmo:hasReverse'] = [{ '@id': revId }];
                    graph.push({ '@id': revId, 'foaf:depiction': [{ '@id': img1 }] });
                }
                // Description, references
                if (coin.description) node['dcterms:description'] = [{ '@value': String(coin.description) }];
                if (coin.references) node['dcterms:bibliographicCitation'] = [{ '@value': String(coin.references) }];
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
    // Date/Period exact range + flags
    if (typeof coin.date === 'object' && coin.date) {
        const hiddenPeriod = document.getElementById('coinDate');
        if (hiddenPeriod) hiddenPeriod.value = coin.date.label || '';
        const ex = coin.date.exact || null;
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
    } else {
        const hiddenPeriod = document.getElementById('coinDate');
        if (hiddenPeriod) hiddenPeriod.value = typeof coin.date === 'string' ? (coin.date || '') : '';
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
        const periodChip = document.getElementById('periodChip');
        const periodInput = document.getElementById('coinDate');
        if (coin.date && typeof coin.date === 'object' && periodChip && periodInput) {
            if (coin.date.nomisma_uri) {
                periodInput.dataset.nomismaUri = coin.date.nomisma_uri;
                periodInput.dataset.nomismaQid = coin.date.wikidata_qid || '';
                periodInput.dataset.nomismaLabel = coin.date.label || '';
                periodChip.innerHTML = this._renderChip(coin.date.label || '', coin.date.nomisma_uri);
            } else if (coin.date.label) {
                periodInput.dataset.nomismaLabel = coin.date.label;
                periodChip.innerHTML = `<span class="chip">${this.escapeHtml(coin.date.label)}<button type="button" class="chip-remove" title="Remove link">×</button></span>`;
            }
        }
        // Enrichment toggles (consolidated)
    // Enrichment toggles removed; enrichment now automatic based on linked fields.
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
        const approx = document.getElementById('dateApprox'); if (approx) approx.checked = false;
        // Clear hidden period input & chip
        const hiddenPeriod = document.getElementById('coinDate'); if (hiddenPeriod) { hiddenPeriod.value=''; delete hiddenPeriod.dataset.nomismaUri; delete hiddenPeriod.dataset.nomismaQid; delete hiddenPeriod.dataset.nomismaLabel; }
        const periodChip = document.getElementById('periodChip'); if (periodChip) periodChip.innerHTML='';
        // Clear origin/ruler chips & datasets
        const origin = document.getElementById('coinOrigin'); if (origin) { delete origin.dataset.nomismaUri; delete origin.dataset.nomismaQid; delete origin.dataset.nomismaLabel; }
        const originChip = document.getElementById('originChip'); if (originChip) originChip.innerHTML='';
        const ruler = document.getElementById('coinRuler'); if (ruler) { delete ruler.dataset.nomismaUri; delete ruler.dataset.nomismaQid; delete ruler.dataset.nomismaLabel; }
        const rulerChip = document.getElementById('rulerChip'); if (rulerChip) rulerChip.innerHTML='';
        // Clear material selection and chip
        const matSel = document.getElementById('coinMaterialSelect'); if (matSel) matSel.value='';
        const matOther = document.getElementById('coinMaterialOther'); if (matOther) { matOther.value=''; matOther.style.display='none'; }
        const matInfo = document.getElementById('materialLinkInfo'); if (matInfo) matInfo.innerHTML='';
        // Clear reference menu any leftover
        const refMenu = document.getElementById('refSearchMenu'); if (refMenu) refMenu.style.display='none';
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
    // Enrichment options removed; always enrich linked fields automatically.

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
            // Update type series URIs derived from references
            coin.typeSeriesUris = this._extractTypeSeriesFromReferences(references);
            coin.external_ids = coin.external_ids || { nomisma: null, wikidata: null, searchUrls: null };
            coin.external_ids.nomisma = nomismaId || coin.external_ids.nomisma || null;
            // enrichment_opts removed
            coin.obverse = obverse;
            coin.reverse = reverse;

            // Replace images only if new ones were selected
            let prevImagesForEdit = null;
            if (imageFiles && imageFiles.length > 0) {
                prevImagesForEdit = Array.isArray(coin.images) ? coin.images.slice() : [];
                coin.images = [];
                for (let file of imageFiles) {
                    const base64 = await this.compressImage(file, { maxDim: 1600, quality: 0.85 });
                    if (base64) coin.images.push(base64);
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
                if (err && err.message === 'LOCALSTORAGE_QUOTA' && imageFiles && imageFiles.length > 0) {
                    // Retry with stronger compression
                    try {
                        const prevImages = Array.isArray(coin.images) ? coin.images.slice() : [];
                        coin.images = [];
                        for (let file of imageFiles) {
                            const base64 = await this.compressImage(file, { maxDim: 1200, quality: 0.75 });
                            if (base64) coin.images.push(base64);
                        }
                        this.saveCoins();
                        this.renderCoins();
                        coin.enrichment_status = 'stale';
                        try { await this.enrichCoin(coin.id, { force: true, linksOnly: false }); } catch (_) {}
                        this.resetFormToAddMode();
                        return;
                    } catch (e2) {
                        // Rollback images to previous state and clear file input
                        try { if (prevImagesForEdit) coin.images = prevImagesForEdit; } catch(_){ }
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
            // enrichment_opts removed
            typeSeriesUris: this._extractTypeSeriesFromReferences(references)
        };

        // Process images (initial compression)
        for (let file of imageFiles) {
            const base64 = await this.compressImage(file, { maxDim: 1600, quality: 0.85 });
            if (base64) coin.images.push(base64);
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
            if (!term && field !== 'period') { suggest.style.display='none'; return; }
            suggest.innerHTML = '<div class="suggest-items"><div class="suggest-item"><span class="s-label">Searching Nomisma…</span></div></div>';
            suggest.style.display = 'block';
            let items = [];
            try {
                items = term ? await this.searchNomismaByType(term, types) : [];
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
            // Build manual "Use as plain text" option when there's a term
            const manual = term ? [{ id: '', label: term, labelOnly: true, isPlain: true }] : [];
            const isPeriod = field === 'period';
            const itemsForContext = items && items.length ? items : [];
            // Decide display order: for period, append manual at end; for others, put manual first
            const displayItems = (items && items.length)
                ? (isPeriod ? [...items, ...manual] : [...manual, ...items])
                : (manual.length ? manual : []);
            if (displayItems.length === 0) {
                suggest.innerHTML = '<div class="suggest-items"><div class="suggest-item"><span class="s-label">No suggestions</span></div></div>';
                return;
            }
            // Mark first item as primary for period suggestions (exclude manual-only case)
            suggest.innerHTML = `<div class="suggest-items">${displayItems.map((it,idx)=>{
                const primaryClass = (isPeriod && idx===0 && !it.isPlain) ? 'suggest-primary' : '';
                const labelText = it.isPlain ? `Use as plain text: \u201C${this.escapeHtml(it.label)}\u201D` : this.escapeHtml(it.label);
                const dataLabel = this.escapeHtml(it.label);
                const dataUri = it.id || '';
                const dataQid = it.qid || '';
                const labelOnly = it.labelOnly ? '1' : '0';
                const idHtml = it.labelOnly ? '' : `<span class=\"s-id\">${this.escapeHtml(it.id)}</span>`;
                return `<div class=\"suggest-item ${primaryClass}\" data-uri=\"${dataUri}\" data-qid=\"${dataQid}\" data-label-only=\"${labelOnly}\" data-label=\"${dataLabel}\">`
                       + `<span class=\"s-label\">${labelText}</span>`
                       + `${idHtml}`
                       + `</div>`;
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
                    if (field === 'period') this._updatePeriodContext();
                });
            });
            if (field === 'period') this._updatePeriodContext(itemsForContext);
        };
        btn.addEventListener('click', search);
        input.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); search(); }});
        // Clear chip if user edits value
        input.addEventListener('input', ()=>{ delete input.dataset.nomismaUri; delete input.dataset.nomismaQid; delete input.dataset.nomismaLabel; chipWrap.innerHTML=''; });
        // Auto-suggest on year range edits (period only)
        if (field === 'period') {
            const sy = document.getElementById('dateStartYear');
            const ey = document.getElementById('dateEndYear');
            const approx = document.getElementById('dateApprox');
            // Year changes only update context; Find Period button does the search
            const hookYears = ()=>{ this._updatePeriodContext(); };
            sy?.addEventListener('input', hookYears);
            ey?.addEventListener('input', hookYears);
            approx?.addEventListener('change', ()=>{ this._updatePeriodContext(); if (approx.checked && ey) { ey.value=''; } });
        }
    }

    _renderChip(label, uri){
        if (!uri) {
            return `<span class="chip">${this.escapeHtml(label)}<button type="button" class="chip-remove" title="Remove link">×</button></span>`;
        }
        return `<span class="chip">${this.escapeHtml(label)}<a class="chip-link" href="${this.escapeHtml(uri)}" target="_blank" aria-label="Open Nomisma" title="Open on nomisma.org">🔗</a><button type="button" class="chip-remove" title="Remove link">×</button></span>`;
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
        // Label-only chip for non-period fields
        if (field !== 'period' && el && el.dataset.nomismaLabel && !el.dataset.nomismaUri) {
            return { label: el.dataset.nomismaLabel, nomisma_uri: null, wikidata_qid: null };
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

    _updatePeriodContext(suggestions){
        try {
            const host = document.getElementById('periodContext');
            if (!host) return;
            const sy = document.getElementById('dateStartYear');
            const se = document.getElementById('dateStartEra');
            const ey = document.getElementById('dateEndYear');
            const ee = document.getElementById('dateEndEra');
            const sYear = sy?.value ? parseInt(sy.value,10) : null;
            const approxChecked = document.getElementById('dateApprox')?.checked;
            const eYear = approxChecked ? null : (ey?.value ? parseInt(ey.value,10) : null);
            const sEra = se?.value || 'CE';
            const eEra = ee?.value || 'CE';
            const approx = approxChecked ? 'c. ' : '';
            const buildYear = (y, era)=> y!=null? `${y} ${era}`:'';
            const rangeText = (sYear||eYear)? `${approx}${[buildYear(sYear,sEra), approxChecked? '' : buildYear(eYear,eEra)].filter(Boolean).join(' – ')}` : '';
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

    // Nomisma SPARQL search by label/altLabel (broad types wrapper)
    async searchNomisma(term) {
        try {
            const types = ['person','authority','place','mint','period'];
            return await this.searchNomismaByType(term, types);
        } catch (_) {
            return [];
        }
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
                const url = `${base}?query=${encodeURIComponent(ask)}&format=application%2Fsparql-results%2Bjson`;
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
        // Helpers for display
        const snap = (this.coins.find(x=>x.id===coin.id)?.facts_snapshot) || null;
        const nbsp = '\u00A0';
        const nnbsp = '\u202F';
        const formatNum = (v, opts={}) => {
            if (v == null || v === '') return '';
            const num = Number(String(v).replace(/[^0-9.\-]/g,''));
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
            if (fy && ty) {
                if (fe === te) return `${approx}${fy}–${ty} ${fe}`;
                return `${approx}${fy} ${fe} – ${ty} ${te}`;
            }
            if (fy) return `${approx}${fy} ${fe}`;
            if (ty) return `${approx}${ty} ${te}`;
            return '';
        };
        const graceful = (s) => {
            const t = String(s || '').trim();
            return t ? this.escapeHtml(t) : '—';
        };
        // Prepare linked display values
        const formatDateOnly = () => {
            const exact = (typeof coin.date==='object') ? (coin.date.exact || null) : null;
            return graceful(formatCompactDateRange(exact));
        };
        const formatPeriod = () => {
            const lbl = (typeof coin.date==='object') ? (coin.date.label || '') : '';
            const uri = (typeof coin.date==='object' && coin.date.nomisma_uri) ? this._normalizeNomismaUrl(coin.date.nomisma_uri) : null;
            if (!lbl && !uri) return '';
            const labelText = graceful(lbl);
            return uri ? `<a href="${this.escapeHtml(uri)}" target="_blank" rel="noopener" title="Open on nomisma.org">${labelText}</a>` : labelText;
        };
        const formatOrigin = () => {
            if (!coin.origin) return '';
            // Prefer Nomisma-enriched label
            const nmLabel = snap?.nomisma_origin?.label || null;
            const labelRaw = nmLabel || ((typeof coin.origin==='object') ? (coin.origin.label || '') : (coin.origin || ''));
            const label = labelRaw ? (labelRaw.charAt(0).toUpperCase() + labelRaw.slice(1)) : '';
            const uri = (typeof coin.origin==='object' && coin.origin.nomisma_uri) ? this._normalizeNomismaUrl(coin.origin.nomisma_uri) : null;
            if (uri && label) return `<a href="${this.escapeHtml(uri)}" target="_blank" rel="noopener" title="Open on nomisma.org">${this.escapeHtml(label)}</a>`;
            return this.escapeHtml(label);
        };
        const formatRuler = () => {
            if (!coin.ruler) return '';
            const label = (typeof coin.ruler==='object') ? (coin.ruler.label || '') : (coin.ruler || '');
            const uri = (typeof coin.ruler==='object' && coin.ruler.nomisma_uri) ? this._normalizeNomismaUrl(coin.ruler.nomisma_uri) : null;
            if (uri && label) return `<a href="${this.escapeHtml(uri)}" target="_blank" rel="noopener" title="Open on nomisma.org">${this.escapeHtml(label)}</a>`;
            return this.escapeHtml(label);
        };
        const matLabel = (coin.material && typeof coin.material==='object') ? (coin.material.label || '') : (coin.material || '');
    const matUri = this._mapMaterialToNomisma(coin.material);
        const formatMaterial = () => {
            if (!matLabel) return '';
            if (!matUri) return this.escapeHtml(matLabel);
            // Link only the material word, keep code suffix (e.g., (AR)) unlinked
            const m = String(matLabel).match(/^(.*?)(\s*\([^)]*\))?$/);
            const base = (m && m[1]) ? m[1] : matLabel;
            const suffix = (m && m[2]) ? m[2] : '';
            return `<a href="${this.escapeHtml(matUri)}" target="_blank" rel="noopener" title="Open on nomisma.org">${this.escapeHtml(base)}</a>${this.escapeHtml(suffix)}`;
        };
        const linkifySafe = (s) => {
            if (!s) return '';
            const urlRe = /https?:\/\/[^\s)]+/gi;
            const parts = [];
            let last = 0;
            let m;
            while ((m = urlRe.exec(s)) !== null) {
                if (m.index > last) parts.push({ t:'text', v: s.slice(last, m.index) });
                parts.push({ t:'url', v: m[0] });
                last = m.index + m[0].length;
            }
            if (last < s.length) parts.push({ t:'text', v: s.slice(last) });
            return parts.map(p => p.t==='url' ? `<a href="${this.escapeHtml(p.v)}" target="_blank" rel="noopener">${this.escapeHtml(p.v)}</a>` : this.escapeHtml(p.v)).join('');
        };
        const formatReferences = (s) => {
            if (!s) return '';
            let t = String(s).trim();
            t = t.replace(/^\s*references\s*:\s*/i, ''); // remove leading label
            // Normalize separators to semicolon + space
            const parts = t.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
            return parts.map(this.escapeHtml).join('; ');
        };
        // Resolve authority label (WD > Nomisma > chip)
        const authorityInfo = snap?.authority_info || null;
        const nmRulerLabel = snap?.nomisma_ruler?.label || (typeof coin.ruler==='object' ? coin.ruler.label : '') || '';
        const resolvedRulerLabel = authorityInfo?.label || nmRulerLabel || '';
        const reignText = (() => {
            const c = authorityInfo?.claims_parsed?.reign || null;
            if (!c) return '';
            const exact = { from: c.start || null, to: c.end || null };
            const s = formatCompactDateRange(exact);
            return s ? `r. ${s}` : '';
        })();

        modalBody.innerHTML = `
            <div class="modal-header">
                <h2>${this.escapeHtml(coin.name)}</h2>
                <div class="modal-actions">
                    <button id="refreshSnapshotBtn" class="btn-secondary">Refresh snapshot</button>
                    <button id="editCoinBtn" class="btn-secondary">Edit</button>
                </div>
            </div>
            <div class="modal-subdivider"></div>

            ${coin.images.length > 0 ? `
                <div class="modal-media ${coin.images.length>1 ? 'grid-2' : ''}">
                    ${coin.images.slice(0,2).map((img,i) => `
                        <div class="img-wrap">
                            <img class="img-main" src="${img}" alt="${this.escapeHtml(coin.name)} ${i===0?'(obverse)':'(reverse)'}">
                        </div>
                    `).join('')}
                </div>
                ${coin.images.length>2 ? `<div class=\"modal-thumbs\">${coin.images.slice(2).map((img,ti)=>`<img src=\"${img}\" alt=\"thumb\" data-thumb-index=\"${ti+2}\">`).join('')}</div>`:''}
            ` : ''}

            ${coin.model3D ? `
                <div class="modal-3d-viewer">
                    <h3>360° 3D View</h3>
                    <div id="viewer3D"></div>
                </div>
            ` : ''}

            <div class="modal-grid">
                <div class="left-col">
                    <div class="card">
                        <h3>Basic Information</h3>
                        <div class="dl-grid cols-2 dl">
                            ${(typeof coin.date==='object' && coin.date.exact) ? `
                                <div>
                                    <dt>Date</dt>
                                    <dd>${formatDateOnly()}</dd>
                                </div>
                            `:''}
                            ${(typeof coin.date==='object' && (coin.date.label || coin.date.nomisma_uri)) ? `
                                <div>
                                    <dt>Period</dt>
                                    <dd>${formatPeriod()}</dd>
                                </div>
                            `:''}
                            ${coin.origin ? `
                                <div>
                                    <dt>Origin/Mint</dt>
                                    <dd>${formatOrigin()}</dd>
                                </div>
                            `:''}
                            ${ (coin.ruler || resolvedRulerLabel) ? `
                                <div>
                                    <dt>Ruler/Authority</dt>
                                    <dd>
                                        ${(() => {
                                            const nmUri = (typeof coin.ruler==='object' && coin.ruler.nomisma_uri) ? this._normalizeNomismaUrl(coin.ruler.nomisma_uri) : (snap?.nomisma_ruler?.uri || null);
                                            const label = this.escapeHtml(resolvedRulerLabel || (typeof coin.ruler==='object' ? (coin.ruler.label||'') : (coin.ruler||'')));
                                            const nameHtml = nmUri ? `<a href="${this.escapeHtml(nmUri)}" target="_blank" rel="noopener">${label}</a>` : label;
                                            const reignHtml = reignText ? `<div class=\"text-muted\" style=\"font-size:12px\">${this.escapeHtml(reignText)}</div>` : '';
                                            return `${nameHtml}${reignHtml}`;
                                        })()}
                                    </dd>
                                </div>
                            `:''}
                            ${(coin.typeSeriesUris && coin.typeSeriesUris.length) ? `
                                <div>
                                    <dt>Type Series</dt>
                                    <dd>${coin.typeSeriesUris.map(u=>`<a href=\"${this.escapeHtml(u)}\" target=\"_blank\" rel=\"noopener\">${this.escapeHtml(u.split('/').pop())}</a>`).join(', ')}</dd>
                                </div>
                            `:''}
                        </div>
                    </div>

                    <div class="card">
                        <h3>Physical Details</h3>
                        <div class="dl-grid cols-2 dl">
                            ${coin.material ? `
                                <div>
                                    <dt>Material</dt>
                                    <dd>${formatMaterial()}</dd>
                                </div>
                            `:''}
                            ${(coin.weight || coin.weight===0) ? `
                                <div>
                                    <dt>Weight</dt>
                                    <dd>${formatUnit(coin.weight, 'g')}</dd>
                                </div>
                            `:''}
                            ${(coin.diameter || coin.diameter===0) ? `
                                <div>
                                    <dt>Diameter</dt>
                                    <dd>${formatUnit(coin.diameter, 'mm')}</dd>
                                </div>
                            `:''}
                        </div>
                    </div>

                    ${(coin.obverse || coin.reverse) ? `
                    <div class="card">
                        <h3><span class="section-header-icon owl">🦉</span> Coin Sides</h3>
                        ${coin.obverse ? `<div class=\"dl\"><dt>Obverse</dt><dd>${this.escapeHtml(coin.obverse)}</dd></div>`:''}
                        ${coin.reverse ? `<div class=\"divider\"></div><div class=\"dl\"><dt>Reverse</dt><dd>${this.escapeHtml(coin.reverse)}</dd></div>`:''}
                    </div>`:''}

                    ${coin.description ? `
                    <div class="card">
                        <h3>Description & Notes</h3>
                        <p class="desc-clamp" id="descText">${this.escapeHtml(coin.description)}</p>
                        <button id="descToggle" class="show-more" aria-expanded="false" hidden>Show more</button>
                    </div>`:''}
                </div>

                <div class="right-col">
                    ${(() => {
                        // Removed duplicated period-card block
                        return '';
                        const wdBtn = wdUrl ? `<a class=\"btn-link\" href=\"${this.escapeHtml(wdUrl)}\" target=\"_blank\" rel=\"noopener\">🗄️ Wikidata</a>` : '';
                        const nmBtn = nmUri ? `<a class=\"btn-link\" href=\"${this.escapeHtml(nmUri)}\" target=\"_blank\" rel=\"noopener\">🔗 Nomisma</a>` : '';
                        console.debug('Ruler enrichment', {
                            nomismaId: nmUri,
                            wikidata: info?.qid || (snap?.nomisma_ruler?.wikidata) || null,
                            wikipedia: info?.wikipedia?.title || null,
                            fromNomismaExactMatch: !!info?.fromNomismaExactMatch
                        });
                        return `
                        <div class=\"card\" id=\"ruler-card\">
                            <h3>About the ruler</h3>
                            <div class=\"ruler-card\">
                                ${avatar}
                                <div>
                                    <div class=\"ruler-name-row\"><div class=\"ruler-name\">${label}</div> ${years?`<span class=\"years\">${years}</span>`:''}</div>
                                    ${desc ? `<div class=\"ruler-desc clamp\">${desc}</div>` : `<div class=\"ruler-desc\" style=\"color:#6b7280\">No additional biography available.</div>`}
                                    ${factsList.length ? `<div class=\"ruler-facts\"><ul>${factsList.join('')}</ul></div>`:''}
                                    <div class=\"btn-group\" style=\"margin-top:10px\">${wikiBtn}${wdBtn}${nmBtn}</div>
                                </div>
                            </div>
                        </div>`;
                    })()}

                    ${(coin.references || (coin.typeSeriesUris && coin.typeSeriesUris.length)) ? `
                    <div class=\"card\">
                        <h3>References</h3>
                        <div class=\"chips\">
                            ${(() => {
                                const parts = formatReferences(coin.references).split('; ').filter(Boolean);
                                const items = [];
                                parts.forEach(p => {
                                    const url = /^https?:\/\//i.test(p) ? p : null;
                                    if (url) items.push(`<span class=\"chip\"><a href=\"${this.escapeHtml(url)}\" target=\"_blank\" rel=\"noopener\">${this.escapeHtml(p)}</a><span class=\"ext\">↗</span></span>`);
                                    else items.push(`<span class=\"chip\">${this.escapeHtml(p)}</span>`);
                                });
                                (coin.typeSeriesUris||[]).forEach(u => items.push(`<span class=\"chip\"><a href=\"${this.escapeHtml(u)}\" target=\"_blank\" rel=\"noopener\">${this.escapeHtml(u.split('/').pop())}</a><span class=\"ext\">↗</span></span>`));
                                return items.join(' ');
                            })()}
                        </div>
                    </div>`:''}
                </div>
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
        const refreshBtn = document.getElementById('refreshSnapshotBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true; refreshBtn.textContent = 'Refreshing…';
                try { await this.enrichCoin(coin.id, { force: true, linksOnly: false }); } catch(_) {}
                // Re-render modal with fresh snapshot
                this.viewCoin(coin.id);
            });
        }
        // Delete button removed from modal (bulk delete via selection bar)

    // Wire image lightbox on click
    const modalImgs = document.querySelectorAll('.modal-media .img-main, .modal-thumbs img');
        if (modalImgs && modalImgs.length > 0) {
            const urls = coin.images.slice();
            modalImgs.forEach((imgEl, idx) => {
                imgEl.style.cursor = 'zoom-in';
                imgEl.addEventListener('click', () => {
                    // If clicking thumb, use its data index
                    const tIdx = imgEl.getAttribute('data-thumb-index');
                    const start = tIdx ? parseInt(tIdx,10) : idx;
                    // Highlight selected thumb
                    document.querySelectorAll('.modal-thumbs img').forEach(t => t.classList.remove('selected'));
                    if (tIdx) imgEl.classList.add('selected');
                    this.openImageLightbox(urls, start);
                });
            });
        }

        // Initialize 3D viewer if model exists (delayed to ensure DOM is ready)
        if (coin.model3D) {
            setTimeout(() => this.init3DViewer(coin.model3D), VIEWER_INIT_DELAY);
        }

        // Description expander
        const descEl = document.getElementById('descText');
        const toggle = document.getElementById('descToggle');
        if (descEl && toggle) {
            // Check if clamped
            setTimeout(() => {
                if (descEl.scrollHeight > descEl.clientHeight + 4) toggle.hidden = false;
            }, 0);
            toggle.addEventListener('click', () => {
                const expanded = toggle.getAttribute('aria-expanded') === 'true';
                toggle.setAttribute('aria-expanded', String(!expanded));
                if (expanded) { descEl.classList.add('desc-clamp'); toggle.textContent = 'Show more'; }
                else { descEl.classList.remove('desc-clamp'); toggle.textContent = 'Show less'; }
            });
        }

        // Enrich parent labels asynchronously, if present
        (async () => {
            try {
                const claims = authorityInfo?.claims_parsed || null;
                const parents = claims?.parents || null;
                if (parents) {
                    const labelMap = await this._fetchWikidataLabels([parents.father, parents.mother].filter(Boolean));
                    Object.keys(labelMap).forEach(q => {
                        document.querySelectorAll(`.wd-label[data-qid="${q}"]`).forEach(el => { el.textContent = labelMap[q]; });
                    });
                }
            } catch (_) {}
        })();
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
        // Crawford / RRC numeric references -> CRRO inferred URI
        const crawfordRe = /\b(?:RRC|Crawford)\s*(\d{1,4})([ABab]?)/g;
        while ((m = crawfordRe.exec(refText)) !== null) {
            const num = m[1];
            out.add(`https://numismatics.org/crro/id/rrc-${num}`);
        }
        return Array.from(out);
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

        let canZoom = true;
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
