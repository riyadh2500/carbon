'use strict';
const { verifyToken, configured } = require('../lib/supabase');

async function requireAuth(req, res, next) {
  // ── Supabase not configured → demo passthrough ───────────────
  if (!configured) {
    req.user      = null;
    req.authReady = false;
    return next();
  }

  const accessToken  = req.cookies && req.cookies['sb-access-token'];
  const refreshToken = req.cookies && req.cookies['sb-refresh-token'];

  // ── Try access token first ───────────────────────────────────
  if (accessToken) {
    const user = await verifyToken(accessToken);
    if (user) {
      req.user      = user;
      req.authReady = true;
      return next();
    }
  }

  // ── Access token missing/expired — try refresh token ─────────
  if (refreshToken) {
    try {
      const { supabase } = require('../lib/supabase');
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (!error && data.session) {
        const isProd = process.env.NODE_ENV === 'production';
        // Re-set fresh cookies
        res.cookie('sb-access-token', data.session.access_token, {
          httpOnly: true, secure: isProd, sameSite: 'lax',
          maxAge: 60 * 60 * 1000, path: '/',
        });
        res.cookie('sb-refresh-token', data.session.refresh_token, {
          httpOnly: true, secure: isProd, sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000, path: '/',
        });
        req.user      = data.session.user;
        req.authReady = true;
        return next();
      }
    } catch (_) { /* refresh failed — fall through to redirect */ }
  }

  // ── Both tokens invalid — redirect to login ──────────────────
  res.clearCookie('sb-access-token');
  res.clearCookie('sb-refresh-token');
  return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

async function redirectIfAuthed(req, res, next) {
  if (!configured) return next();

  const accessToken  = req.cookies && req.cookies['sb-access-token'];
  const refreshToken = req.cookies && req.cookies['sb-refresh-token'];

  if (accessToken) {
    const user = await verifyToken(accessToken);
    if (user) return res.redirect('/dashboard/overview');
  }

  if (refreshToken) {
    try {
      const { supabase } = require('../lib/supabase');
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (!error && data.session) return res.redirect('/dashboard/overview');
    } catch (_) {}
  }

  next();
}

module.exports = { requireAuth, redirectIfAuthed };
