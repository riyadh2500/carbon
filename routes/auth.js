'use strict';
const express = require('express');
const router  = express.Router();
const { configured } = require('../lib/supabase');
const { redirectIfAuthed } = require('../middleware/auth');

// ── GET /auth/callback ───────────────────────────────────────────
// Handles OAuth redirect (e.g. Google). Supabase redirects here with tokens
// in the URL hash — the browser-side JS picks them up via onAuthStateChange
// and posts them to /auth/session. This route just serves a minimal page.
router.get('/auth/callback', (req, res) => {
  res.render('auth', {
    layout:          false,
    mode:            'callback',
    supabaseUrl:     process.env.SUPABASE_URL      || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    configured,
    error:           null,
    next:            '/dashboard/overview',
  });
});

// ── GET /login ────────────────────────────────────────────────────
router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('auth', {
    layout: false,
    mode: 'login',
    supabaseUrl:     process.env.SUPABASE_URL     || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    configured,
    error: req.query.error || null,
    next:  req.query.next  || '/dashboard/overview',
  });
});

// ── GET /register ─────────────────────────────────────────────────
router.get('/register', redirectIfAuthed, (req, res) => {
  res.render('auth', {
    layout: false,
    mode: 'register',
    supabaseUrl:     process.env.SUPABASE_URL     || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    configured,
    error: null,
    next:  '/dashboard/overview',
  });
});

// ── GET /logout ───────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  res.clearCookie('sb-access-token',  { path: '/' });
  res.clearCookie('sb-refresh-token', { path: '/' });
  res.redirect('/login');
});

// ── POST /auth/session ────────────────────────────────────────────
// Called by the browser after a successful Supabase signIn/signUp.
// Stores the tokens in httpOnly cookies so the server can verify them.
router.post('/auth/session', express.json(), (req, res) => {
  const { access_token, refresh_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'No access token' });

  const isProd = process.env.NODE_ENV === 'production';

  res.cookie('sb-access-token', access_token, {
    httpOnly: true,
    secure:   isProd,
    sameSite: 'lax',
    maxAge:   60 * 60 * 1000, // 1 hour
    path:     '/',
  });

  if (refresh_token) {
    res.cookie('sb-refresh-token', refresh_token, {
      httpOnly: true,
      secure:   isProd,
      sameSite: 'lax',
      maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
      path:     '/',
    });
  }

  res.json({ ok: true });
});

// ── POST /auth/signout ────────────────────────────────────────────
router.post('/auth/signout', (req, res) => {
  res.clearCookie('sb-access-token',  { path: '/' });
  res.clearCookie('sb-refresh-token', { path: '/' });
  res.json({ ok: true });
});

module.exports = router;
