// In-memory data store
// ─────────────────────────────────────────────────────────────
// Starts completely empty — no pre-seeded APIs or policies.
// Everything is added by the user at runtime.
// ─────────────────────────────────────────────────────────────

const store = {

  // Empty — user adds APIs via API Connections page
  apis: [],

  // Empty — user creates policies via Policy Builder
  policies: [],

  // Empty logs
  logs: [],

  stats: {
    connectedApis: 0,
    totalApis:     0,
    activePolicies: 0,
    pendingPolicies: 0,
    totalRequests:  0,
    blockedRequests: 0,
  },

  user: {
    name:     'Alex Carter',
    email:    'alex@carbon.dev',
    initials: 'AC',
    plan:     'Pro',
    usage:    0,
  },

  conversations: {},
  nextConvId:    1,
  nextLogId:     1,
  nextPolicyId:  1,
  nextApiId:     1,
};

module.exports = store;
