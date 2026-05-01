/**
 * Status Machine — Enforces valid status transitions across the platform
 * 
 * Flow:
 *   Partner submits candidate → SUBMITTED
 *   Company reviews → UNDER_REVIEW → SHORTLISTED → INTERVIEW_SCHEDULED
 *   → INTERVIEWED → OFFERED → OFFER_ACCEPTED → JOINED
 *   
 *   At any point: REJECTED, WITHDRAWN, ON_HOLD
 */

const CANDIDATE_TRANSITIONS = {
  // ✅ NEW STATES
  'DRAFT': ['CONSENT_PENDING', 'WITHDRAWN'],
  'CONSENT_PENDING': ['CONSENT_CONFIRMED', 'CONSENT_DENIED', 'WITHDRAWN'],
  'CONSENT_CONFIRMED': ['ADMIN_REVIEW', 'WITHDRAWN'],
  'CONSENT_DENIED': [],                             // terminal
  'ADMIN_REVIEW': ['SUBMITTED', 'ADMIN_REJECTED'],
  'ADMIN_REJECTED': [],                             // terminal

  // ✅ EXISTING STATES (unchanged)
  'SUBMITTED': ['UNDER_REVIEW', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN'],
  'UNDER_REVIEW': ['SHORTLISTED', 'REJECTED', 'ON_HOLD', 'WITHDRAWN'],
  'SHORTLISTED': ['INTERVIEW_SCHEDULED', 'REJECTED', 'ON_HOLD', 'WITHDRAWN'],
  'INTERVIEW_SCHEDULED': ['INTERVIEWED', 'REJECTED', 'ON_HOLD', 'WITHDRAWN'],
  'INTERVIEWED': ['SHORTLISTED', 'INTERVIEW_SCHEDULED', 'OFFERED', 'REJECTED', 'ON_HOLD', 'WITHDRAWN'],
  'OFFERED': ['OFFER_ACCEPTED', 'OFFER_DECLINED', 'WITHDRAWN'],
  'OFFER_ACCEPTED': ['JOINED', 'WITHDRAWN'],
  'OFFER_DECLINED': ['SHORTLISTED'],
  'JOINED': [],               // Terminal
  'REJECTED': ['SHORTLISTED'],   // Can be reconsidered
  'WITHDRAWN': [],                // Terminal
  'ON_HOLD': ['UNDER_REVIEW', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN']
};

const JOB_TRANSITIONS = {
  'DRAFT': ['PENDING_APPROVAL', 'ACTIVE'],
  'PENDING_APPROVAL': ['ACTIVE', 'DRAFT'],
  'ACTIVE': ['PAUSED', 'CLOSED', 'FILLED'],
  'PAUSED': ['ACTIVE', 'CLOSED'],
  'CLOSED': [],
  'FILLED': ['ACTIVE']
};

// What each role is allowed to change
const ROLE_PERMISSIONS = {
  candidate: {
    company: [
      'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED',
      'INTERVIEWED', 'OFFERED', 'OFFER_ACCEPTED', 'OFFER_DECLINED',
      'JOINED', 'REJECTED', 'ON_HOLD'
    ],
    staffing_partner: ['WITHDRAWN'],
    admin: [
      'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED',
      'INTERVIEWED', 'OFFERED', 'OFFER_ACCEPTED', 'OFFER_DECLINED',
      'JOINED', 'REJECTED', 'ON_HOLD', 'WITHDRAWN'
    ]
  },
  job: {
    company: ['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED'],
    admin: ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'CLOSED', 'FILLED']
  }
};

class StatusMachine {

  /**
   * Check if a status transition is valid
   * ✅ ENHANCED: Normalizes status strings, provides helpful hints
   * 
   * @param {string} type - 'candidate' or 'job'
   * @param {string} currentStatus 
   * @param {string} newStatus 
   * @param {string} userRole - 'company', 'staffing_partner', 'admin'
   * @returns {object} { allowed, message, allowedTransitions, hint? }
   */
  static canTransition(type, currentStatus, newStatus, userRole = null) {
    const transitions = type === 'candidate' ? CANDIDATE_TRANSITIONS : JOB_TRANSITIONS;

    // ✅ FIX 1: Normalize status strings (handle case mismatches, whitespace)
    const current = currentStatus?.toString().toUpperCase().trim();
    const target = newStatus?.toString().toUpperCase().trim();

    // ✅ FIX 2: Validate inputs exist
    if (!current || !target) {
      return {
        allowed: false,
        message: 'Current status and new status are required',
        allowedTransitions: [],
        hint: 'Both currentStatus and newStatus must be provided and non-empty'
      };
    }

    // ✅ FIX 3: Check if current status is valid
    if (!transitions[current]) {
      const validStatuses = Object.keys(transitions);
      return {
        allowed: false,
        message: `Unknown current status: "${currentStatus}"`,
        allowedTransitions: [],
        hint: `Valid statuses for ${type}: ${validStatuses.join(', ')}`
      };
    }

    const allowedStatuses = transitions[current];

    // ✅ FIX 4: Check if the transition itself is valid
    if (!allowedStatuses.includes(target)) {
      return {
        allowed: false,
        message: `Cannot move from "${current}" to "${target}"`,
        allowedTransitions: allowedStatuses,
        hint: allowedStatuses.length === 0
          ? `"${current}" is a terminal status and cannot be changed`
          : `From "${current}", you can move to: ${allowedStatuses.join(', ')}`
      };
    }

    // ✅ FIX 5: Check role permission
    if (userRole && ROLE_PERMISSIONS[type]) {
      const rolePerms = ROLE_PERMISSIONS[type];
      const roleAllowed = rolePerms[userRole] || [];

      if (!roleAllowed.includes(target)) {
        const validForRole = allowedStatuses.filter(s => roleAllowed.includes(s));

        return {
          allowed: false,
          message: `Your role (${userRole}) cannot set status to "${target}"`,
          allowedTransitions: validForRole,
          hint: validForRole.length > 0
            ? `As ${userRole}, from "${current}" you can move to: ${validForRole.join(', ')}`
            : `As ${userRole}, you cannot change status from "${current}"`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Get all valid next statuses for a given status + role
   */
  static getNextActions(type, currentStatus, userRole = null) {
    // ✅ FIX: Normalize status
    const current = currentStatus?.toString().toUpperCase().trim();
    const transitions = type === 'candidate' ? CANDIDATE_TRANSITIONS : JOB_TRANSITIONS;
    const allowed = transitions[current] || [];

    if (!userRole || !ROLE_PERMISSIONS[type]) return allowed;

    const roleAllowed = ROLE_PERMISSIONS[type][userRole] || [];
    return allowed.filter(s => roleAllowed.includes(s));
  }

  /**
   * Get human-readable status label
   * ✅ FIX: Handles case-insensitive input
   */
  static getStatusLabel(status) {
    const labels = {
      'DRAFT': 'Draft',
      'CONSENT_PENDING': 'Awaiting Candidate Consent',
      'CONSENT_CONFIRMED': 'Consent Confirmed',
      'CONSENT_DENIED': 'Consent Denied',
      'ADMIN_REVIEW': 'Under Admin Review',
      'ADMIN_REJECTED': 'Not Approved',
      'SUBMITTED': 'Submitted',
      'UNDER_REVIEW': 'Under Review',
      'SHORTLISTED': 'Shortlisted',
      'INTERVIEW_SCHEDULED': 'Interview Scheduled',
      'INTERVIEWED': 'Interviewed',
      'OFFERED': 'Offer Made',
      'OFFER_ACCEPTED': 'Offer Accepted',
      'OFFER_DECLINED': 'Offer Declined',
      'JOINED': 'Joined',
      'REJECTED': 'Rejected',
      'WITHDRAWN': 'Withdrawn',
      'ON_HOLD': 'On Hold',
      // Job statuses
      'PENDING_APPROVAL': 'Pending Approval',
      'ACTIVE': 'Active',
      'PAUSED': 'Paused',
      'CLOSED': 'Closed',
      'FILLED': 'Filled'
    };

    const normalized = status?.toString().toUpperCase().trim();
    return labels[normalized] || status;
  }


  /**
   * ✅ NEW: Get all possible transitions as a map (for documentation/debugging)
   */
  static getTransitionMap(type = 'candidate') {
    const transitions = type === 'candidate' ? CANDIDATE_TRANSITIONS : JOB_TRANSITIONS;
    const map = {};

    Object.entries(transitions).forEach(([from, toList]) => {
      map[from] = {
        label: this.getStatusLabel(from),
        canMoveTo: toList,
        canMoveToLabels: toList.map(s => this.getStatusLabel(s)),
        isTerminal: toList.length === 0
      };
    });

    return map;
  }

  /**
   * ✅ NEW: Get role-specific transition map
   */
  static getRoleTransitionMap(type = 'candidate', userRole) {
    const transitions = type === 'candidate' ? CANDIDATE_TRANSITIONS : JOB_TRANSITIONS;
    const rolePerms = ROLE_PERMISSIONS[type]?.[userRole] || [];
    const map = {};

    Object.entries(transitions).forEach(([from, toList]) => {
      const allowedForRole = toList.filter(s => rolePerms.includes(s));

      map[from] = {
        label: this.getStatusLabel(from),
        canMoveTo: allowedForRole,
        canMoveToLabels: allowedForRole.map(s => this.getStatusLabel(s)),
        blockedTransitions: toList.filter(s => !rolePerms.includes(s)),
        isTerminal: allowedForRole.length === 0
      };
    });

    return map;
  }

  /**
   * ✅ NEW: Debug helper — print all possible transitions
   */
  static printTransitionMap(type = 'candidate') {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${type.toUpperCase()} STATUS TRANSITIONS`);
    console.log('═'.repeat(60));

    const transitions = type === 'candidate' ? CANDIDATE_TRANSITIONS : JOB_TRANSITIONS;

    Object.entries(transitions).forEach(([from, toList]) => {
      const label = this.getStatusLabel(from);

      if (toList.length === 0) {
        console.log(`  ${from.padEnd(20)} → [TERMINAL]`);
      } else {
        console.log(`  ${from.padEnd(20)} → ${toList.join(', ')}`);
      }
    });

    console.log('\n' + '─'.repeat(60));
    console.log('  ROLE PERMISSIONS');
    console.log('─'.repeat(60));

    const rolePerms = ROLE_PERMISSIONS[type];
    if (rolePerms) {
      Object.entries(rolePerms).forEach(([role, statuses]) => {
        console.log(`  ${role.padEnd(20)} → can set: ${statuses.join(', ')}`);
      });
    }

    console.log('═'.repeat(60) + '\n');
  }

  /**
   * ✅ NEW: Validate a status string (check if it exists)
   */
  static isValidStatus(status, type = 'candidate') {
    const transitions = type === 'candidate' ? CANDIDATE_TRANSITIONS : JOB_TRANSITIONS;
    const normalized = status?.toString().toUpperCase().trim();
    return Object.keys(transitions).includes(normalized);
  }

  /**
   * ✅ NEW: Get all valid statuses for a type
   */
  static getAllStatuses(type = 'candidate') {
    const transitions = type === 'candidate' ? CANDIDATE_TRANSITIONS : JOB_TRANSITIONS;
    return Object.keys(transitions);
  }

  /**
   * ✅ NEW: Check if a status is terminal (no further transitions)
   */
  static isTerminal(status, type = 'candidate') {
    const transitions = type === 'candidate' ? CANDIDATE_TRANSITIONS : JOB_TRANSITIONS;
    const normalized = status?.toString().toUpperCase().trim();
    const allowed = transitions[normalized] || [];
    return allowed.length === 0;
  }
}

module.exports = StatusMachine;