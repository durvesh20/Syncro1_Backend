'use strict';
/**
 * services/cityNormalizer.js
 *
 * Normalizes Indian city names to a canonical form and matches metro clusters
 * so that Bangalore == Bengaluru, Gurgaon == Gurugram, Bombay == Mumbai, etc.
 *
 * Used by candidateScoringService._scoreLocation() and aiService._scoreLocation()
 */

// canonical → all known lowercase variants
const CITY_ALIAS_MAP = {
  // ── Karnataka ────────────────────────────────────────────────
  bengaluru:   ['bengaluru', 'bangalore', 'bangaluru', 'banglore', 'bengalore',
                'bangalore city', 'blr', 'bang'],
  mysuru:      ['mysuru', 'mysore'],
  mangaluru:   ['mangaluru', 'mangalore'],
  hubli:       ['hubli', 'hubballi', 'hubli-dharwad', 'hubli dharwad'],

  // ── Maharashtra ──────────────────────────────────────────────
  mumbai:      ['mumbai', 'bombay', 'navi mumbai', 'new mumbai', 'navimumbai', 'mum'],
  pune:        ['pune', 'puna', 'poona'],
  nagpur:      ['nagpur'],
  nashik:      ['nashik', 'nasik'],
  aurangabad:  ['aurangabad', 'chhatrapati sambhajinagar', 'sambhajinagar'],

  // ── Tamil Nadu ───────────────────────────────────────────────
  chennai:     ['chennai', 'madras', 'chn'],
  coimbatore:  ['coimbatore', 'kovai'],
  tiruchirappalli: ['tiruchirappalli', 'trichy', 'tiruchirapalli', 'trichinopoly'],
  madurai:     ['madurai'],

  // ── Delhi NCR ────────────────────────────────────────────────
  delhi:       ['delhi', 'new delhi', 'ncr', 'delhi ncr', 'national capital region',
                'north delhi', 'south delhi', 'east delhi', 'west delhi', 'central delhi',
                'new delhi city'],
  gurugram:    ['gurugram', 'gurgaon', 'gurg'],
  noida:       ['noida', 'greater noida'],
  ghaziabad:   ['ghaziabad'],
  faridabad:   ['faridabad'],

  // ── Uttar Pradesh ────────────────────────────────────────────
  lucknow:     ['lucknow', 'lko'],
  agra:        ['agra'],
  kanpur:      ['kanpur'],
  varanasi:    ['varanasi', 'banaras', 'benares'],
  allahabad:   ['allahabad', 'prayagraj'],
  meerut:      ['meerut'],

  // ── Telangana ────────────────────────────────────────────────
  hyderabad:   ['hyderabad', 'hyd', 'cyberabad', 'secunderabad', 'hyderabad city'],

  // ── Gujarat ──────────────────────────────────────────────────
  ahmedabad:   ['ahmedabad', 'amdavad', 'ahmedabad city'],
  surat:       ['surat'],
  vadodara:    ['vadodara', 'baroda', 'vadodara city'],
  rajkot:      ['rajkot'],
  gandhinagar: ['gandhinagar'],

  // ── Rajasthan ────────────────────────────────────────────────
  jaipur:      ['jaipur', 'pink city'],
  jodhpur:     ['jodhpur'],
  udaipur:     ['udaipur'],

  // ── Punjab / Haryana / Chandigarh ───────────────────────────
  chandigarh:  ['chandigarh'],
  mohali:      ['mohali', 'sahibzada ajit singh nagar', 'sas nagar'],
  amritsar:    ['amritsar'],
  ludhiana:    ['ludhiana'],
  jalandhar:   ['jalandhar'],

  // ── West Bengal ──────────────────────────────────────────────
  kolkata:     ['kolkata', 'calcutta', 'kolkatta', 'kolkota'],

  // ── Kerala ───────────────────────────────────────────────────
  kochi:       ['kochi', 'cochin', 'ernakulam'],
  thiruvananthapuram: ['thiruvananthapuram', 'trivandrum', 'tvm'],
  kozhikode:   ['kozhikode', 'calicut'],
  thrissur:    ['thrissur', 'trichur'],

  // ── Madhya Pradesh ───────────────────────────────────────────
  indore:      ['indore'],
  bhopal:      ['bhopal'],

  // ── Andhra Pradesh ───────────────────────────────────────────
  visakhapatnam: ['visakhapatnam', 'vizag', 'vishakhapatnam'],
  vijayawada:  ['vijayawada', 'bezawada'],

  // ── Bihar / Jharkhand / Odisha / Chhattisgarh ───────────────
  patna:       ['patna'],
  ranchi:      ['ranchi'],
  bhubaneswar: ['bhubaneswar', 'bhubaneshwar'],
  raipur:      ['raipur'],

  // ── Goa ──────────────────────────────────────────────────────
  panaji:      ['panaji', 'panjim', 'goa', 'north goa'],

  // ── Assam / North-East ───────────────────────────────────────
  guwahati:    ['guwahati', 'gauhati'],

  // ── Remote / Pan-India ───────────────────────────────────────
  remote:      ['remote', 'wfh', 'work from home', 'pan india', 'anywhere',
                'all india', 'hybrid remote', 'fully remote', 'remote work',
                'work remotely', 'home office'],
};

// Build reverse lookup: every variant → canonical (O(1) lookup)
const _variantToCanonical = new Map();
for (const [canonical, variants] of Object.entries(CITY_ALIAS_MAP)) {
  // Map the canonical itself
  _variantToCanonical.set(canonical.toLowerCase().trim(), canonical);
  for (const variant of variants) {
    _variantToCanonical.set(variant.toLowerCase().trim(), canonical);
  }
}

// Metro clusters — cities in the same cluster match each other
const METRO_CLUSTERS = [
  new Set(['delhi', 'gurugram', 'noida', 'ghaziabad', 'faridabad']),  // NCR
  new Set(['mumbai', 'pune']),                                          // MMR-ish (close enough for hiring)
  new Set(['chandigarh', 'mohali']),                                    // Chandigarh tricity
];

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a raw city string to its canonical lowercase key.
 * Returns null if input is empty/null.
 */
function normalizeCity(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  return _variantToCanonical.get(cleaned) || cleaned;
}

/**
 * Returns true if the two city strings refer to the same city or metro cluster.
 * Remote/WFH always returns true.
 */
function citiesMatch(city1, city2) {
  if (!city1 || !city2) return false;
  const c1 = normalizeCity(city1);
  const c2 = normalizeCity(city2);
  if (c1 === c2) return true;
  if (c1 === 'remote' || c2 === 'remote') return true;
  for (const cluster of METRO_CLUSTERS) {
    if (cluster.has(c1) && cluster.has(c2)) return true;
  }
  return false;
}

/**
 * Returns true if candidateCity matches ANY city in the jobCities array.
 */
function matchCandidateCityToJobCities(candidateCity, jobCities) {
  if (!candidateCity) return false;
  const cities = Array.isArray(jobCities) ? jobCities : [jobCities].filter(Boolean);
  return cities.some(jc => citiesMatch(candidateCity, jc));
}

module.exports = { normalizeCity, citiesMatch, matchCandidateCityToJobCities };
