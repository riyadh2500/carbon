'use strict';
const express = require('express');
const router  = express.Router();
const store   = require('../data/store');
const { requireAuth } = require('../middleware/auth');

// ── Helper: build user context from Supabase user or store fallback ──
function buildUser(supabaseUser) {
  if (!supabaseUser) {
    // Demo mode — Supabase not configured
    return store.user;
  }
  const meta  = supabaseUser.user_metadata || {};
  const name  = meta.full_name || meta.name || supabaseUser.email.split('@')[0];
  const email = supabaseUser.email || '';
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  return {
    id:       supabaseUser.id,
    name,
    email,
    initials,
    plan:     'Pro',
    usage:    store.user.usage,
    avatar:   meta.avatar_url || null,
  };
}

// ── All dashboard routes require auth ─────────────────────────────
router.use(requireAuth);

// Redirect /dashboard → /dashboard/overview
router.get('/', (req, res) => res.redirect('/dashboard/overview'));

router.get('/:page', (req, res) => {
  const page = req.params.page;
  const validPages = [
    'overview', 'api-connections', 'policy-builder',
    'ai-playground', 'request-logs', 'settings',
  ];
  if (!validPages.includes(page)) return res.redirect('/dashboard/overview');

  const user = buildUser(req.user);

  res.render('dashboard', {
    layout:        false,
    page,
    user,
    stats:         store.stats,
    apis:          store.apis,
    policies:      store.policies,
    logs:          store.logs,
    connectedApis: store.apis.filter(a => a.status === 'connected'),
    supabaseConfigured: require('../lib/supabase').configured,
    supabaseUrl:     process.env.SUPABASE_URL      || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  });
});

module.exports = router;
