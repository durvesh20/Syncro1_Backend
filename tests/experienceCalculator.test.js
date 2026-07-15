/**
 * experienceCalculator.test.js
 * Unit tests for the deterministic experience calculator — no AI, no DB.
 * Run: npx jest tests/experienceCalculator.test.js
 */

const {
    isOngoing,
    parseYearMonth,
    roleMonths,
    mergeIntervals,
    calculateActualExperienceMonths,
    formatExperience,
    calculateFromResume,
    buildExperienceEntries,
} = require('../services/experienceCalculator');

// Fixed "today" so tests are deterministic regardless of when they run.
const NOW = new Date('2026-07-14T00:00:00Z');

describe('isOngoing', () => {
    test('recognizes Present/Current/now and boolean true', () => {
        expect(isOngoing('Present')).toBe(true);
        expect(isOngoing('current')).toBe(true);
        expect(isOngoing('NOW')).toBe(true);
        expect(isOngoing(true)).toBe(true);
    });
    test('rejects normal dates', () => {
        expect(isOngoing('2023-01')).toBe(false);
        expect(isOngoing(2023)).toBe(false);
        expect(isOngoing(false)).toBe(false);
    });
});

describe('parseYearMonth', () => {
    test('parses YYYY-MM', () => {
        expect(parseYearMonth('2023-03')).toEqual({ year: 2023, month: 3 });
    });
    test('parses bare year with fallback month', () => {
        expect(parseYearMonth('2023', 1)).toEqual({ year: 2023, month: 1 });
        expect(parseYearMonth(2020, 12)).toEqual({ year: 2020, month: 12 });
    });
    test('parses month name forms', () => {
        expect(parseYearMonth('Mar 2023')).toEqual({ year: 2023, month: 3 });
        expect(parseYearMonth('January 2020')).toEqual({ year: 2020, month: 1 });
    });
    test('parses {year, month} object', () => {
        expect(parseYearMonth({ year: 2022, month: 6 })).toEqual({ year: 2022, month: 6 });
    });
    test('returns null on garbage', () => {
        expect(parseYearMonth('')).toBeNull();
        expect(parseYearMonth(null)).toBeNull();
    });
});

describe('roleMonths (+1 inclusive rule)', () => {
    test('Jan2023–Mar2023 = 3 months', () => {
        expect(roleMonths({ year: 2023, month: 1 }, { year: 2023, month: 3 })).toBe(3);
    });
    test('single month = 1', () => {
        expect(roleMonths({ year: 2023, month: 5 }, { year: 2023, month: 5 })).toBe(1);
    });
    test('one full year Jan–Dec = 12', () => {
        expect(roleMonths({ year: 2023, month: 1 }, { year: 2023, month: 12 })).toBe(12);
    });
    test('end before start = 0', () => {
        expect(roleMonths({ year: 2023, month: 5 }, { year: 2023, month: 1 })).toBe(0);
    });
});

describe('mergeIntervals', () => {
    test('merges overlapping intervals', () => {
        const merged = mergeIntervals([
            { startAbs: 0, endAbs: 11 },
            { startAbs: 6, endAbs: 20 },
        ]);
        expect(merged).toEqual([{ startAbs: 0, endAbs: 20 }]);
    });
    test('keeps separated intervals with a gap', () => {
        const merged = mergeIntervals([
            { startAbs: 0, endAbs: 5 },
            { startAbs: 12, endAbs: 20 },
        ]);
        expect(merged.length).toBe(2);
    });
});

describe('calculateActualExperienceMonths', () => {
    test('two non-overlapping 12-month roles → 24 months', () => {
        const jobHistory = [
            { company: 'A', fromYear: 2018, fromMonth: 1, toYear: 2018, toMonth: 12 },
            { company: 'B', fromYear: 2020, fromMonth: 1, toYear: 2020, toMonth: 12 },
        ];
        const { totalMonths } = calculateActualExperienceMonths(jobHistory, NOW);
        expect(totalMonths).toBe(24);
    });

    test('overlapping roles merged, not double-counted (36 not 48)', () => {
        // Jan2020–Dec2021 (24m) + Jun2021–Dec2022 (19m) overlap → Jan2020–Dec2022 = 36m
        const jobHistory = [
            { company: 'FT', fromYear: 2020, fromMonth: 1, toYear: 2021, toMonth: 12 },
            { company: 'Freelance', fromYear: 2021, fromMonth: 6, toYear: 2022, toMonth: 12 },
        ];
        const { totalMonths } = calculateActualExperienceMonths(jobHistory, NOW);
        expect(totalMonths).toBe(36);
    });

    test('gap between roles is excluded', () => {
        // Role1 Jan–Jun2019 (6m), gap, Role2 Jan–Jun2020 (6m) → 12m total (gap not counted)
        const jobHistory = [
            { company: 'A', fromYear: 2019, fromMonth: 1, toYear: 2019, toMonth: 6 },
            { company: 'B', fromYear: 2020, fromMonth: 1, toYear: 2020, toMonth: 6 },
        ];
        const { totalMonths } = calculateActualExperienceMonths(jobHistory, NOW);
        expect(totalMonths).toBe(12);
    });

    test('ongoing role counts through currentDate', () => {
        // Started Jan2026, ongoing, NOW = Jul2026 → 7 months (Jan..Jul inclusive)
        const jobHistory = [
            { company: 'Now', fromYear: 2026, fromMonth: 1, ongoing: true },
        ];
        const { totalMonths } = calculateActualExperienceMonths(jobHistory, NOW);
        expect(totalMonths).toBe(7);
    });

    test('"Present" string on end_date is treated as ongoing', () => {
        const jobHistory = [
            { company: 'Now', start_date: '2026-05', end_date: 'Present' },
        ];
        const { totalMonths } = calculateActualExperienceMonths(jobHistory, NOW);
        expect(totalMonths).toBe(3); // May, Jun, Jul
    });

    test('year-only fallback still produces sane number', () => {
        // fromYear 2019 → Jan, toYear 2019 → Dec (conservative full year) = 12
        const jobHistory = [{ company: 'A', fromYear: 2019, toYear: 2019 }];
        const { totalMonths } = calculateActualExperienceMonths(jobHistory, NOW);
        expect(totalMonths).toBe(12);
    });

    test('empty history → 0', () => {
        expect(calculateActualExperienceMonths([], NOW).totalMonths).toBe(0);
        expect(calculateActualExperienceMonths(null, NOW).totalMonths).toBe(0);
    });

    test('throws without a valid currentDate', () => {
        expect(() => calculateActualExperienceMonths([], 'nope')).toThrow();
    });
});

describe('formatExperience', () => {
    test('formats years and months', () => {
        expect(formatExperience(30)).toEqual({
            totalMonths: 30,
            totalExperience: '2 years 6 months',
            yearsDecimal: 2.5,
        });
    });
    test('formats exact years', () => {
        expect(formatExperience(24).totalExperience).toBe('2 years');
    });
    test('formats months only', () => {
        expect(formatExperience(5).totalExperience).toBe('5 months');
    });
});

describe('calculateFromResume (audit breakdown)', () => {
    test('returns totals plus per-role breakdown', () => {
        const jobHistory = [
            { company: 'FT', designation: 'Engineer', fromYear: 2020, fromMonth: 1, toYear: 2021, toMonth: 12 },
            { company: 'Freelance', designation: 'Consultant', fromYear: 2021, fromMonth: 6, toYear: 2022, toMonth: 12 },
        ];
        const res = calculateFromResume(jobHistory, NOW);
        expect(res.totalMonths).toBe(36);
        expect(res.yearsDecimal).toBe(3);
        expect(res.totalExperience).toBe('3 years');
        expect(res.roles).toHaveLength(2);
        expect(res.roles[0]).toMatchObject({
            company: 'FT',
            title: 'Engineer',
            start_date: '2020-01',
            end_date: '2021-12',
            duration_months: 24,
        });
    });

    test('ongoing role shows Present in breakdown', () => {
        const res = calculateFromResume([{ company: 'X', start_date: '2026-01', ongoing: true }], NOW);
        expect(res.roles[0].end_date).toBe('Present');
    });
});

describe('buildExperienceEntries (storage shape)', () => {
    test('returns structured entries with normalized dates and isCurrent', () => {
        const jobHistory = [
            { company: 'FT', designation: 'Engineer', fromYear: 2020, fromMonth: 1, toYear: 2021, toMonth: 12 },
            { company: 'Now', start_date: '2026-01', ongoing: true },
        ];
        const entries = buildExperienceEntries(jobHistory, NOW);
        expect(entries).toHaveLength(2);
        expect(entries[0]).toEqual({
            company: 'FT',
            title: 'Engineer',
            startDate: '2020-01',
            endDate: '2021-12',
            isCurrent: false,
            durationMonths: 24,
        });
        expect(entries[1]).toMatchObject({
            company: 'Now',
            startDate: '2026-01',
            endDate: null,
            isCurrent: true,
            durationMonths: 7,
        });
    });

    test('flexible resume date formats normalize correctly', () => {
        const jobHistory = [
            { company: 'A', designation: 'X', start_date: 'jan-2023', end_date: 'january-2023' },
            { company: 'B', designation: 'Y', start_date: '01-2023', end_date: '03-2023' },
        ];
        const entries = buildExperienceEntries(jobHistory, new Date('2026-07-14'));
        expect(entries[0].startDate).toBe('2023-01');
        expect(entries[0].endDate).toBe('2023-01');
        expect(entries[1].startDate).toBe('2023-01');
        expect(entries[1].endDate).toBe('2023-03');
    });

    test('empty history → empty array', () => {
        expect(buildExperienceEntries([], NOW)).toEqual([]);
    });
});

describe('parseYearMonth flexible formats', () => {
    test.each([
        ['jan-2023', 2023, 1],
        ['january-2023', 2023, 1],
        ['01-2023', 2023, 1],
        ['01/2023', 2023, 1],
        ['dec-2022', 2022, 12],
        ['2023-01', 2023, 1],
    ])('parses %s', (input, y, m) => {
        expect(parseYearMonth(input, 1)).toEqual({ year: y, month: m });
    });
});
