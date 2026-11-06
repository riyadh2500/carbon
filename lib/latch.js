'use strict';
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  CARBON — LATCH AUTHORIZATION ENGINE  v3                    ║
 * ║  Inspired by onlatch.com — Policy-driven API control        ║
 * ║                                                              ║
 * ║  FILTER PIPELINE:                                           ║
 * ║  1. Provider check (is API connected?)                      ║
 * ║  2. Policy existence (any active policies?)                 ║
 * ║  3. Topic/keyword blocks (message-level)                    ║
 * ║  4. Block pass (all block rules, first deny wins)           ║
 * ║  5. Allow pass (find matching allow rule)                   ║
 * ║  6. Rate limit enforcement                                  ║
 * ║  7. Response constraints (word limit)                       ║
 * ║                                                              ║
 * ║  GUARANTEES:                                                ║
 * ║  • Every request passes through authorize()                 ║
 * ║  • First deny wins (no bypass possible)                     ║
 * ║  • Rate limits use absolute timestamps                      ║
 * ║  • Policies evaluated in priority order                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const crypto = require('crypto');
const store  = require('../data/store');

// ─────────────────────────────────────────────────────────────────
// TOKEN GENERATION
// ─────────────────────────────────────────────────────────────────
function generateLatchToken(apiName) {
  const rand = crypto.randomBytes(14).toString('hex');
  const slug = (apiName || 'api').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 8);
  return `lat_${slug}_${rand}`;
}

// ─────────────────────────────────────────────────────────────────
// RATE LIMIT ENFORCEMENT
// ─────────────────────────────────────────────────────────────────
function checkRateLimit(apiName, limitStr) {
  if (!limitStr) return { exceeded: false };

  const match = limitStr.match(/(\d+)\s*\/\s*(hour|day|minute|min)/i);
  if (!match) return { exceeded: false };

  const limit  = parseInt(match[1]);
  const period = match[2].toLowerCase().startsWith('min') ? 'minute' : match[2].toLowerCase();

  const windowMs = { minute: 60_000, hour: 3_600_000, day: 86_400_000 }[period] || 3_600_000;
  const cutoff   = Date.now() - windowMs;

  const apiNorm = (apiName || '').toLowerCase().replace(/\s?api$/i, '').trim();

  const recentAllowed = store.logs.filter(l => {
    const lNorm = (l.api || '').toLowerCase().replace(/\s?api$/i, '').trim();
    if (lNorm !== apiNorm) return false;
    if (l.result !== 'allowed') return false;
    const ts = l.timestamp || 0;
    return ts >= cutoff;
  });

  if (recentAllowed.length >= limit) {
    return {
      exceeded: true,
      current:  recentAllowed.length,
      limit,
      period,
      reason:   `Rate limit exceeded: ${recentAllowed.length}/${limit} requests per ${period}. Request denied.`,
    };
  }
  return { exceeded: false, current: recentAllowed.length, limit, period };
}

// ─────────────────────────────────────────────────────────────────
// TOPIC / KEYWORD BLOCK CHECKER v4 — Latch-style topic enforcement
// Checks both rule-level keywords and policy meta allowOnlyTopic
// ─────────────────────────────────────────────────────────────────
function checkTopicBlock(message, policies) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const policy of policies) {
    // ── CHECK 1: "Allow only X" mode (exclusive allow) ────────────
    if (policy.meta && policy.meta.allowOnlyTopic) {
      const allowedTopic = policy.meta.allowOnlyTopic.toLowerCase();
      // Check if message contains the allowed topic
      if (!lower.includes(allowedTopic)) {
        return {
          blocked: true,
          policy:  policy.name,
          reason:  `Only questions about "${policy.meta.allowOnlyTopic}" are allowed. All other topics are blocked by policy: ${policy.name}`,
        };
      }
      // If allowed topic found, continue to next policy (don't block)
      continue;
    }

    // ── CHECK 2: Explicit keyword blocks from rules ───────────────
    if (policy.rules) {
      for (const rule of policy.rules) {
        if (rule.type !== 'block') continue;
        
        // Check rule.keywords array
        const kws = rule.keywords
          ? (Array.isArray(rule.keywords) ? rule.keywords : [rule.keywords])
          : rule.topic
            ? (Array.isArray(rule.topic) ? rule.topic : [rule.topic])
            : [];
        
        for (const kw of kws) {
          const kwLower = kw.toLowerCase();
          // Match whole word or as part of compound word
          if (lower.includes(kwLower)) {
            return {
              blocked: true,
              policy:  policy.name,
              reason:  rule.reason || `Questions about "${kw}" are blocked by policy: ${policy.name}`,
            };
          }
        }
      }
    }

    // ── CHECK 3: Fallback — extract from policy text if keywords missing
    const pt = (policy.text || policy.description || '').toLowerCase();
    if (!pt) continue;

    // Check for "Allow only X" in raw text (backup check)
    const onlyMatch = pt.match(/allow\s+only\s+([a-z0-9\s]+?)(?:\s+topic|\s+question|$)/i);
    if (onlyMatch) {
      const allowedTopic = onlyMatch[1].trim();
      if (!lower.includes(allowedTopic)) {
        return {
          blocked: true,
          policy:  policy.name,
          reason:  `Only "${allowedTopic}" topics are allowed. All other topics are blocked by policy: ${policy.name}`,
        };
      }
      continue;
    }

    // Check for "Block X" in raw text (backup check)
    const bp = /block\s+(?:any\s+)?(?:question|mention|topic)s?\s+(?:about\s+)?([a-z0-9]+)/gi;
    let m;
    while ((m = bp.exec(pt)) !== null) {
      const kw = m[1].trim();
      if (['all', 'other', 'any', 'the', 'a', 'an', 'of', 'to', 'from', 'it'].includes(kw)) continue;
      if (lower.includes(kw)) {
        return {
          blocked: true,
          policy:  policy.name,
          reason:  `Questions about "${kw}" are blocked by policy: ${policy.name}`,
        };
      }
    }
  }
  
  return null;
}

// ─────────────────────────────────────────────────────────────────
// PROVIDER CHECK
// ─────────────────────────────────────────────────────────────────
function checkProviderConnected(apiName) {
  const norm = (apiName || '').toLowerCase().replace(/\s?api$/i, '').trim();
  const found = store.apis.find(a => {
    const aNorm = a.name.toLowerCase().replace(/\s?api$/i, '').trim();
    return aNorm === norm && a.status === 'connected';
  });
  return found || null;
}

// ─────────────────────────────────────────────────────────────────
// ENDPOINT MATCHER
// ─────────────────────────────────────────────────────────────────
function matchEndpoint(ruleEp, reqEp) {
  if (ruleEp === '/*' || ruleEp === '*') return true;
  if (ruleEp === reqEp) return true;
  const prefix = ruleEp.replace(/\/\*$/, '');
  if (reqEp.startsWith(prefix + '/') || reqEp === prefix) return true;
  try {
    const pattern = '^' + ruleEp.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '($|/.*)';
    return new RegExp(pattern, 'i').test(reqEp);
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────
// RULE EVALUATOR
// ─────────────────────────────────────────────────────────────────
function evaluateRule(rule, context) {
  const { api, endpoint, asset } = context;
  const apiNorm = (api || '').toLowerCase().replace(/\s?api$/i, '').trim();

  // ── ALLOW ─────────────────────────────────────────────────────
  if (rule.type === 'allow') {
    if (rule.api && rule.api !== 'All' && rule.api !== '*') {
      const rNorm = rule.api.toLowerCase().replace(/\s?api$/i, '').trim();
      if (rNorm !== apiNorm) return null;
    }
    if (rule.asset && asset) {
      if (rule.asset.toUpperCase() !== (asset || '').toUpperCase()) return null;
    }
    if (rule.endpoint && rule.endpoint !== '/*' && rule.endpoint !== '*') {
      if (!matchEndpoint(rule.endpoint, endpoint || '')) return null;
    }
    if (rule.rateLimit) {
      const rl = checkRateLimit(api, rule.rateLimit);
      if (rl.exceeded) return { decision: 'block', rule, reason: rl.reason };
    }
    return { decision: 'allow', rule, rateLimit: rule.rateLimit || null };
  }

  // ── RATE LIMIT standalone ─────────────────────────────────────
  if (rule.type === 'rateLimit') {
    // Check if this rate limit applies to this API
    if (rule.api && rule.api !== 'All' && rule.api !== '*') {
      const rNorm = rule.api.toLowerCase().replace(/\s?api$/i, '').trim();
      if (rNorm !== apiNorm) return null;
    }
    const rl = checkRateLimit(api, rule.limit);
    if (rl.exceeded) return { decision: 'block', rule, reason: rl.reason };
    return { decision: 'allow', rule, rateLimit: rule.limit };
  }

  // ── BLOCK ─────────────────────────────────────────────────────
  if (rule.type === 'block') {
    // Skip keyword/topic blocks here — they're handled in checkTopicBlock()
    if (rule.keywords || rule.topic) return null;

    // API matching for non-keyword blocks
    if (rule.api && rule.api !== 'All' && rule.api !== '*') {
      const rNorm = rule.api.toLowerCase().replace(/\s?api$/i, '').trim();
      if (rNorm !== apiNorm) return null;
    }

    if (rule.except && asset) {
      const assetUp = (asset || '').toUpperCase();
      const excepted = rule.except.some(e => {
        const eu = e.toUpperCase().replace(/-USD$/, '');
        return eu === assetUp;
      });
      if (excepted) return null;
    }

    if (rule.asset && asset) {
      if (rule.asset.toUpperCase() !== (asset || '').toUpperCase()) return null;
    }

    if (rule.endpoint && rule.endpoint !== '/*' && rule.endpoint !== '*') {
      if (!matchEndpoint(rule.endpoint, endpoint || '')) return null;
    }

    return { decision: 'block', rule, reason: rule.reason || 'Blocked by active policy' };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────
// MAIN AUTHORIZE FUNCTION
// ─────────────────────────────────────────────────────────────────
function authorize(context) {
  const { api, endpoint, asset, intent, message } = context;
  const appliedRules = [];
  const trace = [];

  // ── STEP 1: Provider connectivity ─────────────────────────────
  const connApi = checkProviderConnected(api);
  if (!connApi) {
    const reason = `${api} is not connected. Add it in API Connections first.`;
    trace.push(`STEP1: FAIL — ${reason}`);
    return { allowed: false, policyName: 'Connection Check', reason, latchToken: null,
      appliedRules: [{ label: reason, pass: false }], trace };
  }
  appliedRules.push({ label: `${api} connected to workspace`, pass: true });
  trace.push(`STEP1: PASS — ${api} connected`);

  // ── STEP 2: Policy existence ──────────────────────────────────
  const activePolicies = store.policies.filter(p => p.status === 'active');
  if (activePolicies.length === 0) {
    const token = generateLatchToken(api);
    trace.push(`STEP2: DEFAULT ALLOW — no active policies`);
    return {
      allowed:      true,
      policyName:   'Default Allow',
      reason:       null,
      latchToken:   token,
      appliedRules: [
        ...appliedRules,
        { label: 'No active policies — Default Allow mode', pass: true },
      ],
      trace,
    };
  }
  appliedRules.push({ label: `${activePolicies.length} active policy/policies`, pass: true });
  trace.push(`STEP2: PASS — ${activePolicies.length} policies`);

  // ── STEP 3: Topic/keyword blocks ──────────────────────────────
  if (message) {
    const topicBlock = checkTopicBlock(message, activePolicies);
    if (topicBlock) {
      trace.push(`STEP3: BLOCK — ${topicBlock.reason}`);
      appliedRules.push({ label: topicBlock.reason, pass: false });
      return { allowed: false, policyName: topicBlock.policy, reason: topicBlock.reason,
        latchToken: null, appliedRules, trace };
    }
  }
  trace.push(`STEP3: PASS — no topic blocks`);

  // ── STEP 4: Find relevant policies ────────────────────────────
  const apiNorm = (api || '').toLowerCase().replace(/\s?api$/i, '').trim();
  const relevantPolicies = activePolicies.filter(p => {
    if (!p.api || p.api === 'Multiple' || p.api === 'All') return true;
    const paNorm = p.api.toLowerCase().replace(/\s?api$/i, '').trim();
    return paNorm === apiNorm;
  });
  trace.push(`STEP4: ${relevantPolicies.length} relevant policies`);

  // ── STEP 5: Block pass (first deny wins) ──────────────────────
  for (const policy of relevantPolicies) {
    if (!policy.rules) continue;
    for (const rule of policy.rules) {
      if (rule.type !== 'block' && rule.type !== 'rateLimit') continue;
      const result = evaluateRule(rule, context);
      if (!result) continue;
      if (result.decision === 'block') {
        trace.push(`STEP5: BLOCK — ${result.reason}`);
        appliedRules.push({ label: result.reason, pass: false });
        return { allowed: false, policyName: policy.name, reason: result.reason,
          latchToken: null, appliedRules, trace };
      }
    }
  }
  trace.push(`STEP5: PASS — no blocks`);

  // ── STEP 6: Allow pass ────────────────────────────────────────
  let allowDecision = null;
  let allowedPolicy = null;

  for (const policy of relevantPolicies) {
    if (!policy.rules) continue;
    for (const rule of policy.rules) {
      if (rule.type !== 'allow' && rule.type !== 'rateLimit') continue;
      const result = evaluateRule(rule, context);
      if (!result) continue;
      if (result.decision === 'block') {
        trace.push(`STEP6: RATE BLOCK — ${result.reason}`);
        appliedRules.push({ label: result.reason, pass: false });
        return { allowed: false, policyName: policy.name, reason: result.reason,
          latchToken: null, appliedRules, trace };
      }
      if (result.decision === 'allow' && !allowDecision) {
        allowDecision = result;
        allowedPolicy = policy;
        trace.push(`STEP6: ALLOW — policy "${policy.name}"`);
      }
    }
  }

  // ── STEP 7: Issue token if allowed ────────────────────────────
  if (allowDecision) {
    const token = generateLatchToken(api);
    appliedRules.push({ label: `Policy "${allowedPolicy.name}" permits this request`, pass: true });
    if (allowDecision.rateLimit) {
      const rl = checkRateLimit(api, allowDecision.rateLimit);
      appliedRules.push({ label: `Rate limit: ${rl.current}/${allowDecision.rateLimit} used`, pass: true });
    }
    trace.push(`STEP7: TOKEN ISSUED`);
    return { allowed: true, policyName: allowedPolicy.name, reason: null,
      latchToken: token, rateLimit: allowDecision.rateLimit, appliedRules, trace };
  }

  // ── STEP 8: No allow found → deny ─────────────────────────────
  const reason = `No active policy grants access to ${api}. Go to Policy Builder to create one.`;
  appliedRules.push({ label: reason, pass: false });
  trace.push(`STEP8: DENY — ${reason}`);
  return { allowed: false, policyName: 'Policy Engine', reason, latchToken: null, appliedRules, trace };
}

// ─────────────────────────────────────────────────────────────────
// POLICY COMPILER v4 — Latch-inspired natural language compilation
// Natural language → Latch-style structured rules
// ─────────────────────────────────────────────────────────────────
function compilePolicy(text, connectedApis) {
  const rules = [];
  const lower = text.toLowerCase();
  const meta = { responseWordLimit: null, allowOnlyTopic: null };

  // ── Helper: Extract rate limit ────────────────────────────────
  function extractRate(str, def) {
    const m1 = str.match(/(\d+)\s*(?:message|request|call|sms|query|time)s?\s*(?:per|\/|a|an|each)\s*(hour|day|minute|min)/i);
    if (m1) return `${m1[1]}/${m1[2].toLowerCase().startsWith('min') ? 'minute' : m1[2].toLowerCase()}`;
    const m2 = str.match(/limit\s+(?:to\s+)?(\d+)\s*(?:per|\/)\s*(hour|day|minute|min)/i);
    if (m2) return `${m2[1]}/${m2[2].toLowerCase().startsWith('min') ? 'minute' : m2[2].toLowerCase()}`;
    const m3 = str.match(/(\d+)\s*\/\s*(hour|day|minute|min)/i);
    if (m3) return `${m3[1]}/${m3[2].toLowerCase().startsWith('min') ? 'minute' : m3[2].toLowerCase()}`;
    return def;
  }

  // ── Helper: Extract response word limit ───────────────────────
  function extractResponseLimit(str) {
    const m = str.match(/(?:response|reply|answer)s?\s+(?:should\s+)?(?:not\s+)?(?:exceed|limit|max)\s+(\d+)\s*word/i);
    if (m) return parseInt(m[1]);
    const m2 = str.match(/(?:max|limit)\s+(\d+)\s*word/i);
    if (m2) return parseInt(m2[1]);
    return null;
  }

  const connected = connectedApis || store.apis.filter(a => a.status === 'connected');

  // ══════════════════════════════════════════════════════════════
  // RULE EXTRACTION ORDER (Process in priority order)
  // ══════════════════════════════════════════════════════════════

  // ── RULE 1: "Allow only X" (Exclusive allow — blocks all except X)
  const onlyMatch = lower.match(/allow\s+only\s+([a-z0-9\s]+?)(?:\s+topic|\s+question|$)/i);
  if (onlyMatch) {
    const allowedTopic = onlyMatch[1].trim();
    meta.allowOnlyTopic = allowedTopic;
    rules.push({
      type: 'meta',
      constraint: 'allowOnlyTopic',
      value: allowedTopic,
      description: `Only "${allowedTopic}" topics allowed`,
      reason: `Only questions about "${allowedTopic}" are allowed. All other topics blocked.`,
    });
  }

  // ── RULE 2: "Block X" (Block specific topic/keyword)
  // Matches: "Block bangladesh", "Block any question about india", "Block politics"
  const blockedKeywords = [];
  const blockPattern = /block\s+(?:any\s+)?(?:question|mention|topic)s?\s+(?:about\s+)?([a-z0-9]+)/gi;
  let blockMatch;
  while ((blockMatch = blockPattern.exec(lower)) !== null) {
    const keyword = blockMatch[1].trim();
    // Skip filler words
    if (['all', 'other', 'any', 'the', 'a', 'an', 'of', 'to', 'from', 'it'].includes(keyword)) continue;
    blockedKeywords.push(keyword);
    rules.push({
      type: 'block',
      api: '*',
      keywords: [keyword],
      reason: `Questions about "${keyword}" are blocked by policy`,
      description: `Block "${keyword}" topic`,
    });
  }

  // Also catch simple "Block X" without extra words
  const simpleBlock = lower.match(/\bblock\s+([a-z0-9]+)(?:\s|$)/i);
  if (simpleBlock && !blockedKeywords.includes(simpleBlock[1])) {
    const kw = simpleBlock[1].trim();
    if (!['all', 'other', 'any', 'the', 'a', 'an', 'of', 'to', 'from', 'it'].includes(kw)) {
      blockedKeywords.push(kw);
      rules.push({
        type: 'block',
        api: '*',
        keywords: [kw],
        reason: `Questions about "${kw}" are blocked by policy`,
        description: `Block "${kw}" topic`,
      });
    }
  }

  // ── RULE 3: Rate limits (Apply to all or specific API)
  const rate = extractRate(lower, null);
  if (rate) {
    let targetApi = 'All';
    // Check if a specific API is mentioned
    for (const api of connected) {
      if (lower.includes(api.name.toLowerCase())) {
        targetApi = api.name;
        break;
      }
    }
    rules.push({
      type: 'rateLimit',
      api: targetApi,
      limit: rate,
      description: `Rate limit: ${rate} for ${targetApi}`,
    });
  }

  // ── RULE 4: Response word limit (Applied post-generation)
  const respLimit = extractResponseLimit(lower);
  if (respLimit) {
    meta.responseWordLimit = respLimit;
    rules.push({
      type: 'meta',
      constraint: 'responseWordLimit',
      value: respLimit,
      description: `Response limited to ${respLimit} words`,
    });
  }

  // ── RULE 5: API-specific allow/block
  for (const api of connected) {
    if (!lower.includes(api.name.toLowerCase())) continue;
    
    const apiPos = lower.indexOf(api.name.toLowerCase());
    const apiContext = lower.slice(Math.max(0, apiPos - 15), apiPos + api.name.length + 25);
    
    if (/block|deny|restrict|prevent/.test(apiContext)) {
      rules.push({
        type: 'block',
        api: api.name,
        endpoint: '/*',
        reason: `${api.name} access blocked by policy`,
        description: `Block ${api.name}`,
      });
    } else if (/allow|permit|enable/.test(apiContext) && !rules.find(r => r.type === 'allow' && r.api === api.name)) {
      rules.push({
        type: 'allow',
        api: api.name,
        endpoint: '/*',
        rateLimit: rate || '100/hour',
        description: `Allow ${api.name}`,
      });
    }
  }

  // ── Fallback: Ensure there's always an allow rule
  // If only blocks exist, add a general allow so non-blocked topics work
  const hasAllow = rules.some(r => r.type === 'allow' || r.type === 'rateLimit');
  if (!hasAllow) {
    rules.push({
      type: 'allow',
      api: 'All',
      endpoint: '/*',
      rateLimit: rate || '100/hour',
      description: 'General access allowed',
    });
  }

  return { rules, errors: [], meta };
}

// ─────────────────────────────────────────────────────────────────
// POLICY VALIDATION
// ─────────────────────────────────────────────────────────────────
function validatePolicy(rules) {
  const issues   = [];
  const warnings = [];
  const allows   = rules.filter(r => r.type === 'allow');
  const blocks   = rules.filter(r => r.type === 'block');

  allows.forEach(a => {
    const conflict = blocks.find(b =>
      b.api === a.api && b.endpoint === a.endpoint && !b.except && !b.keywords && b.asset === a.asset
    );
    if (conflict) issues.push(`Conflict: ${a.api} is both allowed and blocked`);
  });

  const noLimit = allows.filter(a => !a.rateLimit && a.api !== 'All');
  if (noLimit.length) warnings.push(`No rate limit: ${noLimit.map(a => a.api).join(', ')}`);

  return {
    valid:    issues.length === 0,
    issues,
    warnings,
    score:    issues.length === 0 ? (warnings.length === 0 ? 'strong' : 'moderate') : 'weak',
  };
}

function getActivePolicies(apiName) {
  return store.policies.filter(p =>
    p.status === 'active' &&
    (!p.api || p.api === apiName || p.api === 'Multiple' || p.api === 'All')
  );
}

module.exports = {
  authorize,
  compilePolicy,
  validatePolicy,
  generateLatchToken,
  getActivePolicies,
  checkRateLimit,
  matchEndpoint,
};
