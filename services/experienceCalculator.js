/**
 * experienceCalculator.js
 *
 * Deterministic, auditable calculation of a candidate's total work experience
 * from parsed resume job history. NO AI, NO DB, NO Express — pure functions,
 * independently unit-testable.
 *
 * Why this exists:
 *   The LLM used to hand-sum `jobHistory` durations, which double-counted
 *   overlapping/concurrent roles, guessed months from year-only data, and never
 *   substituted "today" for ongoing ("Present") roles. This module replaces that
 *   with an exact algorithm:
 *     1. Normalize every role's start/end to {year, month} (YYYY-MM granularity).
 *     2. Ongoing/"Present" roles end at the passed-in currentDate (never assumed).
 *     3. months = (endYear-startYear)*12 + (endMonth-startMonth) + 1  (inclusive).
 *     4. Merge overlapping intervals so concurrent work is counted once.
 *     5. Exclude gaps between roles (unemployment is not experience).
 *     6. Sum the merged, non-overlapping intervals → total months.
 *
 * Run tests: npx jest tests/experienceCalculator.test.js
 */

const MONTH_NAMES = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
};

const ONGOING_TOKENS = new Set(['present', 'current', 'now', 'ongoing', 'till date', 'todate', 'to date']);

/**
 * True when a date value represents an ongoing role ("Present" / "Current").
 * Accepts booleans (ongoing:true), and strings like "Present", "Current", "now".
 */
function isOngoing(value) {
    if (value === true) return true;
    if (typeof value !== 'string') return false;
    return ONGOING_TOKENS.has(value.trim().toLowerCase());
}

/**
 * Clamp a number to the 1..12 month range; returns null if not a valid month.
 */
function _clampMonth(m) {
    if (m == null || Number.isNaN(m)) return null;
    const n = Math.trunc(m);
    if (n < 1) return 1;
    if (n > 12) return 12;
    return n;
}

/**
 * Normalize many possible date shapes into { year, month }.
 * Accepts:
 *   - number: 2023                      → { year: 2023, month: fallbackMonth }
 *   - "2023"                            → { year: 2023, month: fallbackMonth }
 *   - "2023-03" / "2023/03" / "03-2023" → { year: 2023, month: 3 }
 *   - "Mar 2023" / "March 2023"         → { year: 2023, month: 3 }
 *   - { year, month }                   → normalized
 *   - Date instance                     → { year, month }
 *
 * @param {*} input          raw date value
 * @param {number} fallbackMonth month (1-12) to use when only a year is known
 * @returns {{year:number, month:number}|null} null if no year can be determined
 */
function parseYearMonth(input, fallbackMonth = 1) {
    if (input == null || input === '') return null;

    // Date instance
    if (input instanceof Date && !Number.isNaN(input.getTime())) {
        return { year: input.getFullYear(), month: input.getMonth() + 1 };
    }

    // Plain object { year, month }
    if (typeof input === 'object') {
        const year = Number(input.year ?? input.y);
        if (!Number.isFinite(year) || year <= 0) return null;
        const month = _clampMonth(Number(input.month ?? input.m)) ?? fallbackMonth;
        return { year: Math.trunc(year), month };
    }

    // Bare number (a year)
    if (typeof input === 'number') {
        if (!Number.isFinite(input) || input <= 0) return null;
        return { year: Math.trunc(input), month: _clampMonth(fallbackMonth) ?? 1 };
    }

    // String forms
    const str = String(input).trim();
    if (!str) return null;

    // "Mar 2023" / "March 2023" / "2023 Mar"
    const nameMatch = str.toLowerCase().match(/([a-z]+)/);
    if (nameMatch && MONTH_NAMES[nameMatch[1]]) {
        const yearMatch = str.match(/(\d{4})/);
        if (yearMatch) {
            return { year: Number(yearMatch[1]), month: MONTH_NAMES[nameMatch[1]] };
        }
    }

    // "2023-03" or "2023/03" (year first)
    let m = str.match(/^(\d{4})[-/.](\d{1,2})$/);
    if (m) return { year: Number(m[1]), month: _clampMonth(Number(m[2])) ?? fallbackMonth };

    // "03-2023" or "03/2023" (month first)
    m = str.match(/^(\d{1,2})[-/.](\d{4})$/);
    if (m) return { year: Number(m[2]), month: _clampMonth(Number(m[1])) ?? fallbackMonth };

    // Bare "2023"
    m = str.match(/(\d{4})/);
    if (m) return { year: Number(m[1]), month: _clampMonth(fallbackMonth) ?? 1 };

    return null;
}

/** Convert { year, month } to an absolute month index (for comparison/arithmetic). */
function _toAbsMonths(ym) {
    return ym.year * 12 + (ym.month - 1);
}

/**
 * Inclusive month count between two normalized {year,month} points.
 * months = (endYear-startYear)*12 + (endMonth-startMonth) + 1
 * Returns 0 if end precedes start.
 */
function roleMonths(start, end) {
    if (!start || !end) return 0;
    const diff = (end.year - start.year) * 12 + (end.month - start.month) + 1;
    return diff > 0 ? diff : 0;
}

/**
 * Merge overlapping or adjacent-overlapping intervals.
 * Each interval is { startAbs, endAbs } using inclusive absolute month indices.
 * Two intervals are merged when they overlap or touch inclusively
 * (i.e. next.startAbs <= current.endAbs + 1 would merge touching months; here we
 * merge only true overlaps: next.startAbs <= current.endAbs). Gaps are preserved.
 *
 * @param {Array<{startAbs:number,endAbs:number}>} intervals
 * @returns {Array<{startAbs:number,endAbs:number}>} merged, sorted
 */
function mergeIntervals(intervals) {
    const valid = intervals.filter(iv => iv && Number.isFinite(iv.startAbs) && Number.isFinite(iv.endAbs) && iv.endAbs >= iv.startAbs);
    if (valid.length === 0) return [];

    const sorted = [...valid].sort((a, b) => a.startAbs - b.startAbs || a.endAbs - b.endAbs);
    const merged = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i++) {
        const cur = sorted[i];
        const last = merged[merged.length - 1];
        // Overlap (inclusive): current starts on/before the month after last ends.
        if (cur.startAbs <= last.endAbs + 1) {
            last.endAbs = Math.max(last.endAbs, cur.endAbs);
        } else {
            merged.push({ ...cur });
        }
    }
    return merged;
}

/**
 * Normalize a single raw jobHistory entry into an interval + audit record.
 * Supports both the new schema (fromMonth/toMonth/ongoing) and the legacy
 * year-only schema (fromYear/toYear). Ongoing roles end at currentDate.
 *
 * @returns {{start:object,end:object,months:number,ongoing:boolean,company:string,title:string}|null}
 */
function _normalizeRole(role, currentDate) {
    if (!role || typeof role !== 'object') return null;

    const curYM = { year: currentDate.getFullYear(), month: currentDate.getMonth() + 1 };

    // Start: prefer explicit start, then { fromYear, fromMonth }, then generic fields.
    const startRaw = role.start_date ?? role.startDate ?? role.from ?? role.fromYear ?? role.startYear;
    const startMonthHint = role.fromMonth ?? role.startMonth ?? 1;
    let start = parseYearMonth(startRaw, startMonthHint);
    // If start came from a bare year but a separate month field exists, apply it.
    if (start && role.fromYear != null && (role.fromMonth != null)) {
        const mm = _clampMonth(Number(role.fromMonth));
        if (mm) start.month = mm;
    }
    if (!start) return null;

    // End: ongoing → currentDate; else explicit end / { toYear, toMonth }.
    const ongoingFlag = isOngoing(role.ongoing) || isOngoing(role.end_date) || isOngoing(role.endDate) ||
        isOngoing(role.to) || isOngoing(role.toYear) || role.current === true;

    let end;
    if (ongoingFlag) {
        end = { ...curYM };
    } else {
        const endRaw = role.end_date ?? role.endDate ?? role.to ?? role.toYear ?? role.endYear;
        const endMonthHint = role.toMonth ?? role.endMonth ?? 12; // year-only end → December (conservative full year)
        end = parseYearMonth(endRaw, endMonthHint);
        if (end && role.toYear != null && role.toMonth != null) {
            const mm = _clampMonth(Number(role.toMonth));
            if (mm) end.month = mm;
        }
        // No parseable end and not ongoing: treat as a single-month role at start.
        if (!end) end = { ...start };
    }

    // Guard: end before start (bad data) → collapse to start month.
    if (_toAbsMonths(end) < _toAbsMonths(start)) end = { ...start };

    const months = roleMonths(start, end);
    return {
        start,
        end,
        months,
        ongoing: ongoingFlag,
        company: role.company || role.employer || '',
        title: role.designation || role.title || role.role || '',
    };
}

/**
 * Core: total experience in months from a job history array, with overlaps
 * merged and gaps excluded.
 *
 * @param {Array} jobHistory  parsed roles
 * @param {Date}  currentDate substituted for ongoing/"Present" roles (required)
 * @returns {{totalMonths:number, intervals:Array, roles:Array}}
 */
function calculateActualExperienceMonths(jobHistory, currentDate) {
    if (!(currentDate instanceof Date) || Number.isNaN(currentDate.getTime())) {
        throw new Error('calculateActualExperienceMonths: currentDate must be a valid Date');
    }
    const roles = (Array.isArray(jobHistory) ? jobHistory : [])
        .map(r => _normalizeRole(r, currentDate))
        .filter(Boolean);

    const intervals = roles.map(r => ({
        startAbs: _toAbsMonths(r.start),
        endAbs: _toAbsMonths(r.end),
    }));

    const merged = mergeIntervals(intervals);
    const totalMonths = merged.reduce((sum, iv) => sum + (iv.endAbs - iv.startAbs + 1), 0);

    return { totalMonths, intervals: merged, roles };
}

/** Round to one decimal place. */
function _round1(n) {
    return Math.round(n * 10) / 10;
}

/** Zero-pad to YYYY-MM. */
function _fmtYM(ym) {
    if (!ym) return null;
    return `${ym.year}-${String(ym.month).padStart(2, '0')}`;
}

/**
 * Format a month count into human-readable pieces.
 * @returns {{totalMonths:number, totalExperience:string, yearsDecimal:number}}
 */
function formatExperience(totalMonths) {
    const months = Math.max(0, Math.trunc(totalMonths || 0));
    const years = Math.floor(months / 12);
    const rem = months % 12;
    let label;
    if (years > 0 && rem > 0) label = `${years} year${years > 1 ? 's' : ''} ${rem} month${rem > 1 ? 's' : ''}`;
    else if (years > 0) label = `${years} year${years > 1 ? 's' : ''}`;
    else label = `${rem} month${rem !== 1 ? 's' : ''}`;
    return {
        totalMonths: months,
        totalExperience: label,
        yearsDecimal: _round1(months / 12),
    };
}

/**
 * High-level convenience: deterministic experience from parsed resume history.
 * Returns totals plus a per-role breakdown for auditability.
 *
 * @param {Array} jobHistory
 * @param {Date}  currentDate (defaults to now at call site; pass explicitly in prod)
 */
function calculateFromResume(jobHistory, currentDate = new Date()) {
    const { totalMonths, roles } = calculateActualExperienceMonths(jobHistory, currentDate);
    const fmt = formatExperience(totalMonths);

    const breakdown = roles.map(r => ({
        company: r.company,
        title: r.title,
        start_date: _fmtYM(r.start),
        end_date: r.ongoing ? 'Present' : _fmtYM(r.end),
        duration_months: r.months,
    }));

    return {
        totalMonths: fmt.totalMonths,
        totalExperience: fmt.totalExperience,
        yearsDecimal: fmt.yearsDecimal,
        roles: breakdown,
    };
}

/**
 * Build the structured experience entries for STORAGE in a candidate's profile,
 * mirroring how `education` is stored. Each entry is a normalized work record:
 *   { company, title, startDate ("YYYY-MM"), endDate ("YYYY-MM"|null),
 *     isCurrent (bool), durationMonths (int) }
 *
 * Ongoing/"Present" roles store endDate = null and isCurrent = true.
 * Dates are normalized so any resume format the LLM extracts
 * (e.g. "jan-2023", "january-2023", "01-2023", "2023-03") is normalized to YYYY-MM.
 *
 * @param {Array} jobHistory  parsed roles (numbers OR string date fields)
 * @param {Date}  currentDate substituted for ongoing roles
 * @returns {Array<object>}
 */
function buildExperienceEntries(jobHistory, currentDate = new Date()) {
    const { roles } = calculateActualExperienceMonths(jobHistory, currentDate);
    return roles.map(r => ({
        company: r.company || '',
        title: r.title || '',
        startDate: _fmtYM(r.start) || null,
        endDate: r.ongoing ? null : (_fmtYM(r.end) || null),
        isCurrent: r.ongoing,
        durationMonths: r.months || 0,
    }));
}

module.exports = {
    isOngoing,
    parseYearMonth,
    roleMonths,
    mergeIntervals,
    calculateActualExperienceMonths,
    formatExperience,
    calculateFromResume,
    buildExperienceEntries,
};
