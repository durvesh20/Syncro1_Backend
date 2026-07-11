/**
 * pipelineStateMachine.test.js
 * Unit tests for the pure FSM — no DB, no Express.
 * Run: npx jest tests/pipelineStateMachine.test.js
 */

const {
  transition,
  validatePipelineTemplate,
  getInitialRoundState,
  PIPELINE_STATES: S,
  ACTIONS: A,
  ROLES: R,
  MAX_CANDIDATE_RESCHEDULES,
} = require('../services/pipelineStateMachine');

// ─── helpers ──────────────────────────────────────────────────────────────────
const ok = (state, action, role, payload = {}, context = {}) =>
  transition({ currentState: state, action, role, payload, context });

// ─── Admin is always blocked ──────────────────────────────────────────────────
describe('Admin RBAC', () => {
  test('admin cannot shortlist', () => {
    const r = ok(S.SHORTLISTED, A.REJECT, R.ADMIN, { reason: 'test reason here' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ADMIN_READONLY');
  });

  test('sub_admin maps to admin (readonly) and is blocked', () => {
    // sub_admin is mapped to ROLES.ADMIN in the controller; test at FSM level with 'admin'
    const r = ok(S.SHORTLISTED, A.REJECT, 'admin', { reason: 'test reason here' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ADMIN_READONLY');
  });
});

// ─── §1.1 Application-level transitions ──────────────────────────────────────
describe('§1.1 Shortlist / Reject / Re-shortlist', () => {
  test('company can reject from SHORTLISTED with reason', () => {
    const r = ok(S.SHORTLISTED, A.REJECT, R.COMPANY, { reason: 'Not a good fit for role' });
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.REJECTED);
  });

  test('reject requires reason (min 5 chars)', () => {
    const r1 = ok(S.SHORTLISTED, A.REJECT, R.COMPANY, { reason: '' });
    expect(r1.ok).toBe(false);
    expect(r1.code).toBe('REASON_REQUIRED');

    const r2 = ok(S.SHORTLISTED, A.REJECT, R.COMPANY, { reason: 'no' });
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe('REASON_REQUIRED');
  });

  test('company can re-shortlist from REJECTED', () => {
    const r = ok(S.REJECTED, A.RE_SHORTLIST, R.COMPANY);
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.SHORTLISTED);
  });

  test('re-shortlist → reject → re-shortlist cycle works', () => {
    const r1 = ok(S.REJECTED, A.RE_SHORTLIST, R.COMPANY);
    expect(r1.ok).toBe(true);
    const r2 = ok(S.SHORTLISTED, A.REJECT, R.COMPANY, { reason: 'Changed decision again' });
    expect(r2.ok).toBe(true);
    const r3 = ok(S.REJECTED, A.RE_SHORTLIST, R.COMPANY);
    expect(r3.ok).toBe(true);
    expect(r3.nextState).toBe(S.SHORTLISTED);
  });

  test('staffing_partner cannot reject', () => {
    const r = ok(S.SHORTLISTED, A.REJECT, R.STAFFING_PARTNER, { reason: 'Not a good fit for role' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('FORBIDDEN');
  });

  test('candidate cannot reject', () => {
    const r = ok(S.SHORTLISTED, A.REJECT, R.CANDIDATE, { reason: 'Not a good fit for role' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('FORBIDDEN');
  });
});

// ─── §1.3 Assessment round ───────────────────────────────────────────────────
describe('§1.3 Assessment round', () => {
  test('company passes assessment', () => {
    const r = ok(S.ASSESSMENT_PENDING, A.ASSESSMENT_PASS, R.COMPANY);
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.ASSESSMENT_PASSED);
  });

  test('company fails assessment — reason required', () => {
    const r1 = ok(S.ASSESSMENT_PENDING, A.ASSESSMENT_FAIL, R.COMPANY, {});
    expect(r1.ok).toBe(false);
    expect(r1.code).toBe('REASON_REQUIRED');

    const r2 = ok(S.ASSESSMENT_PENDING, A.ASSESSMENT_FAIL, R.COMPANY, { reason: 'Failed technical test' });
    expect(r2.ok).toBe(true);
    expect(r2.nextState).toBe(S.ASSESSMENT_FAILED);
  });

  test('ASSESSMENT_FAILED is terminal', () => {
    const r = ok(S.ASSESSMENT_FAILED, A.ASSESSMENT_PASS, R.COMPANY);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TERMINAL_STATE');
  });
});

// ─── §1.4 L-round slot lifecycle ─────────────────────────────────────────────
describe('§1.4 Slot lifecycle', () => {
  test('company publishes slots', () => {
    const r = ok(S.SLOTS_NOT_PUBLISHED, A.PUBLISH_SLOTS, R.COMPANY);
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.SLOTS_PUBLISHED);
  });

  test('only vendor (staffing_partner) can book a slot', () => {
    const rCompany = ok(S.SLOTS_PUBLISHED, A.BOOK_SLOT, R.COMPANY);
    expect(rCompany.ok).toBe(false);
    expect(rCompany.code).toBe('FORBIDDEN');

    const rVendor = ok(S.SLOTS_PUBLISHED, A.BOOK_SLOT, R.STAFFING_PARTNER);
    expect(rVendor.ok).toBe(true);
    expect(rVendor.nextState).toBe(S.SLOT_ASSIGNED);
  });

  test('company shares details after slot assigned', () => {
    const r = ok(S.SLOT_ASSIGNED, A.SHARE_DETAILS, R.COMPANY);
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.SLOT_DETAILS_SHARED);
  });

  test('company can reschedule from SLOT_ASSIGNED (transitions to RESCHEDULE_REQUESTED)', () => {
    const r = ok(S.SLOT_ASSIGNED, A.REQUEST_RESCHEDULE, R.COMPANY, { reason: 'Interviewer unavailable on that day' });
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.RESCHEDULE_REQUESTED);
  });

  test('company can reschedule from SLOT_DETAILS_SHARED (transitions to RESCHEDULE_REQUESTED)', () => {
    const r = ok(S.SLOT_DETAILS_SHARED, A.REQUEST_RESCHEDULE, R.COMPANY, { reason: 'Office closed that day due to holiday' });
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.RESCHEDULE_REQUESTED);
  });

  test('candidate reschedule — within cap', () => {
    const r = ok(S.SLOT_DETAILS_SHARED, A.REQUEST_RESCHEDULE, R.CANDIDATE, { reason: 'Cannot attend on that date please' }, { candidateRescheduleCount: 2 });
    expect(r.ok).toBe(true);
  });

  test('candidate reschedule — cap enforced at 3', () => {
    const r = ok(S.SLOT_DETAILS_SHARED, A.REQUEST_RESCHEDULE, R.CANDIDATE, { reason: 'Cannot attend on that date please' }, { candidateRescheduleCount: 3 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('RESCHEDULE_CAP');
  });

  test('company reschedule is uncapped', () => {
    const r = ok(S.SLOT_DETAILS_SHARED, A.REQUEST_RESCHEDULE, R.COMPANY, { reason: 'Panel changed their availability today' }, { candidateRescheduleCount: 99 });
    expect(r.ok).toBe(true); // company not capped
  });

  test('company marks interview conducted', () => {
    const r = ok(S.SLOT_DETAILS_SHARED, A.MARK_CONDUCTED, R.COMPANY);
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.INTERVIEW_CONDUCTED);
  });
});

// ─── §1.4 Step E — Interview outcomes ────────────────────────────────────────
describe('§1.4 Interview outcomes', () => {
  test('select next round', () => {
    const r = ok(S.INTERVIEW_CONDUCTED, A.SELECT_NEXT_ROUND, R.COMPANY);
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.ROUND_SELECTED_NEXT);
  });

  test('reject — reason required', () => {
    const r1 = ok(S.INTERVIEW_CONDUCTED, A.REJECT_ROUND, R.COMPANY, {});
    expect(r1.ok).toBe(false);
    const r2 = ok(S.INTERVIEW_CONDUCTED, A.REJECT_ROUND, R.COMPANY, { reason: 'Did not meet technical bar in assessment' });
    expect(r2.ok).toBe(true);
    expect(r2.nextState).toBe(S.ROUND_REJECTED);
  });

  test('ROUND_REJECTED is terminal', () => {
    const r = ok(S.ROUND_REJECTED, A.SELECT_NEXT_ROUND, R.COMPANY);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TERMINAL_STATE');
  });

  test('select direct HR', () => {
    const r = ok(S.INTERVIEW_CONDUCTED, A.SELECT_DIRECT_HR, R.COMPANY);
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.ROUND_SELECTED_DIRECT_HR);
  });

  test('hold — reason required', () => {
    const r = ok(S.INTERVIEW_CONDUCTED, A.HOLD_ROUND, R.COMPANY, {});
    expect(r.ok).toBe(false);
    expect(r.code).toBe('REASON_REQUIRED');
  });

  test('resolve hold → NEXT_ROUND', () => {
    const r = ok(S.ROUND_ON_HOLD, A.RESOLVE_HOLD, R.COMPANY, { resolution: 'NEXT_ROUND' });
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.ROUND_SELECTED_NEXT);
  });

  test('resolve hold → SELECTED_DIRECT_HR', () => {
    const r = ok(S.ROUND_ON_HOLD, A.RESOLVE_HOLD, R.COMPANY, { resolution: 'SELECTED_DIRECT_HR' });
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.ROUND_SELECTED_DIRECT_HR);
  });

  test('resolve hold → REJECTED', () => {
    const r = ok(S.ROUND_ON_HOLD, A.RESOLVE_HOLD, R.COMPANY, { resolution: 'REJECTED' });
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.ROUND_REJECTED);
  });

  test('resolve hold with invalid resolution fails', () => {
    const r = ok(S.ROUND_ON_HOLD, A.RESOLVE_HOLD, R.COMPANY, { resolution: 'UNKNOWN' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('DYNAMIC_RESOLUTION_FAILED');
  });

  test('resolve hold requires resolution field', () => {
    const r = ok(S.ROUND_ON_HOLD, A.RESOLVE_HOLD, R.COMPANY, {});
    expect(r.ok).toBe(false);
    expect(r.code).toBe('PAYLOAD_MISSING');
  });
});

// ─── §1.5 HR round ───────────────────────────────────────────────────────────
describe('§1.5 HR round', () => {
  test('company selects in HR round', () => {
    const r = ok(S.HR_ROUND_PENDING, A.HR_SELECT, R.COMPANY);
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.HR_SELECTED);
  });

  test('company rejects in HR round — reason required', () => {
    const r1 = ok(S.HR_ROUND_PENDING, A.HR_REJECT, R.COMPANY, {});
    expect(r1.ok).toBe(false);
    const r2 = ok(S.HR_ROUND_PENDING, A.HR_REJECT, R.COMPANY, { reason: 'Compensation expectations too high for role' });
    expect(r2.ok).toBe(true);
    expect(r2.nextState).toBe(S.HR_REJECTED);
  });

  test('HR_REJECTED is terminal', () => {
    const r = ok(S.HR_REJECTED, A.HR_SELECT, R.COMPANY);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TERMINAL_STATE');
  });

  test('HR hold → resolve selected', () => {
    const r = ok(S.HR_ON_HOLD, A.HR_RESOLVE_HOLD, R.COMPANY, { resolution: 'SELECTED' });
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.HR_SELECTED);
  });

  test('HR hold → resolve rejected', () => {
    const r = ok(S.HR_ON_HOLD, A.HR_RESOLVE_HOLD, R.COMPANY, { resolution: 'REJECTED' });
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.HR_REJECTED);
  });

  test('HR selected → send offer', () => {
    const r = ok(S.HR_SELECTED, A.SEND_OFFER, R.COMPANY);
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.OFFER_SENT);
  });
});

// ─── §1.6 Offer ──────────────────────────────────────────────────────────────
describe('§1.6 Offer', () => {
  test('candidate accepts offer with joiningDate', () => {
    const r = ok(S.OFFER_SENT, A.ACCEPT_OFFER, R.CANDIDATE, { joiningDate: '2026-09-01' });
    expect(r.ok).toBe(true);
    expect(r.nextState).toBe(S.OFFER_ACCEPTED);
  });

  test('accept offer requires joiningDate', () => {
    const r = ok(S.OFFER_SENT, A.ACCEPT_OFFER, R.CANDIDATE, {});
    expect(r.ok).toBe(false);
    expect(r.code).toBe('PAYLOAD_MISSING');
  });

  test('accept offer requires valid date', () => {
    const r = ok(S.OFFER_SENT, A.ACCEPT_OFFER, R.CANDIDATE, { joiningDate: 'not-a-date' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INVALID_DATE');
  });

  test('candidate rejects offer — reason required', () => {
    const r1 = ok(S.OFFER_SENT, A.REJECT_OFFER, R.CANDIDATE, {});
    expect(r1.ok).toBe(false);
    const r2 = ok(S.OFFER_SENT, A.REJECT_OFFER, R.CANDIDATE, { reason: 'Accepted a better offer elsewhere today' });
    expect(r2.ok).toBe(true);
    expect(r2.nextState).toBe(S.OFFER_REJECTED);
  });

  test('OFFER_REJECTED is terminal', () => {
    const r = ok(S.OFFER_REJECTED, A.ACCEPT_OFFER, R.CANDIDATE, { joiningDate: '2026-09-01' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TERMINAL_STATE');
  });

  test('company cannot accept offer (only candidate can)', () => {
    const r = ok(S.OFFER_SENT, A.ACCEPT_OFFER, R.COMPANY, { joiningDate: '2026-09-01' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('FORBIDDEN');
  });
});

// ─── Pipeline template validation ─────────────────────────────────────────────
describe('validatePipelineTemplate', () => {
  test('valid 3-round pipeline', () => {
    const r = validatePipelineTemplate([
      { roundType: 'ASSESSMENT', order: 1 },
      { roundType: 'L1_INTERVIEW', order: 2 },
      { roundType: 'HR_ROUND', order: 3 },
    ]);
    expect(r.ok).toBe(true);
  });

  test('empty pipeline rejected', () => {
    expect(validatePipelineTemplate([]).ok).toBe(false);
    expect(validatePipelineTemplate(null).ok).toBe(false);
  });

  test('custom round type allowed', () => {
    const r = validatePipelineTemplate([{ roundType: 'VIBE_CHECK', order: 1 }]);
    expect(r.ok).toBe(true);
  });

  test('HR round can be anywhere in the pipeline template', () => {
    const r = validatePipelineTemplate([
      { roundType: 'HR_ROUND', order: 1 },
      { roundType: 'L1_INTERVIEW', order: 2 },
    ]);
    expect(r.ok).toBe(true);
  });

  test('duplicate round types rejected', () => {
    const r = validatePipelineTemplate([
      { roundType: 'L1_INTERVIEW', order: 1 },
      { roundType: 'L1_INTERVIEW', order: 2 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch('Duplicate');
  });

  test('more than 6 rounds rejected', () => {
    const rounds = Array.from({ length: 7 }, (_, i) => ({ roundType: 'L1_INTERVIEW', order: i + 1 }));
    const r = validatePipelineTemplate(rounds);
    expect(r.ok).toBe(false);
  });
});

// ─── getInitialRoundState ─────────────────────────────────────────────────────
describe('getInitialRoundState', () => {
  test('ASSESSMENT → ASSESSMENT_PENDING', () => {
    expect(getInitialRoundState('ASSESSMENT')).toBe(S.ASSESSMENT_PENDING);
  });
  test('HR_ROUND → SLOTS_NOT_PUBLISHED', () => {
    expect(getInitialRoundState('HR_ROUND')).toBe(S.SLOTS_NOT_PUBLISHED);
  });
  test('L1_INTERVIEW → SLOTS_NOT_PUBLISHED', () => {
    expect(getInitialRoundState('L1_INTERVIEW')).toBe(S.SLOTS_NOT_PUBLISHED);
  });
});

// ─── Error: invalid / unknown states ─────────────────────────────────────────
describe('Edge cases', () => {
  test('unknown current state returns UNKNOWN_STATE', () => {
    const r = ok('NONEXISTENT_STATE', A.REJECT, R.COMPANY, { reason: 'some reason here' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('UNKNOWN_STATE');
  });

  test('invalid action for valid state returns INVALID_ACTION', () => {
    const r = ok(S.HR_ROUND_PENDING, A.BOOK_SLOT, R.COMPANY);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INVALID_ACTION');
  });

  test('ONBOARDING is terminal', () => {
    const r = ok(S.ONBOARDING, A.SHORTLIST, R.COMPANY);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TERMINAL_STATE');
  });
});
