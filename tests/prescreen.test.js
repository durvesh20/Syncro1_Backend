/**
 * tests/prescreen.test.js
 *
 * Standalone unit tests for prescreenService.
 * No Jest/Mocha required — runs with plain `node tests/prescreen.test.js`
 *
 * Coverage per spec Section 10:
 *   - Each field: exact match, near-miss, far-miss, missing data,
 *     boundary values, "favorable" direction (cheaper, more exp)
 *   - Hard filter: always triggered=false in Phase 1
 *   - Edge cases: remote job, no salary range, currency not screened
 */

const {
  scoreLocation,
  scoreSalary,
  scoreNotice,
  scoreExperience,
  computePrescreenScore,
  getPrescreenStatus,
  runPreScreen,
  parseNoticeDays,
  parseJobNoticeCriteria,
  normalizeSalaryToLPA,
  DEFAULT_WEIGHTS,
} = require('../services/prescreenService');

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition, extra = '') {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}${extra ? ' — ' + extra : ''}`);
    failed++;
    failures.push(label);
  }
}

function section(title) {
  console.log(`\n─── ${title} ───`);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

section('parseNoticeDays');
assert('immediate → 0', parseNoticeDays('Immediate') === 0);
assert('30 days → 30', parseNoticeDays('30 days') === 30);
assert('75-90 Days → 90', parseNoticeDays('75-90 Days') === 90);
assert('Currently Serving → 15', parseNoticeDays('Currently Serving') === 15);
assert('more than 90 days → 120', parseNoticeDays('more than 90 days') === 120);
assert('null → null', parseNoticeDays(null) === null);
assert('empty → null', parseNoticeDays('') === null);

section('parseJobNoticeCriteria');
const c1 = parseJobNoticeCriteria(['Any']);
assert('Any → anyAccepted=true', c1.anyAccepted === true);
const c2 = parseJobNoticeCriteria(['Immediate', '15 days']);
assert('Immediate list → immediatePreferred=true', c2.immediatePreferred === true);
assert('Immediate list → maxDays=15', c2.maxDays === 15);
const c3 = parseJobNoticeCriteria([]);
assert('empty list → anyAccepted=true', c3.anyAccepted === true);

section('normalizeSalaryToLPA');
assert('12 LPA → 12', normalizeSalaryToLPA(12) === 12);
assert('1200000 → 12', normalizeSalaryToLPA(1200000) === 12);
assert('null → null', normalizeSalaryToLPA(null) === null);
assert('"" → null', normalizeSalaryToLPA('') === null);

// ─── LOCATION ────────────────────────────────────────────────────────────────

section('scoreLocation — Remote job');
{
  const r = scoreLocation({ profile: { location: 'Delhi' } }, { isRemote: true, city: ['Mumbai'] });
  assert('Remote job → 100 (candidate location does not matter)', r.score === 100);
}

section('scoreLocation — Onsite exact city match');
{
  const r = scoreLocation(
    { profile: { location: 'Mumbai' } },
    { isRemote: false, isHybrid: false, city: ['Mumbai'] }
  );
  assert('Onsite exact city → 100', r.score === 100);
}

section('scoreLocation — Hybrid exact city match');
{
  const r = scoreLocation(
    { profile: { location: 'Mumbai' } },
    { isHybrid: true, city: ['Mumbai'] }
  );
  assert('Hybrid job + exact city match → 100', r.score === 100);
}

section('scoreLocation — Alias match (Bengaluru == Bangalore)');
{
  const r = scoreLocation(
    { profile: { location: 'Bengaluru' } },
    { isRemote: false, city: ['Bangalore'] }
  );
  assert('Alias city → 100', r.score === 100);
}

section('scoreLocation — Onsite different city, willing to relocate');
{
  const r = scoreLocation(
    { profile: { location: 'Chennai', willingToRelocate: true } },
    { isRemote: false, isHybrid: false, city: ['Mumbai'] }
  );
  assert('Onsite different + willing → 60', r.score === 60);
}

section('scoreLocation — Onsite different city, NOT willing to relocate');
{
  const r = scoreLocation(
    { profile: { location: 'Chennai', willingToRelocate: false } },
    { isRemote: false, isHybrid: false, city: ['Mumbai'] }
  );
  assert('Onsite different + not willing → 10', r.score === 10);
}

section('scoreLocation — Hybrid different city, willing to relocate');
{
  const r = scoreLocation(
    { profile: { location: 'Chennai', willingToRelocate: true } },
    { isRemote: false, isHybrid: true, city: ['Mumbai'] }
  );
  assert('Hybrid different + willing → 80', r.score === 80);
}

section('scoreLocation — Hybrid different city, NOT willing to relocate');
{
  const r = scoreLocation(
    { profile: { location: 'Chennai', willingToRelocate: false } },
    { isRemote: false, isHybrid: true, city: ['Mumbai'] }
  );
  assert('Hybrid different + not willing → 40', r.score === 40);
}

section('scoreLocation — Missing candidate city');
{
  const r = scoreLocation(
    { profile: {} },
    { isRemote: false, city: ['Mumbai'] }
  );
  assert('Missing city → 50 (skipped)', r.score === 50 && r.skipped);
}

section('scoreLocation — Missing job city');
{
  const r = scoreLocation(
    { profile: { location: 'Mumbai' } },
    { isRemote: false, city: [] }
  );
  assert('Missing job city → 50 (skipped)', r.score === 50 && r.skipped);
}

// ─── SALARY ──────────────────────────────────────────────────────────────────

section('scoreSalary — Within budget');
{
  const r = scoreSalary(
    { profile: { expectedSalary: 10 } },
    { min: 8, max: 12, isNegotiable: false }
  );
  assert('Within budget → 100', r.score === 100);
}

section('scoreSalary — Below job minimum (under-market)');
{
  const r = scoreSalary(
    { profile: { expectedSalary: 5 } },
    { min: 8, max: 12 }
  );
  assert('Below min → 100 (never penalise cheaper)', r.score === 100);
}

section('scoreSalary — Exactly at max');
{
  const r = scoreSalary(
    { profile: { expectedSalary: 12 } },
    { min: 8, max: 12 }
  );
  assert('At max → 100', r.score === 100);
}

section('scoreSalary — 10% above max, negotiable');
{
  const r = scoreSalary(
    { profile: { expectedSalary: 13.2 } },
    { min: 8, max: 12, isNegotiable: true }
  );
  assert('10% over, negotiable → 75', r.score === 75);
}

section('scoreSalary — 10% above max, NOT negotiable');
{
  const r = scoreSalary(
    { profile: { expectedSalary: 13.2 } },
    { min: 8, max: 12, isNegotiable: false }
  );
  assert('10% over, not negotiable → 60', r.score === 60);
}

section('scoreSalary — 20% above max');
{
  const r = scoreSalary(
    { profile: { expectedSalary: 14.4 } },
    { min: 8, max: 12 }
  );
  assert('20% over → 40', r.score === 40);
}

section('scoreSalary — >25% above max');
{
  const r = scoreSalary(
    { profile: { expectedSalary: 16 } },
    { min: 8, max: 12 }
  );
  assert('>25% over → 5', r.score === 5);
}

section('scoreSalary — No salary range published');
{
  const r = scoreSalary({ profile: { expectedSalary: 20 } }, {});
  assert('No job salary → 100 (skipped)', r.score === 100 && r.skipped);
}

section('scoreSalary — Missing candidate expected salary');
{
  const r = scoreSalary({ profile: {} }, { min: 8, max: 12 });
  assert('Missing expected → 50 (skipped)', r.score === 50 && r.skipped);
}

section('scoreSalary — Salary in absolute INR (auto-normalised)');
{
  const r = scoreSalary(
    { profile: { expectedSalary: 1000000 } }, // 10 LPA
    { min: 8, max: 12 }
  );
  assert('1000000 INR = 10 LPA → 100', r.score === 100);
}

// ─── NOTICE PERIOD ───────────────────────────────────────────────────────────

section('scoreNotice — Job accepts "Any"');
{
  const r = scoreNotice({ profile: { noticePeriod: '90 days' } }, ['Any']);
  assert('Any → 100', r.score === 100);
}

section('scoreNotice — Candidate within accepted max');
{
  const r = scoreNotice(
    { profile: { noticePeriod: '30 days' } },
    ['30-45 Days', '45-60 Days']
  );
  assert('30d within 45d max → 100', r.score === 100);
}

section('scoreNotice — 1–15 days over max');
{
  const r = scoreNotice(
    { profile: { noticePeriod: '45 days' } },
    ['30 days']
  );
  assert('15d over → 60', r.score === 60);
}

section('scoreNotice — 15–30 days over max');
{
  const r = scoreNotice(
    { profile: { noticePeriod: '60 days' } },
    ['30 days']
  );
  assert('30d over → 30', r.score === 30);
}

section('scoreNotice — >30 days over max');
{
  const r = scoreNotice(
    { profile: { noticePeriod: 'more than 90 days' } },
    ['30 days']
  );
  assert('>30d over → 10', r.score === 10);
}

section('scoreNotice — Job wants immediate, candidate is immediate');
{
  const r = scoreNotice(
    { profile: { noticePeriod: 'Immediate' } },
    ['Immediate']
  );
  assert('Immediate both → 100', r.score === 100);
}

section('scoreNotice — Job wants immediate, candidate has 30d');
{
  const r = scoreNotice(
    { profile: { noticePeriod: '30 days' } },
    ['Immediate']
  );
  assert('Immediate job, 30d candidate → 40', r.score === 40);
}

section('scoreNotice — Job wants immediate, candidate has 90d');
{
  const r = scoreNotice(
    { profile: { noticePeriod: '90 days' } },
    ['Immediate']
  );
  assert('Immediate job, 90d candidate → 20', r.score === 20);
}

section('scoreNotice — Missing candidate notice period');
{
  const r = scoreNotice({ profile: {} }, ['30 days']);
  assert('Missing notice → 50 (skipped)', r.score === 50 && r.skipped);
}

// ─── EXPERIENCE ──────────────────────────────────────────────────────────────

section('scoreExperience — Exactly within range');
{
  const r = scoreExperience(
    { profile: { totalExperience: 5 } },
    { min: 3, max: 7 }
  );
  assert('Within range → 100', r.score === 100);
}

section('scoreExperience — At minimum boundary');
{
  const r = scoreExperience(
    { profile: { totalExperience: 3 } },
    { min: 3, max: 7 }
  );
  assert('At min → 100', r.score === 100);
}

section('scoreExperience — At maximum boundary');
{
  const r = scoreExperience(
    { profile: { totalExperience: 7 } },
    { min: 3, max: 7 }
  );
  assert('At max → 100', r.score === 100);
}

section('scoreExperience — 0.8yr below min (near miss)');
{
  const r = scoreExperience(
    { profile: { totalExperience: 4.2 } },
    { min: 5, max: 8 }
  );
  assert('0.8yr below → 70', r.score === 70);
}

section('scoreExperience — 2yr below min');
{
  const r = scoreExperience(
    { profile: { totalExperience: 3 } },
    { min: 5, max: 8 }
  );
  assert('2yr below → 30', r.score === 30);
}

section('scoreExperience — 5yr below min (far miss)');
{
  const r = scoreExperience(
    { profile: { totalExperience: 0 } },
    { min: 5, max: 8 }
  );
  assert('5yr below → 10', r.score === 10);
}

section('scoreExperience — Slightly above max (overqualified, mild)');
{
  const r = scoreExperience(
    { profile: { totalExperience: 9 } },
    { min: 3, max: 7 }
  );
  assert('2yr above max → 90', r.score === 90);
}

section('scoreExperience — Moderately overqualified');
{
  const r = scoreExperience(
    { profile: { totalExperience: 12 } },
    { min: 3, max: 7 }
  );
  assert('5yr above max → 75', r.score === 75);
}

section('scoreExperience — Heavily overqualified (15yr for 2-4yr role)');
{
  const r = scoreExperience(
    { profile: { totalExperience: 15 } },
    { min: 2, max: 4 }
  );
  assert('11yr above max → 50', r.score === 50);
}

section('scoreExperience — Missing experience data');
{
  const r = scoreExperience({ profile: {} }, { min: 3, max: 7 });
  assert('Missing exp → 50 (skipped)', r.score === 50 && r.skipped);
}

section('scoreExperience — No range set on job');
{
  const r = scoreExperience({ profile: { totalExperience: 5 } }, null);
  assert('No range → 100 (skipped)', r.score === 100 && r.skipped);
}

section('scoreExperience — Strict mode, below min → 0');
{
  const r = scoreExperience(
    { profile: { totalExperience: 2 } },
    { min: 5, max: 8 },
    true
  );
  assert('Strict + below → 0', r.score === 0);
}

section('scoreExperience — Prefers AI-parsed months over form years');
{
  const r = scoreExperience(
    { profile: { totalExperienceMonths: 72, totalExperience: 3 } }, // 6yr from months
    { min: 5, max: 8 }
  );
  assert('Uses totalExperienceMonths=72 → 6yr → 100', r.score === 100);
}

// ─── COMPOSITE & STATUS ───────────────────────────────────────────────────────

section('computePrescreenScore — Default weights');
{
  const score = computePrescreenScore({ location: 100, salary: 100, notice: 100, experience: 100 });
  assert('All 100 → 100', score === 100);
}

section('computePrescreenScore — Mixed scores');
{
  const score = computePrescreenScore({ location: 80, salary: 60, notice: 100, experience: 70 });
  // 80*0.25 + 60*0.25 + 100*0.15 + 70*0.35 = 20+15+15+24.5 = 74.5
  assert('Mixed → 74.5', score === 74.5);
}

section('getPrescreenStatus');
assert('60 → qualified', getPrescreenStatus(60) === 'qualified');
assert('59 → borderline', getPrescreenStatus(59) === 'borderline');
assert('40 → borderline', getPrescreenStatus(40) === 'borderline');
assert('39 → not_qualified', getPrescreenStatus(39) === 'not_qualified');
assert('0 → not_qualified', getPrescreenStatus(0) === 'not_qualified');
assert('100 → qualified', getPrescreenStatus(100) === 'qualified');

// ─── runPreScreen INTEGRATION ─────────────────────────────────────────────────

section('runPreScreen — Full integration, strong candidate');
{
  const candidate = {
    profile: {
      location: 'Mumbai',
      willingToRelocate: false,
      expectedSalary: 10,
      noticePeriod: '30 days',
      totalExperience: 5,
    }
  };
  const job = {
    location: { isRemote: false, city: ['Mumbai'] },
    salary: { min: 8, max: 12 },
    expectedJoiningDate: ['30-45 Days'],
    experienceRange: { min: 3, max: 7 },
  };
  const r = runPreScreen(candidate, job);
  assert('Strong candidate → qualified', r.status === 'qualified');
  assert('Score >= 60', r.prescreen_score >= 60);
  assert('Has computed_at', r.computed_at instanceof Date);
  assert('hard_filter_triggered = false', r.hard_filter_triggered === false);
  assert('data_incomplete = false', r.data_incomplete === false);
}

section('runPreScreen — Weak candidate (different city, high salary, long notice, junior)');
{
  const candidate = {
    profile: {
      location: 'Kolkata',
      willingToRelocate: false,
      expectedSalary: 20,
      noticePeriod: 'more than 90 days',
      totalExperience: 1,
    }
  };
  const job = {
    location: { isRemote: false, city: ['Mumbai'] },
    salary: { min: 8, max: 12 },
    expectedJoiningDate: ['Immediate'],
    experienceRange: { min: 5, max: 8 },
  };
  const r = runPreScreen(candidate, job);
  assert('Weak candidate → not_qualified or borderline', ['not_qualified', 'borderline'].includes(r.status));
  assert('Score < 60', r.prescreen_score < 60);
}

section('runPreScreen — Remote job, all missing fields (data_incomplete)');
{
  const candidate = { profile: {} };
  const job = {
    location: { isRemote: true },
    salary: null,
    expectedJoiningDate: ['Any'],
    experienceRange: null,
  };
  const r = runPreScreen(candidate, job);
  assert('Remote + no data → prescreen computed', r.prescreen_score !== null);
  // Location=100 (remote), salary=100 (no range), notice=100 (Any), exp=100 (no range)
  assert('All skipped → still 100', r.prescreen_score === 100);
}

section('runPreScreen — Populates all detail fields');
{
  const candidate = {
    profile: {
      location: 'Bangalore',
      willingToRelocate: false,
      expectedSalary: 10,
      noticePeriod: '30 days',
      totalExperience: 5,
    }
  };
  const job = {
    location: { isRemote: false, city: ['Bangalore'] },
    salary: { min: 8, max: 12 },
    expectedJoiningDate: ['30 days'],
    experienceRange: { min: 3, max: 7 },
  };
  const r = runPreScreen(candidate, job);
  assert('location_detail populated', typeof r.location_detail === 'string');
  assert('salary_detail populated', typeof r.salary_detail === 'string');
  assert('notice_detail populated', typeof r.notice_detail === 'string');
  assert('experience_detail populated', typeof r.experience_detail === 'string');
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  ❌  ${f}`));
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!');
}
