'use strict';
/**
 * Supabase server-side client
 * Uses the ANON key only — the service role key is never used here.
 * Authentication is done client-side (browser) via the Supabase JS SDK,
 * and the resulting JWT is sent to us as a cookie for server-side verification.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('your-project-ref')) {
  console.warn('\n  ⚠  Supabase not configured — auth will be disabled.');
  console.warn('     Set SUPABASE_URL and SUPABASE_ANON_KEY in .env\n');
}

// One shared client — used for server-side token verification
const supabase = (SUPABASE_URL && !SUPABASE_URL.includes('your-project-ref'))
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  : null;

/**
 * Verify a JWT access token and return the user, or null.
 */
async function verifyToken(accessToken) {
  if (!supabase || !accessToken) return null;
  try {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

module.exports = { supabase, verifyToken, configured: !!supabase };
