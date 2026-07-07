/**
 * PipelineStateMachine
 * Pure FSM — no Express, no Mongoose, no side-effects.
 * Every transition: (currentState, action, role, payload) -> { ok, nextState, error }
 *
 * Source of truth for all 24 pipeline states defined in the spec §1.7.
 * Existing pre-pipeline states (DRAFT, CONSENT_PENDING, ADMIN_REVIEW, SUBMITTED, etc.)
 * are handled by the existing statusMachine.js — this FSM picks up from SHORTLISTED onward.
 */

// ─── Round types ─────────────────────────────────────────────────────────────
const ROUND_TYPES = ['ASSESSMENT', 'L1_INTERVIEW', 'L2_INTERVIEW', 'L3_INTERVIEW', 'HR_ROUND'];

// ─── All pipeline states (§1.7) ──────────────────────────────────────────────
const PIPELINE_STATES = {
  // Entry (bridges from existing flow)
  SHORTLISTED: 'SHORTLISTED',

  // Assessment round
  ASSESSMENT_PENDING: 'ASSESSMENT_PENDING',
  ASSESSMENT_PASSED: 'ASSESSMENT_PASSED',
  ASSESSMENT_FAILED: 'ASSESSMENT_FAILED',           // terminal

  // Per-round slot lifecycle (L1/L2/L3)
  SLOTS_NOT_PUBLISHED: 'SLOTS_NOT_PUBLISHED',
  SLOTS_PUBLISHED: 'SLOTS_PUBLISHED',
  SLOT_ASSIGNED: 'SLOT_ASSIGNED',
  SLOT_DETAILS_SHARED: 'SLOT_DETAILS_SHARED',
  RESCHEDULE_REQUESTED: 'RESCHEDULE_REQUESTED',
  INTERVIEW_CONDUCTED: 'INTERVIEW_CONDUCTED',

  // Per-round outcomes
  ROUND_SELECTED_NEXT: 'ROUND_SELECTED_NEXT',
  ROUND_REJECTED: 'ROUND_REJECTED',                 // terminal
  ROUND_SELECTED_DIRECT_HR: 'ROUND_SELECTED_DIRECT_HR',
  ROUND_ON_HOLD: 'ROUND_ON_HOLD',

  // HR round
  HR_ROUND_PENDING: 'HR_ROUND_PENDING',
  HR_SELECTED: 'HR_SELECTED',
  HR_REJECTED: 'HR_REJECTED',                       // terminal
  HR_ON_HOLD: 'HR_ON_HOLD',

  // Offer
  OFFER_SENT: 'OFFER_SENT',
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  OFFER_REJECTED: 'OFFER_REJECTED',                 // terminal
  ONBOARDING: 'ONBOARDING',                         // terminal

  // General (kept from existing flow for re-shortlist support)
  REJECTED: 'REJECTED',
};

// ─── Actions ─────────────────────────────────────────────────────────────────
const ACTIONS = {
  // §1.1 Application-level
  SHORTLIST: 'SHORTLIST',
  REJECT: 'REJECT',
  RE_SHORTLIST: 'RE_SHORTLIST',

  // §1.2 Pipeline definition
  DEFINE_PIPELINE: 'DEFINE_PIPELINE',

  // §1.3 Assessment
  ASSESSMENT_PASS: 'ASSESSMENT_PASS',
  ASSESSMENT_FAIL: 'ASSESSMENT_FAIL',

  PUBLISH_SLOTS: 'PUBLISH_SLOTS',
  BOOK_SLOT: 'BOOK_SLOT',
  SHARE_DETAILS: 'SHARE_DETAILS',
  REQUEST_RESCHEDULE: 'REQUEST_RESCHEDULE',
  CONFIRM_RESCHEDULE: 'CONFIRM_RESCHEDULE',
  REJECT_RESCHEDULE: 'REJECT_RESCHEDULE',
  MARK_CONDUCTED: 'MARK_CONDUCTED',

  // §1.4 Step E — outcomes
  SELECT_NEXT_ROUND: 'SELECT_NEXT_ROUND',
  SELECT_DIRECT_HR: 'SELECT_DIRECT_HR',
  REJECT_ROUND: 'REJECT_ROUND',
  HOLD_ROUND: 'HOLD_ROUND',
  RESOLVE_HOLD: 'RESOLVE_HOLD',           // payload.resolution: 'NEXT_ROUND'|'SELECTED'|'REJECTED'

  // §1.5 HR round
  HR_SELECT: 'HR_SELECT',
  HR_REJECT: 'HR_REJECT',
  HR_HOLD: 'HR_HOLD',
  HR_RESOLVE_HOLD: 'HR_RESOLVE_HOLD',    // payload.resolution: 'SELECTED'|'REJECTED'

  // §1.6 Offer
  SEND_OFFER: 'SEND_OFFER',
  ACCEPT_OFFER: 'ACCEPT_OFFER',
  REJECT_OFFER: 'REJECT_OFFER',
};

// ─── Role constants ───────────────────────────────────────────────────────────
const ROLES = {
  COMPANY: 'company',      // "Client" in spec
  STAFFING_PARTNER: 'staffing_partner',  // "Vendor" in spec
  CANDIDATE: 'candidate',
  ADMIN: 'admin',          // oversight only — never permitted on mutating transitions
};

// ─── Transition table ─────────────────────────────────────────────────────────
// Format: { fromState: { action: { allowedRoles: [], nextState, requiresReason?, requiresPayload? } } }
// nextState = 'DYNAMIC' means the controller/FSM resolves it from payload.
const TRANSITIONS = {
  [PIPELINE_STATES.SHORTLISTED]: {
    [ACTIONS.REJECT]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.REJECTED,
      requiresReason: true,
    },
    [ACTIONS.DEFINE_PIPELINE]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.SHORTLISTED, // status stays SHORTLISTED; pipeline sub-doc is set
      meta: { sideEffect: 'SET_PIPELINE_TEMPLATE' },
    },
  },

  [PIPELINE_STATES.REJECTED]: {
    [ACTIONS.RE_SHORTLIST]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.SHORTLISTED,
    },
  },

  // ── Assessment round ─────────────────────────────────────────────────────
  [PIPELINE_STATES.ASSESSMENT_PENDING]: {
    [ACTIONS.ASSESSMENT_PASS]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.ASSESSMENT_PASSED,
    },
    [ACTIONS.ASSESSMENT_FAIL]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.ASSESSMENT_FAILED,
      requiresReason: true,
    },
  },

  // ── L-round slot lifecycle ────────────────────────────────────────────────
  [PIPELINE_STATES.SLOTS_NOT_PUBLISHED]: {
    [ACTIONS.PUBLISH_SLOTS]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.SLOTS_PUBLISHED,
    },
  },

  [PIPELINE_STATES.SLOTS_PUBLISHED]: {
    [ACTIONS.BOOK_SLOT]: {
      allowedRoles: [ROLES.STAFFING_PARTNER],
      nextState: PIPELINE_STATES.SLOT_ASSIGNED,
    },
  },

  [PIPELINE_STATES.SLOT_ASSIGNED]: {
    [ACTIONS.SHARE_DETAILS]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.SLOT_DETAILS_SHARED,
    },
    [ACTIONS.REQUEST_RESCHEDULE]: {
      allowedRoles: [ROLES.COMPANY, ROLES.STAFFING_PARTNER, ROLES.CANDIDATE],
      nextState: PIPELINE_STATES.RESCHEDULE_REQUESTED,
      requiresReason: true,
    },
  },

  [PIPELINE_STATES.SLOT_DETAILS_SHARED]: {
    [ACTIONS.REQUEST_RESCHEDULE]: {
      allowedRoles: [ROLES.COMPANY, ROLES.CANDIDATE, ROLES.STAFFING_PARTNER],
      nextState: PIPELINE_STATES.RESCHEDULE_REQUESTED,
      requiresReason: true,
    },
    [ACTIONS.MARK_CONDUCTED]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.INTERVIEW_CONDUCTED,
    },
  },

  [PIPELINE_STATES.RESCHEDULE_REQUESTED]: {
    [ACTIONS.CONFIRM_RESCHEDULE]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.SLOT_DETAILS_SHARED,
    },
    [ACTIONS.REJECT_RESCHEDULE]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.SLOTS_PUBLISHED,
    },
  },

  [PIPELINE_STATES.INTERVIEW_CONDUCTED]: {
    [ACTIONS.SELECT_NEXT_ROUND]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.ROUND_SELECTED_NEXT,
    },
    [ACTIONS.REJECT_ROUND]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.ROUND_REJECTED,
      requiresReason: true,
    },
    [ACTIONS.SELECT_DIRECT_HR]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.ROUND_SELECTED_DIRECT_HR,
    },
    [ACTIONS.HOLD_ROUND]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.ROUND_ON_HOLD,
      requiresReason: true,
    },
  },

  [PIPELINE_STATES.ROUND_ON_HOLD]: {
    [ACTIONS.RESOLVE_HOLD]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: 'DYNAMIC', // resolved from payload.resolution
      requiresPayload: ['resolution'], // 'NEXT_ROUND'|'SELECTED_DIRECT_HR'|'REJECTED'
      requiresReason: false,
    },
  },

  // ── HR round ─────────────────────────────────────────────────────────────
  [PIPELINE_STATES.HR_ROUND_PENDING]: {
    [ACTIONS.HR_SELECT]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.HR_SELECTED,
    },
    [ACTIONS.HR_REJECT]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.HR_REJECTED,
      requiresReason: true,
    },
    [ACTIONS.HR_HOLD]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.HR_ON_HOLD,
      requiresReason: true,
    },
  },

  [PIPELINE_STATES.HR_ON_HOLD]: {
    [ACTIONS.HR_RESOLVE_HOLD]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: 'DYNAMIC', // payload.resolution: 'SELECTED'|'REJECTED'
      requiresPayload: ['resolution'],
    },
  },

  [PIPELINE_STATES.HR_SELECTED]: {
    [ACTIONS.SEND_OFFER]: {
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.OFFER_SENT,
    },
  },

  // ── Offer ─────────────────────────────────────────────────────────────────
  [PIPELINE_STATES.OFFER_SENT]: {
    [ACTIONS.ACCEPT_OFFER]: {
      allowedRoles: [ROLES.CANDIDATE],
      nextState: PIPELINE_STATES.OFFER_ACCEPTED,
      requiresPayload: ['joiningDate'],
    },
    [ACTIONS.REJECT_OFFER]: {
      allowedRoles: [ROLES.CANDIDATE],
      nextState: PIPELINE_STATES.OFFER_REJECTED,
      requiresReason: true,
    },
  },

  [PIPELINE_STATES.OFFER_ACCEPTED]: {
    // Transitions to ONBOARDING — triggered automatically or by company confirm
    [ACTIONS.SELECT_NEXT_ROUND]: {   // reusing action as "confirm onboarding"
      allowedRoles: [ROLES.COMPANY],
      nextState: PIPELINE_STATES.ONBOARDING,
    },
  },
};

// ─── Dynamic state resolvers ─────────────────────────────────────────────────
const HOLD_RESOLUTIONS = {
  NEXT_ROUND: PIPELINE_STATES.ROUND_SELECTED_NEXT,
  SELECTED_DIRECT_HR: PIPELINE_STATES.ROUND_SELECTED_DIRECT_HR,
  REJECTED: PIPELINE_STATES.ROUND_REJECTED,
};

const HR_HOLD_RESOLUTIONS = {
  SELECTED: PIPELINE_STATES.HR_SELECTED,
  REJECTED: PIPELINE_STATES.HR_REJECTED,
};

// ─── Max candidate-initiated reschedules per round ───────────────────────────
const MAX_CANDIDATE_RESCHEDULES = 3;
const MAX_PARTNER_RESCHEDULES = 2;

// ─── Validation helpers ───────────────────────────────────────────────────────

function _err(message, code = 'FSM_ERROR') {
  return { ok: false, error: message, code };
}

function _ok(nextState, meta = {}) {
  return { ok: true, nextState, meta };
}

// ─── Main transition function ─────────────────────────────────────────────────

/**
 * Attempt a pipeline FSM transition.
 *
 * @param {object} params
 * @param {string} params.currentState   - Current PIPELINE_STATES value
 * @param {string} params.action         - ACTIONS value
 * @param {string} params.role           - ROLES value (caller's role)
 * @param {object} [params.payload]      - Action payload (reason, resolution, joiningDate, etc.)
 * @param {object} [params.context]      - Round-level context: { candidateRescheduleCount }
 *
 * @returns {{ ok: boolean, nextState?: string, meta?: object, error?: string, code?: string }}
 */
function transition({ currentState, action, role, payload = {}, context = {} }) {
  // ── Admin is never allowed to mutate ────────────────────────────────────
  if (role === ROLES.ADMIN) {
    return _err('Admin role has read-only access to the pipeline. No mutations allowed.', 'ADMIN_READONLY');
  }

  // Normalize legacy/top-level status values to pipeline FSM states
  let state = currentState;
  if (state === 'INTERVIEW_SCHEDULED' || state === 'INTERVIEW_CONFIRMED') {
    state = PIPELINE_STATES.SLOT_DETAILS_SHARED;
  } else if (state === 'INTERVIEWED') {
    state = PIPELINE_STATES.INTERVIEW_CONDUCTED;
  } else if (state === 'OFFERED') {
    state = PIPELINE_STATES.OFFER_SENT;
  } else if (state === 'JOINED') {
    state = PIPELINE_STATES.ONBOARDING;
  }

  // ── Validate state exists ────────────────────────────────────────────────
  const stateTransitions = TRANSITIONS[state];
  if (!stateTransitions) {
    const isTerminal = _isTerminalState(state);
    if (isTerminal) {
      return _err(`State "${state}" is terminal — no further transitions allowed.`, 'TERMINAL_STATE');
    }
    return _err(`Unknown pipeline state: "${state}"`, 'UNKNOWN_STATE');
  }

  // ── Validate action exists for this state ────────────────────────────────
  const txn = stateTransitions[action];
  if (!txn) {
    const validActions = Object.keys(stateTransitions);
    return _err(
      `Action "${action}" is not valid from state "${state}". Valid actions: [${validActions.join(', ')}]`,
      'INVALID_ACTION'
    );
  }

  // ── RBAC check ───────────────────────────────────────────────────────────
  if (!txn.allowedRoles.includes(role)) {
    return _err(
      `Role "${role}" cannot perform action "${action}" from state "${state}". Allowed roles: [${txn.allowedRoles.join(', ')}]`,
      'FORBIDDEN'
    );
  }

  // ── Reason required ──────────────────────────────────────────────────────
  if (txn.requiresReason) {
    const reason = payload.reason;
    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return _err('A reason is required (minimum 5 characters).', 'REASON_REQUIRED');
    }
  }

  // ── Required payload fields ──────────────────────────────────────────────
  if (txn.requiresPayload) {
    for (const field of txn.requiresPayload) {
      if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
        return _err(`Payload field "${field}" is required for action "${action}".`, 'PAYLOAD_MISSING');
      }
    }
  }

  // ── joiningDate validation (offer accept) ────────────────────────────────
  if (action === ACTIONS.ACCEPT_OFFER) {
    const d = new Date(payload.joiningDate);
    if (isNaN(d.getTime())) {
      return _err('joiningDate must be a valid date.', 'INVALID_DATE');
    }
  }

  // ── Reschedule cap (candidate-initiated only) ────────────────────────────
  if (action === ACTIONS.REQUEST_RESCHEDULE && role === ROLES.CANDIDATE) {
    const count = context.candidateRescheduleCount ?? 0;
    if (count >= MAX_CANDIDATE_RESCHEDULES) {
      return _err(
        `Reschedule limit reached. Candidates may only request up to ${MAX_CANDIDATE_RESCHEDULES} reschedules per round.`,
        'RESCHEDULE_CAP'
      );
    }
  }

  // ── Reschedule cap (partner-initiated only) ────────────────────────────
  if (action === ACTIONS.REQUEST_RESCHEDULE && role === ROLES.STAFFING_PARTNER) {
    const count = context.partnerRescheduleCount ?? 0;
    if (count >= MAX_PARTNER_RESCHEDULES) {
      return _err(
        `Reschedule limit reached. Talent Partners may only request up to ${MAX_PARTNER_RESCHEDULES} reschedules per round.`,
        'RESCHEDULE_CAP'
      );
    }
  }

  // ── Resolve dynamic next state ───────────────────────────────────────────
  let nextState = txn.nextState;
  if (nextState === 'DYNAMIC') {
    nextState = _resolveDynamic(action, payload);
    if (!nextState) {
      return _err(
        `Cannot resolve next state for action "${action}" with resolution "${payload.resolution}".`,
        'DYNAMIC_RESOLUTION_FAILED'
      );
    }
  }

  return _ok(nextState, txn.meta || {});
}

function _resolveDynamic(action, payload) {
  if (action === ACTIONS.RESOLVE_HOLD) {
    return HOLD_RESOLUTIONS[payload.resolution] || null;
  }
  if (action === ACTIONS.HR_RESOLVE_HOLD) {
    return HR_HOLD_RESOLUTIONS[payload.resolution] || null;
  }
  return null;
}

function _isTerminalState(state) {
  return [
    PIPELINE_STATES.ASSESSMENT_FAILED,
    PIPELINE_STATES.ROUND_REJECTED,
    PIPELINE_STATES.HR_REJECTED,
    PIPELINE_STATES.OFFER_REJECTED,
    PIPELINE_STATES.ONBOARDING,
    PIPELINE_STATES.REJECTED,
  ].includes(state);
}

// ─── Pipeline template validation ─────────────────────────────────────────────

/**
 * Validate a proposed pipeline template (ordered round array).
 * @param {Array<{ roundType: string, order: number }>} rounds
 * @returns {{ ok: boolean, error?: string }}
 */
function validatePipelineTemplate(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) {
    return { ok: false, error: 'Pipeline must contain at least one round.' };
  }
  if (rounds.length > 6) {
    return { ok: false, error: 'Pipeline cannot exceed 6 rounds.' };
  }

  // Ensure roundType names are unique (case-insensitive) to prevent state mapping collisions
  const seen = new Set();
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    if (!r.roundType || typeof r.roundType !== 'string' || r.roundType.trim().length === 0) {
      return { ok: false, error: `Round name at position ${i + 1} cannot be empty.` };
    }
    const normalized = r.roundType.trim().toLowerCase();
    if (seen.has(normalized)) {
      return { ok: false, error: `Duplicate round name "${r.roundType}" is not allowed.` };
    }
    seen.add(normalized);
  }

  return { ok: true };
}

/**
 * Given the round type, return the initial state.
 * If the roundType starts with or matches 'ASSESSMENT', it is treated as an assessment round (starting at ASSESSMENT_PENDING).
 * All other rounds are treated as interview rounds (starting at SLOTS_NOT_PUBLISHED).
 */
function getInitialRoundState(roundType) {
  const rt = (roundType || '').toUpperCase();
  if (rt === 'ASSESSMENT' || rt.startsWith('ASSESSMENT')) {
    return PIPELINE_STATES.ASSESSMENT_PENDING;
  }
  return PIPELINE_STATES.SLOTS_NOT_PUBLISHED;
}

module.exports = {
  transition,
  validatePipelineTemplate,
  getInitialRoundState,
  PIPELINE_STATES,
  ACTIONS,
  ROLES,
  ROUND_TYPES,
  MAX_CANDIDATE_RESCHEDULES,
  MAX_PARTNER_RESCHEDULES,
};
