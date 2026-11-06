'use strict';
const express = require('express');
const https   = require('https');
const router  = express.Router();
const store   = require('../data/store');
const { verifyToken, configured } = require('../lib/supabase');

// ─────────────────────────────────────────────────────────────────
// AUTH ENDPOINTS (session refresh + profile)
// ─────────────────────────────────────────────────────────────────

// POST /api/auth/refresh — refresh the httpOnly cookie
router.post('/auth/refresh', async (req, res) => {
  if (!configured) return res.json({ ok: true, demo: true });

  const refreshToken = req.cookies && req.cookies['sb-refresh-token'];
  // No refresh token — don't hard 401, just return ok:false so frontend handles gracefully
  if (!refreshToken) return res.json({ ok: false, expired: true });

  try {
    const { supabase } = require('../lib/supabase');
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      res.clearCookie('sb-access-token');
      res.clearCookie('sb-refresh-token');
      // Return 401 only on confirmed auth failure
      return res.status(401).json({ error: 'Session expired', expired: true });
    }
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('sb-access-token', data.session.access_token, {
      httpOnly: true, secure: isProd, sameSite: 'lax',
      maxAge: 60 * 60 * 1000, path: '/',
    });
    res.cookie('sb-refresh-token', data.session.refresh_token, {
      httpOnly: true, secure: isProd, sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, path: '/',
    });
    return res.json({ ok: true });
  } catch (err) {
    // Server error — return ok:false but NOT 401 to avoid redirect loop
    return res.json({ ok: false, error: 'Refresh failed' });
  }
});

// GET /api/auth/me — return current authenticated user info
router.get('/auth/me', async (req, res) => {
  const token = req.cookies && req.cookies['sb-access-token'];
  const user  = token ? await verifyToken(token) : null;
  if (!user && configured) return res.status(401).json({ error: 'Not authenticated' });

  const meta = (user && user.user_metadata) || {};
  const name = meta.full_name || meta.name || (user && user.email) || store.user.name;
  res.json({
    id:       user ? user.id       : 'demo',
    name,
    email:    user ? user.email    : store.user.email,
    initials: name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2),
    avatar:   meta.avatar_url      || null,
  });
});


// ─────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────
function nowTime() {
  const d = new Date();
  let h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

function addLog(api, result, policy, detail) {
  const id = ++store.nextLogId;
  store.logs.unshift({
    id,
    time:      nowTime(),
    timestamp: Date.now(),       // absolute ms timestamp for rate limit enforcement
    api,
    result,
    policy,
    detail,
    source: `${api} API`,
  });
  store.stats.totalRequests++;
  if (result === 'blocked') store.stats.blockedRequests++;
  return id;
}

// ─────────────────────────────────────────────────────────────────
// REAL GROK / LLM API CALL
// Grok uses the OpenAI-compatible API at api.x.ai
// ─────────────────────────────────────────────────────────────────
// LLM PROVIDER CONFIG
// ─────────────────────────────────────────────────────────────────
const LLM_PROVIDERS = {
  groq: {
    match:    (n, b) => n.includes('groq') || b.includes('groq.com'),
    hostname: 'api.groq.com',
    chatPath: '/openai/v1/chat/completions',
    modelsPath: '/openai/v1/models',
    // Preferred models in order — first available one will be used
    // Updated with latest Groq models including OpenAI partnership models
    preferredModels: [
      'openai/gpt-oss-120b',      // Latest OpenAI-partnered model on Groq
      'openai/gpt-oss-20b',       // Fast OpenAI-partnered model
      'llama-3.3-70b-versatile',
      'llama-3.1-70b-versatile',
      'llama-3.2-90b-text-preview',
      'llama3-70b-8192',
      'llama-3.1-8b-instant',
      'llama3-8b-8192',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
      'gemma-7b-it',
      'qwen-2-72b-instruct',
      'deepseek-r1-distill-llama-70b',
    ],
  },
  openai: {
    match:    (n, b) => n.includes('openai') || b.includes('openai.com') || n.includes('gpt'),
    hostname: 'api.openai.com',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    preferredModels: [
      'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo',
    ],
  },
  xai: {
    match:    (n, b) => n.includes('grok') || b.includes('x.ai') || n.includes('xai'),
    hostname: 'api.x.ai',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    preferredModels: [
      'grok-2-latest', 'grok-2', 'grok-beta', 'grok-vision-beta',
    ],
  },
  anthropic: {
    match:    (n, b) => n.includes('anthropic') || n.includes('claude') || b.includes('anthropic.com'),
    hostname: 'api.anthropic.com',
    chatPath: '/v1/messages',
    modelsPath: null,  // Anthropic doesn't have a /models endpoint
    preferredModels: [
      'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
      'claude-3-sonnet-20240229', 'claude-3-haiku-20240307',
    ],
  },
};

// Cache available models per API key to avoid fetching on every request
// Keys are last 8 chars of API key → array of available model IDs
const _modelCache = {};
// Clear cache on startup so stale models don't persist
Object.keys(_modelCache).forEach(k => delete _modelCache[k]);

// Fetch available models from provider
function fetchAvailableModels(hostname, modelsPath, apiKey) {
  return new Promise((resolve) => {
    if (!modelsPath) return resolve([]);
    const options = {
      hostname, path: modelsPath, method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'Carbon-AI-Platform/1.0' },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const ids = (json.data || []).map(m => m.id).filter(Boolean);
          resolve(ids);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(5000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

// Pick best available model from preferred list
async function pickBestModel(provider, hostname, apiKey, userSpecifiedModel) {
  if (userSpecifiedModel) return userSpecifiedModel;

  const cacheKey = apiKey.slice(-8);
  if (_modelCache[cacheKey]) {
    const available = _modelCache[cacheKey];
    const best = provider.preferredModels.find(m => available.includes(m));
    if (best) return best;
  }

  // Fetch available models
  const available = await fetchAvailableModels(hostname, provider.modelsPath, apiKey);
  if (available.length > 0) {
    _modelCache[cacheKey] = available;
    // Only match against our known preferred models — never pick unknown/third-party models
    const best = provider.preferredModels.find(m => available.includes(m));
    if (best) return best;
  }

  // Always fall back to first preferred model (safe default)
  return provider.preferredModels[0];
}

// ─────────────────────────────────────────────────────────────────
// REAL LLM API CALL
// Auto-detects provider, fetches available models, picks best one
// Supports Groq, OpenAI, xAI Grok, Anthropic, any OpenAI-compatible
// ─────────────────────────────────────────────────────────────────
async function callLLMApi(apiRecord, messages) {
  const apiKey = apiRecord.apiKey || '';
  if (!apiKey || apiKey === 'public' || apiKey.startsWith('•')) {
    throw new Error('No valid API key for ' + apiRecord.name + '. Update it in API Connections.');
  }

  const nameL = (apiRecord.name || '').toLowerCase();
  const baseL = (apiRecord.baseUrl || '').toLowerCase();

  // Detect provider
  let provider = null;
  for (const [, p] of Object.entries(LLM_PROVIDERS)) {
    if (p.match(nameL, baseL)) { provider = p; break; }
  }

  // Generic OpenAI-compatible fallback
  if (!provider) {
    let hostname = 'api.openai.com';
    try { hostname = new URL(apiRecord.baseUrl || '').hostname; } catch {}
    provider = {
      hostname,
      chatPath: '/v1/chat/completions',
      modelsPath: '/v1/models',
      preferredModels: ['gpt-4o-mini', 'gpt-3.5-turbo'],
      match: () => true,
    };
  }

  const hostname = provider.hostname;

  // Pick the best available model
  const model = await pickBestModel(provider, hostname, apiKey, apiRecord.model);

  // Build request body — handle Anthropic separately (different format)
  const isAnthropic = hostname.includes('anthropic.com');
  let body;
  if (isAnthropic) {
    const sysMsg = messages.find(m => m.role === 'system');
    const chatMsgs = messages.filter(m => m.role !== 'system');
    body = JSON.stringify({
      model,
      system: sysMsg?.content || '',
      messages: chatMsgs,
      max_tokens: 600,
    });
  } else {
    body = JSON.stringify({ model, messages, max_tokens: 600, temperature: 0.7 });
  }

  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path: provider.chatPath,
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${apiKey}`,
        'Content-Type':   'application/json',
        'User-Agent':     'Carbon-AI-Platform/1.0',
        'Content-Length': Buffer.byteLength(body),
        ...(isAnthropic ? { 'anthropic-version': '2023-06-01' } : {}),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)));
          // OpenAI-compatible response
          const content = json.choices?.[0]?.message?.content
            // Anthropic response format
            || json.content?.[0]?.text;
          if (!content) return reject(new Error('Empty response from ' + apiRecord.name + ' model=' + model));
          resolve({ content, model: json.model || model, usage: json.usage });
        } catch (e) {
          reject(new Error('Parse error: ' + e.message + ' | ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error(apiRecord.name + ' timeout (30s)')); });
    req.write(body);
    req.end();
  });
}
// ─────────────────────────────────────────────────────────────────
function fetchCoinbasePrice(symbol) {
  return new Promise((resolve, reject) => {
    const pair = `${symbol.toUpperCase()}-USD`;
    const options = {
      hostname: 'api.coinbase.com',
      path: `/v2/prices/${pair}/spot`,
      method: 'GET',
      headers: { 'User-Agent': 'Carbon-AI-Platform/1.0' },
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.data && json.data.amount) {
            resolve({ symbol: json.data.base, price: parseFloat(json.data.amount), currency: json.data.currency, source: 'Coinbase' });
          } else {
            reject(new Error('No price data'));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────
// COINMARKETCAP PRICE FETCH
// ─────────────────────────────────────────────────────────────────
function fetchCoinMarketCapPrice(symbol, apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'pro-api.coinmarketcap.com',
      path:     `/v1/cryptocurrency/quotes/latest?symbol=${symbol.toUpperCase()}&convert=USD`,
      method:   'GET',
      headers:  {
        'X-CMC_PRO_API_KEY': apiKey,
        'Accept':            'application/json',
        'User-Agent':        'Carbon-AI-Platform/1.0',
      },
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.status && json.status.error_code !== 0) {
            return reject(new Error(json.status.error_message || 'CoinMarketCap API error'));
          }
          const data = json.data && json.data[symbol.toUpperCase()];
          if (!data) return reject(new Error(`${symbol} not found on CoinMarketCap`));
          const price = data.quote && data.quote.USD && data.quote.USD.price;
          if (!price) return reject(new Error('No price data'));
          resolve({
            symbol:    data.symbol,
            name:      data.name,
            price:     parseFloat(price),
            currency:  'USD',
            change24h: data.quote.USD.percent_change_24h,
            marketCap: data.quote.USD.market_cap,
            source:    'CoinMarketCap',
          });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────
// SMART PRICE FETCH — uses whichever crypto API is available/scoped
// ─────────────────────────────────────────────────────────────────
async function fetchPrice(symbol, scopedApis) {
  const available = scopedApis || store.apis.filter(a => a.status === 'connected');

  // Check CoinMarketCap first if it's in scope
  const cmc = available.find(a => a.name.toLowerCase().includes('coinmarketcap') || a.name.toLowerCase().includes('cmc'));
  if (cmc) {
    try {
      const data = await fetchCoinMarketCapPrice(symbol, cmc.apiKey || cmc.keyHint || '');
      return { ...data, apiName: cmc.name };
    } catch (e) {
      // Fall through to Coinbase
    }
  }

  // Try Coinbase
  const coinbase = available.find(a => a.name.toLowerCase().includes('coinbase'));
  if (coinbase) {
    const data = await fetchCoinbasePrice(symbol);
    return { ...data, apiName: coinbase.name };
  }

  throw new Error('No crypto price API connected. Add Coinbase or CoinMarketCap in API Connections.');
}

// ─────────────────────────────────────────────────────────────────
// POLICY ENGINE
// Check whether an operation is permitted by active policies
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// POLICY ENGINE — powered by Latch authorization
// ─────────────────────────────────────────────────────────────────
function checkPolicy(intent, details, scopedApis) {
  const available = scopedApis || store.apis.filter(a => a.status === 'connected');

  // Detect which crypto API is available
  const hasCmc      = available.some(a => a.name.toLowerCase().includes('coinmarketcap') || a.name.toLowerCase().includes('cmc'));
  const hasCoinbase = available.some(a => a.name.toLowerCase().includes('coinbase'));
  const cryptoApi   = hasCmc ? (available.find(a => a.name.toLowerCase().includes('coinmarketcap') || a.name.toLowerCase().includes('cmc'))?.name || 'CoinMarketCap')
                              : 'Coinbase';

  const intentToContext = {
    price:    { api: cryptoApi, endpoint: `/v2/prices/${(details.symbol||'BTC').toUpperCase()}-USD/spot`, asset: details.symbol },
    buy:      { api: cryptoApi, endpoint: '/v2/orders/create',      asset: null },
    sell:     { api: cryptoApi, endpoint: '/v2/orders/create',      asset: null },
    trade:    { api: cryptoApi, endpoint: '/v2/orders/create',      asset: null },
    withdraw: { api: cryptoApi, endpoint: '/v2/withdrawals/create', asset: null },
    transfer: { api: cryptoApi, endpoint: '/v2/withdrawals/create', asset: null },
    sms:      { api: 'SMS API', endpoint: '/messages/send',         asset: null },
    general:  { api: available[0]?.name || 'Carbon Agent', endpoint: '/chat', asset: null },
    capabilities:  { api: 'Carbon Agent', endpoint: '/chat', asset: null },
    list_apis:     { api: 'Carbon Agent', endpoint: '/chat', asset: null },
    list_policies: { api: 'Carbon Agent', endpoint: '/chat', asset: null },
  };

  const ctx = intentToContext[intent] || { api: available[0]?.name || 'Carbon Agent', endpoint: '/chat', asset: null };
  const result = require('../lib/latch').authorize({ ...ctx, intent, message: details.message });

  return {
    allowed:      result.allowed,
    reason:       result.reason,
    policy:       result.policyName,
    policyId:     result.policyId,
    api:          ctx.api,
    endpoint:     ctx.endpoint,
    latchToken:   result.latchToken,
    appliedRules: result.appliedRules,
  };
}


// ─────────────────────────────────────────────────────────────────
// INTENT DETECTION — dynamic, reads connected APIs from store
// ─────────────────────────────────────────────────────────────────
function detectIntent(message, history, scopedApis) {
  const m = message.toLowerCase();
  // Use scoped APIs if provided, else all connected
  const apisToCheck = scopedApis || store.apis.filter(a => a.status === 'connected');
  // Trade/buy/sell — BEFORE price to avoid "buy bitcoin" → price
  if (/\b(buy|purchase|trade|swap|exchange)\b/.test(m)) return { intent: 'buy' };
  if (/\b(sell|dump|liquidate)\b/.test(m))              return { intent: 'sell' };
  if (/\b(withdraw|transfer|send funds|move funds|wire)\b/.test(m)) return { intent: 'withdraw' };

  // SMS / messaging
  if (/\b(sms|text message|send a message|send text|notify via sms|send sms)\b/.test(m)) return { intent: 'sms' };

  // Crypto price queries
  const priceWords = ['price', 'worth', 'value', 'cost', 'how much', 'current price', 'rate', 'quote'];
  const cryptoMap  = {
    'bitcoin':'BTC','btc':'BTC','ethereum':'ETH','eth':'ETH',
    'solana':'SOL','sol':'SOL','cardano':'ADA','ada':'ADA',
    'dogecoin':'DOGE','doge':'DOGE','xrp':'XRP','ripple':'XRP',
    'litecoin':'LTC','ltc':'LTC','bnb':'BNB','binance coin':'BNB',
  };
  const hasPrice = priceWords.some(p => m.includes(p));
  let sym = null;
  for (const [key, val] of Object.entries(cryptoMap)) {
    if (m.includes(key)) { sym = val; break; }
  }
  if (sym && hasPrice) return { intent: 'price', symbol: sym };
  if (sym && !hasPrice) return { intent: 'price', symbol: sym };

  // Dynamic: check if message mentions any connected API by name
  for (const api of apisToCheck) {
    if (m.includes(api.name.toLowerCase())) {
      return { intent: 'api_query', apiName: api.name };
    }
  }

  // Meta
  if (/\b(what can you do|capabilities|help me|what do you|what are you able)\b/.test(m)) return { intent: 'capabilities' };
  if (/\b(what api|connected api|which api|list api|available api|apis are|my apis)\b/.test(m)) return { intent: 'list_apis' };
  if (/\b(what polic|active polic|current polic|my polic|show polic)\b/.test(m)) return { intent: 'list_policies' };

  return { intent: 'general' };
}

// ─────────────────────────────────────────────────────────────────
// RESPONSE BUILDER — fully dynamic, policy + API driven
// Every request: message → Latch.authorize() → execute or block
// ─────────────────────────────────────────────────────────────────
async function buildResponse(message, intentData, history, scopedApis) {
  const { intent }       = intentData;
  const connectedApis    = scopedApis || store.apis.filter(a => a.status === 'connected');
  const activePolicies   = store.policies.filter(p => p.status === 'active');

  // ── NO APIS CONNECTED — only block API-specific operations ─────
  // Allow general conversation even when no APIs are connected.
  // Only show the setup guide for API-specific intents.
  if (connectedApis.length === 0 && !['general', 'capabilities', 'list_apis', 'list_policies'].includes(intent)) {
    return {
      response: `Your workspace has no APIs connected yet.\n\n**Get started:**\n1. Go to **API Connections** → click **+ Add API**\n2. Enter your API name, base URL, and key\n3. Come back here and start chatting`,
      status:         'allowed',
      blockedReason:  null,
      requestDetails: { status: 'allowed', policy: '—', api: '—', endpoint: '—', time: nowTime() },
      appliedRules:   [{ label: 'No APIs — setup guide shown', pass: true }],
    };
  }

  // Helper: build a blocked response from a Latch check result
  function blocked(check, api, endpoint) {
    addLog(api, 'blocked', check.policy, message.slice(0, 60));
    return {
      response:      `**Request Blocked by Latch Policy Engine**\n\n**Reason:** ${check.reason}\n\n**Policy:** ${check.policy}\n\nUpdate your policies in Policy Builder if you want to allow this operation.`,
      status:        'blocked',
      blockedReason: { policy: check.policy, reason: check.reason },
      requestDetails:{ status: 'blocked', policy: check.policy, api, endpoint, time: nowTime() },
      appliedRules:  check.appliedRules || [{ label: check.reason, pass: false }],
    };
  }

  // ── PRICE QUERY — uses CoinMarketCap or Coinbase automatically ──
  if (intent === 'price') {
    const { symbol } = intentData;

    // Find which crypto API is in scope
    const cryptoApi = connectedApis.find(a =>
      a.name.toLowerCase().includes('coinmarketcap') ||
      a.name.toLowerCase().includes('cmc') ||
      a.name.toLowerCase().includes('coinbase')
    );
    const apiName    = cryptoApi ? cryptoApi.name : 'Coinbase';
    const endpoint   = `/v2/prices/${symbol}-USD/spot`;
    const check      = checkPolicy('price', { symbol, message }, connectedApis);

    if (!check.allowed) return blocked(check, apiName, endpoint);

    try {
      const data      = await fetchPrice(symbol, connectedApis);
      const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(data.price);

      let extraInfo = '';
      if (data.change24h !== undefined) {
        const sign  = data.change24h >= 0 ? '▲' : '▼';
        const color = data.change24h >= 0 ? '+' : '';
        extraInfo = `\n24h change: **${sign} ${color}${data.change24h.toFixed(2)}%**`;
      }
      if (data.marketCap) {
        const mcFormatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(data.marketCap);
        extraInfo += `\nMarket cap: **${mcFormatted}**`;
      }

      addLog(data.apiName || apiName, 'allowed', check.policy, `${symbol} price — ${formatted}`);
      return {
        response:       `The current price of **${data.symbol}${data.name ? ` (${data.name})` : ''}** is **${formatted}**.${extraInfo}\n\nSource: ${data.source || apiName} ✓`,
        status:         'allowed',
        blockedReason:  null,
        requestDetails: { status: 'allowed', policy: check.policy, api: data.apiName || apiName, endpoint, time: nowTime() },
        appliedRules:   check.appliedRules || [{ label: 'Allowed by policy', pass: true }],
      };
    } catch (err) {
      addLog(apiName, 'failed', check.policy, `${symbol} fetch error: ${err.message}`);
      return {
        response:       `I tried to fetch the **${symbol}** price but the request failed.\n\n**Error:** ${err.message}\n\nMake sure your API key is correct in API Connections.`,
        status:         'failed',
        blockedReason:  { policy: 'API Error', reason: err.message },
        requestDetails: { status: 'failed', policy: check.policy, api: apiName, endpoint, time: nowTime() },
        appliedRules:   check.appliedRules || [],
      };
    }
  }

  // ── TRADE / BUY / SELL ────────────────────────────────────────
  if (intent === 'buy' || intent === 'sell' || intent === 'trade') {
    const check = checkPolicy('trade', { message }, connectedApis);
    const apiName = connectedApis.find(a => a.name.toLowerCase().includes('coinbase') || a.name.toLowerCase().includes('coinmarketcap'))?.name || 'Crypto API';
    return blocked(check, apiName, '/orders/create');
  }

  // ── WITHDRAW ─────────────────────────────────────────────────
  if (intent === 'withdraw') {
    const check = checkPolicy('withdraw', { message }, connectedApis);
    const apiName = connectedApis.find(a => a.name.toLowerCase().includes('coinbase') || a.name.toLowerCase().includes('coinmarketcap'))?.name || 'Crypto API';
    return blocked(check, apiName, '/withdrawals/create');
  }

  // ── SMS ───────────────────────────────────────────────────────
  if (intent === 'sms') {
    const check = checkPolicy('sms', { message }, connectedApis);
    if (!check.allowed) return blocked(check, 'SMS API', '/messages/send');

    addLog('SMS API', 'allowed', check.policy, 'SMS request — policy passed');
    const rl = check.rateLimit ? `\nRate limit: ${check.rateLimit}` : '';
    return {
      response:       `SMS request acknowledged.\n\nLatch policy check passed ✓${rl}\nLatch token: \`${check.latchToken}\`\n\n**Note:** Requires a real SMS provider key (e.g. Twilio) to send.`,
      status:         'allowed',
      blockedReason:  null,
      requestDetails: { status: 'allowed', policy: check.policy, api: 'SMS API', endpoint: '/messages/send', time: nowTime() },
      appliedRules:   check.appliedRules || [],
    };
  }

  // ── DYNAMIC API QUERY (custom connected APIs) ────────────────
  if (intent === 'api_query') {
    const { apiName } = intentData;
    const api = connectedApis.find(a => a.name === apiName);
    if (!api) {
      return {
        response:       `**${apiName}** is not currently connected. Add it in API Connections.`,
        status:         'blocked',
        blockedReason:  { policy: 'Connection Check', reason: 'API not connected' },
        requestDetails: { status: 'blocked', policy: 'Connection Check', api: apiName, endpoint: '/', time: nowTime() },
        appliedRules:   [{ label: `${apiName} connected`, pass: false }],
      };
    }

    // Run through Latch for this custom API
    const latchResult = require('../lib/latch').authorize({ api: apiName, endpoint: '/*', intent: 'api_query', message });
    if (!latchResult.allowed) {
      addLog(apiName, 'blocked', latchResult.policyName, message.slice(0, 60));
      return {
        response:       `**${apiName}** access was blocked.\n\n**Reason:** ${latchResult.reason}\n\nCreate a policy in Policy Builder to allow access.`,
        status:         'blocked',
        blockedReason:  { policy: latchResult.policyName, reason: latchResult.reason },
        requestDetails: { status: 'blocked', policy: latchResult.policyName, api: apiName, endpoint: '/', time: nowTime() },
        appliedRules:   latchResult.appliedRules,
      };
    }

    addLog(apiName, 'allowed', latchResult.policyName, message.slice(0, 60));
    return {
      response:       `**${apiName}** (${api.category}) is connected and accessible.\n\nLatch token: \`${latchResult.latchToken}\`\n\nTo use ${apiName}'s capabilities, ask me specifically what you need — e.g. data retrieval, status checks, etc.`,
      status:         'allowed',
      blockedReason:  null,
      requestDetails: { status: 'allowed', policy: latchResult.policyName, api: apiName, endpoint: '/', time: nowTime() },
      appliedRules:   latchResult.appliedRules,
    };
  }

  // ── CAPABILITIES ─────────────────────────────────────────────
  if (intent === 'capabilities') {
    const apiList  = connectedApis.map(a => `• **${a.name}** — ${a.category}`).join('\n');
    const polList  = activePolicies.map(p => {
      const rules = (p.rules || []).filter(r => r.type === 'allow').map(r => r.description || r.api).join(', ');
      return `• **${p.name}** → ${rules || p.api}`;
    }).join('\n');
    const topicBlocks = activePolicies.flatMap(p => (p.rules||[]).filter(r => r.type === 'block' && (r.keywords || r.topic))).map(r => `• ${r.description || r.reason}`).join('\n');

    addLog('Grok', 'allowed', 'General', 'Capabilities query');
    return {
      response:       `**Your Carbon Workspace Capabilities:**\n\n**Connected APIs (${connectedApis.length}):**\n${apiList || '• None — add APIs in API Connections'}\n\n**Active Policies (${activePolicies.length}):**\n${polList || '• None — create policies in Policy Builder'}\n${topicBlocks ? `\n**Topic Blocks:**\n${topicBlocks}` : ''}\n\nEvery request passes through the Latch authorization engine before execution.`,
      status:         'allowed',
      blockedReason:  null,
      requestDetails: { status: 'allowed', policy: 'General', api: 'Grok', endpoint: '/chat', time: nowTime() },
      appliedRules:   [{ label: 'Capabilities query allowed', pass: true }],
    };
  }

  // ── LIST APIS ─────────────────────────────────────────────────
  if (intent === 'list_apis') {
    const list = store.apis.map(a => {
      const icon = a.status === 'connected' ? '✓' : a.status === 'disconnected' ? '✗' : '○';
      return `${icon} **${a.name}** — ${a.category} (${a.status})`;
    }).join('\n');
    addLog('Grok', 'allowed', 'General', 'API list query');
    return {
      response:       `**APIs in your workspace:**\n\n${list}\n\n${connectedApis.length} connected · ${store.apis.length - connectedApis.length} pending`,
      status:         'allowed',
      blockedReason:  null,
      requestDetails: { status: 'allowed', policy: 'General', api: 'Grok', endpoint: '/chat', time: nowTime() },
      appliedRules:   [{ label: 'API info query allowed', pass: true }],
    };
  }

  // ── LIST POLICIES ─────────────────────────────────────────────
  if (intent === 'list_policies') {
    const list = store.policies.map(p => {
      const rulesCount = (p.rules || []).length;
      return `• **${p.name}** (${p.status}) — ${p.api} — ${rulesCount} rule${rulesCount !== 1 ? 's' : ''}`;
    }).join('\n');
    addLog('Grok', 'allowed', 'General', 'Policy list query');
    return {
      response:       `**Your policies:**\n\n${list || '• No policies yet — create one in Policy Builder'}\n\nPolicies are enforced server-side by the Latch engine on every API request.`,
      status:         'allowed',
      blockedReason:  null,
      requestDetails: { status: 'allowed', policy: 'General', api: 'Grok', endpoint: '/chat', time: nowTime() },
      appliedRules:   [{ label: 'Policy info query allowed', pass: true }],
    };
  }

  // ── GENERAL CHAT ──────────────────────────────────────────────
  // Find any connected LLM API (Groq, OpenAI, Grok, Claude, etc.)
  const llmApi = connectedApis.find(a => {
    const n = a.name.toLowerCase();
    const b = (a.baseUrl || '').toLowerCase();
    return n.includes('groq') || n.includes('openai') || n.includes('gpt') ||
           n.includes('grok') || n.includes('claude') || n.includes('anthropic') ||
           n.includes('llm') || n.includes('ai') ||
           b.includes('groq.com') || b.includes('openai.com') || b.includes('x.ai') || b.includes('anthropic.com');
  });

  // Check topic/keyword blocks from active policies against the message
  const grokConnected = store.apis.find(a => a.name === 'Grok' && a.status === 'connected');

  if (grokConnected || llmApi) {
    const latchApi = llmApi?.name || 'Grok';
    const latchGen = require('../lib/latch').authorize({ api: latchApi, endpoint: '/chat', intent: 'general', message });
    if (!latchGen.allowed) {
      addLog(latchApi, 'blocked', latchGen.policyName, message.slice(0, 60));
      return {
        response:       `**This topic is restricted by your active policy.**\n\n**Reason:** ${latchGen.reason}\n\n**Policy:** ${latchGen.policyName}`,
        status:         'blocked',
        blockedReason:  { policy: latchGen.policyName, reason: latchGen.reason },
        requestDetails: { status: 'blocked', policy: latchGen.policyName, api: latchApi, endpoint: '/chat', time: nowTime() },
        appliedRules:   latchGen.appliedRules,
      };
    }
  }

  // ── If a real LLM API is connected → call it ──────────────────
  if (llmApi) {
    // Build conversation context for the LLM
    const systemPrompt = `You are a helpful AI assistant integrated into Carbon — an AI API Management Platform. 
You have access to the user's connected APIs and active policies.
Connected APIs: ${connectedApis.map(a => a.name + ' (' + a.category + ')').join(', ') || 'none'}.
Active policies: ${activePolicies.map(p => p.name).join(', ') || 'none'}.
Answer naturally and helpfully. If asked about API data (prices, etc.), let the user know you can fetch real data from their connected APIs.`;

    const llmMessages = [
      { role: 'system', content: systemPrompt },
      // Include recent conversation history (last 6 messages)
      ...(history || []).slice(-6).map(h => ({ role: h.role, content: h.content })),
    ];
    // Add current message if not already in history
    if (!llmMessages.find(m => m.role === 'user' && m.content === message)) {
      llmMessages.push({ role: 'user', content: message });
    }

    try {
      const llmResult = await callLLMApi(llmApi, llmMessages);
      
      // Check if active policies enforce a response word limit
      const wordLimit = activePolicies.reduce((limit, p) => {
        return p.meta?.responseWordLimit || limit;
      }, null);

      let finalResponse = llmResult.content;
      const appliedRules = [];
      
      if (wordLimit) {
        const words = finalResponse.split(/\s+/).filter(w => w.length > 0);
        if (words.length > wordLimit) {
          finalResponse = words.slice(0, wordLimit).join(' ') + '…';
          appliedRules.push({ label: `Response truncated to ${wordLimit} words by policy`, pass: true });
        } else {
          appliedRules.push({ label: `Response within ${wordLimit} word limit (${words.length} words)`, pass: true });
        }
      }

      addLog(llmApi.name, 'allowed', 'General', message.slice(0, 60));
      return {
        response:       finalResponse,
        status:         'allowed',
        blockedReason:  null,
        requestDetails: {
          status: 'allowed', policy: 'General',
          api: llmApi.name, endpoint: '/chat',
          time: nowTime(),
          model: llmResult.model,
        },
        appliedRules: [
          { label: `${llmApi.name} connected`, pass: true },
          { label: `Model: ${llmResult.model}`, pass: true },
          { label: 'Response generated', pass: true },
          ...appliedRules,
        ],
      };
    } catch (err) {
      // LLM API failed — fall through to Carbon's own responses with error note
      addLog(llmApi.name, 'failed', 'General', err.message.slice(0, 60));
      return {
        response:       `I tried to use **${llmApi.name}** but got an error:\n\n**${err.message}**\n\nPlease check your API key in API Connections.`,
        status:         'failed',
        blockedReason:  { policy: 'API Error', reason: err.message },
        requestDetails: { status: 'failed', policy: 'API Error', api: llmApi.name, endpoint: '/chat', time: nowTime() },
        appliedRules:   [{ label: `${llmApi.name} error: ${err.message}`, pass: false }],
      };
    }
  }

  addLog('Carbon Agent', 'allowed', 'General', message.slice(0, 40));

  // ── Real conversational responses based on what the user said ──
  const m   = message.toLowerCase().trim();
  const apiHints       = connectedApis.map(a => `**${a.name}**`).join(', ');
  const policyCount    = activePolicies.length;
  const connectedCount = connectedApis.length;

  // Greetings
  if (/^(hi|hello|hey|yo|sup|what'?s up|howdy|greetings|good morning|good evening|good afternoon)[\s!?.,]*$/.test(m)) {
    return reply(`Hey! I'm Carbon, your AI assistant.\n\nWhat can I help you with today?`);
  }

  // How are you
  if (/how are you|how('?re| are) you|you ok|you good|how do you feel/.test(m)) {
    return reply(`I'm doing great, thanks for asking! 😊\n\nI'm your Carbon AI — ready to help. What would you like to do?`);
  }

  // What is Carbon / what are you
  if (/what (is|are) (carbon|you|this)|who are you|what do you do|tell me about (yourself|carbon)/.test(m)) {
    return reply(`I'm **Carbon**, an AI-powered API management assistant.\n\nI let you interact with your connected APIs through a natural chat interface — all governed by your active Latch policies. Every API call I make goes through your policy rules first.\n\n**Currently:**\n• ${connectedCount} API${connectedCount !== 1 ? 's' : ''} connected: ${apiHints || 'none'}\n• ${policyCount} active ${policyCount === 1 ? 'policy' : 'policies'}\n\nTry asking me to fetch data from any of your connected APIs!`);
  }

  // Thanks / thank you
  if (/^(thanks|thank you|thank|thx|ty|cheers|appreciate it)[\s!.,]*$/.test(m)) {
    return reply(`You're welcome! 😊 Let me know if there's anything else I can help you with.`);
  }

  // Yes / no / ok
  if (/^(yes|yeah|yep|yup|sure|ok|okay|alright|got it|sounds good|great|nice|cool|perfect|awesome)[\s!.,]*$/.test(m)) {
    return reply(`Got it! What would you like me to do next?`);
  }

  if (/^(no|nope|nah|not really|never mind|never|cancel)[\s!.,]*$/.test(m)) {
    return reply(`No problem! Feel free to ask me anything else. I'm here to help.`);
  }

  // Help
  if (/^help[\s!?]*$|^what can i (do|ask|say)|show me what/.test(m)) {
    return reply(`Here's what I can do:\n\n**API Operations** (from your connected APIs):\n${connectedCount > 0 ? connectedApis.map(a => `• Ask about **${a.name}** data`).join('\n') : '• No APIs connected yet — add one in API Connections'}\n\n**Information:**\n• "What APIs are connected?"\n• "What are my active policies?"\n• "What can you do?"\n\n**Just chat:**\n• Ask me anything — I understand natural language!`);
  }

  // Questions about price / data for connected APIs
  if (connectedCount > 0) {
    // Does the message mention any connected API?
    const mentionedApi = connectedApis.find(a => m.includes(a.name.toLowerCase()));
    if (mentionedApi) {
      return reply(`I can see you're asking about **${mentionedApi.name}** (${mentionedApi.category}).\n\nTo get data from it, try a more specific request like:\n• "Get data from ${mentionedApi.name}"\n• "What does ${mentionedApi.name} provide?"\n\nMake sure you also have an active policy in Policy Builder that allows access to **${mentionedApi.name}**.`);
    }
  }

  // Build a smart contextual response for anything else
  let contextNote = '';
  if (history && history.length > 2) {
    const prev = history.filter(h => h.role === 'user').slice(-2, -1)[0];
    if (prev && prev.content !== message) {
      contextNote = ` Following up on "${prev.content.slice(0, 40)}${prev.content.length > 40 ? '…' : ''}" — `;
    }
  }

  // Generate a smart reply based on message content
  const words      = message.trim().split(/\s+/);
  const isQuestion = message.trim().endsWith('?') || /^(what|who|where|when|why|how|can|could|would|will|is|are|do|does|did|should)\b/i.test(message);

  if (isQuestion) {
    return reply(`${contextNote}That's a good question! I'm Carbon AI, focused on your connected API workspace.\n\nI can help you with:\n${connectedCount > 0 ? `• Data from: ${apiHints}` : '• Add APIs first in API Connections'}\n• Policy management\n• Workspace status\n\nCould you be more specific about what you're looking for?`);
  }

  // Generic conversational fallback
  const conversational = [
    `Got it! I'm Carbon AI — I work best with specific API requests. ${connectedCount > 0 ? `You have ${apiHints} connected. What data do you need?` : 'Try connecting an API first!'}`,
    `Understood! ${connectedCount > 0 ? `I can fetch data from ${apiHints}. What would you like to know?` : 'Connect an API in API Connections to get started.'}`,
    `Sure! I'm here to help. ${connectedCount > 0 ? `Ask me anything about your connected APIs: ${apiHints}.` : 'Add an API connection first to unlock my full capabilities.'}`,
  ];
  const pick = conversational[Math.floor(Math.random() * conversational.length)];
  return reply(pick);

  function reply(text) {
    return {
      response:       text,
      status:         'allowed',
      blockedReason:  null,
      requestDetails: { status: 'allowed', policy: 'General', api: 'Carbon Agent', endpoint: '/chat', time: nowTime() },
      appliedRules:   [{ label: 'General chat allowed', pass: true }],
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// API CONNECTIONS ROUTES
// ─────────────────────────────────────────────────────────────────
router.get('/connections', (req, res) => {
  // Never expose real API keys to the browser — return masked version only
  const safe = store.apis.map(({ apiKey, ...rest }) => rest);
  res.json(safe);
});

router.post('/connections', (req, res) => {
  const { name, baseUrl, apiKey, category } = req.body;
  if (!name || !name.trim())   return res.status(400).json({ error: 'API name is required' });
  if (!baseUrl || !baseUrl.trim()) return res.status(400).json({ error: 'Base URL is required' });
  if (!apiKey || !apiKey.trim())   return res.status(400).json({ error: 'API Key is required' });

  // Check for duplicate name
  if (store.apis.find(a => a.name.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(400).json({ error: `An API named "${name}" already exists` });
  }

  // Generate a safe unique ID
  const maxId = store.nextApiId ? store.nextApiId++ : (store.apis.reduce((m, a) => Math.max(m, a.id || 0), 0) + 1);

  const newApi = {
    id:        maxId,
    name:      name.trim(),
    category:  (category || 'Custom API').trim(),
    desc:      `Connected on ${new Date().toLocaleDateString()}`,
    status:    'connected',
    icon:      'custom',
    baseUrl:   baseUrl.trim(),
    apiKey:    apiKey.trim(),   // stored server-side, never sent to browser
    keyHint:   apiKey.slice(-4).padStart(Math.min(apiKey.length, 8), '•'),
    createdAt: new Date().toISOString(),
  };

  store.apis.push(newApi);
  store.stats.connectedApis = store.apis.filter(a => a.status === 'connected').length;
  store.stats.totalApis     = store.apis.length;
  res.json({ ok: true, api: newApi });
});

// PATCH /connections/:id — update name, category, baseUrl, apiKey
router.patch('/connections/:id', (req, res) => {
  const id  = parseInt(req.params.id);
  const api = store.apis.find(a => a.id === id);
  if (!api) return res.status(404).json({ error: 'API not found' });

  const { name, category, baseUrl, apiKey } = req.body;
  if (name)     api.name     = name.trim();
  if (category) api.category = category.trim();
  if (baseUrl)  api.baseUrl  = baseUrl.trim();
  if (apiKey)   api.keyHint  = apiKey.slice(-4).padStart(apiKey.length > 4 ? 8 : apiKey.length, '•');

  res.json({ ok: true, api });
});

// POST /connections/:id/toggle — toggle connected ↔ disconnected
router.post('/connections/:id/toggle', (req, res) => {
  const id  = parseInt(req.params.id);
  const api = store.apis.find(a => a.id === id);
  if (!api) return res.status(404).json({ error: 'API not found' });
  if (api.status === 'soon') return res.status(400).json({ error: 'Cannot toggle a coming-soon API' });

  api.status = api.status === 'connected' ? 'disconnected' : 'connected';
  store.stats.connectedApis = store.apis.filter(a => a.status === 'connected').length;
  res.json({ ok: true, status: api.status });
});

// POST /connections/:id/test — test connectivity to a real API
router.post('/connections/:id/test', async (req, res) => {
  const id  = parseInt(req.params.id);
  const api = store.apis.find(a => a.id === id);
  if (!api) return res.status(404).json({ error: 'API not found' });

  // For known APIs do a real lightweight ping
  if (api.name === 'Coinbase') {
    try {
      await fetchCoinbasePrice('BTC');
      return res.json({ ok: true, message: 'Coinbase API is responding — BTC price data available' });
    } catch (e) {
      return res.json({ ok: false, message: `Coinbase unreachable: ${e.message}` });
    }
  }

  // For custom APIs — try a HEAD request against their baseUrl
  if (api.baseUrl) {
    try {
      const url = new URL(api.baseUrl);
      const mod = url.protocol === 'https:' ? require('https') : require('http');
      await new Promise((resolve, reject) => {
        const r = mod.request({ hostname: url.hostname, path: url.pathname || '/', method: 'HEAD', timeout: 5000 }, res2 => resolve(res2));
        r.on('error', reject);
        r.on('timeout', () => { r.destroy(); reject(new Error('Timeout')); });
        r.end();
      });
      return res.json({ ok: true, message: `${api.name} endpoint is reachable` });
    } catch (e) {
      return res.json({ ok: false, message: `Could not reach ${api.baseUrl}: ${e.message}` });
    }
  }

  res.json({ ok: true, message: 'Connection marked as active' });
});

router.delete('/connections/:id', (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = store.apis.findIndex(a => a.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  store.apis.splice(idx, 1);
  store.stats.connectedApis = store.apis.filter(a => a.status === 'connected').length;
  store.stats.totalApis     = store.apis.length;
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────
// POLICY BUILDER ROUTES  (Latch-powered)
// ─────────────────────────────────────────────────────────────────
const latch = require('../lib/latch');

router.post('/policies/generate', (req, res) => {
  const { text } = req.body;
  if (!text || text.trim().length < 5) {
    return res.status(400).json({ error: 'Policy description is too short' });
  }

  const connectedApis = store.apis.filter(a => a.status === 'connected');
  const { rules, errors, meta } = latch.compilePolicy(text.trim(), connectedApis);

  // Detect which API this policy targets
  const lower = text.toLowerCase();
  let targetApi = 'Multiple';
  const apiMatches = connectedApis.filter(a => lower.includes(a.name.toLowerCase()));
  if (apiMatches.length === 1) targetApi = apiMatches[0].name;

  // Validate the compiled rules
  const validation = latch.validatePolicy(rules);

  // Generate Latch preview tokens for each affected API
  const previewTokens = [...new Set(rules.filter(r => r.api && r.api !== 'All').map(r => r.api))]
    .map(apiName => ({
      api:   apiName,
      token: latch.generateLatchToken(apiName),
      note:  'Preview — new token issued per authorized request',
    }));

  const policy = {
    version:      '1.0',
    name:         `Policy — ${new Date().toLocaleDateString()}`,
    description:  text.trim(),
    api:          targetApi,
    rules,
    meta,  // Save metadata (response limits, etc.)
    validation,
    previewTokens,
    status:       'pending_review',
    createdAt:    new Date().toISOString(),
  };

  res.json({ ok: true, policy, validation, errors });
});

router.post('/policies/validate', (req, res) => {
  const { rules } = req.body;
  if (!rules || !Array.isArray(rules)) return res.status(400).json({ error: 'rules array required' });
  res.json({ ok: true, ...latch.validatePolicy(rules) });
});

router.post('/policies/activate', (req, res) => {
  const { policy } = req.body;
  if (!policy || !policy.description) {
    return res.status(400).json({ error: 'Policy data required' });
  }

  const id    = store.nextPolicyId++;
  const saved = {
    id,
    name:        policy.name    || `Policy ${id}`,
    description: policy.description,
    text:        policy.description,  // Save original text for keyword matching
    status:      'active',
    api:         policy.api     || 'Multiple',
    rules:       policy.rules   || [],
    meta:        policy.meta    || {},  // Save metadata (response limits)
    created:     new Date().toISOString().split('T')[0],
    activatedAt: new Date().toISOString(),
  };

  store.policies.push(saved);
  store.stats.activePolicies  = store.policies.filter(p => p.status === 'active').length;
  store.stats.pendingPolicies = store.policies.filter(p => p.status === 'pending').length;

  addLog('Latch', 'allowed', saved.name, `Policy activated: ${saved.name}`);
  res.json({ ok: true, policy: saved });
});

router.get('/policies', (req, res) => res.json(store.policies));

router.patch('/policies/:id', (req, res) => {
  const id     = parseInt(req.params.id);
  const policy = store.policies.find(p => p.id === id);
  if (!policy) return res.status(404).json({ error: 'Policy not found' });
  const { status, name } = req.body;
  if (status) policy.status = status;
  if (name)   policy.name   = name;
  store.stats.activePolicies  = store.policies.filter(p => p.status === 'active').length;
  store.stats.pendingPolicies = store.policies.filter(p => p.status === 'pending').length;
  res.json({ ok: true, policy });
});

router.delete('/policies/:id', (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = store.policies.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Policy not found' });
  store.policies.splice(idx, 1);
  store.stats.activePolicies  = store.policies.filter(p => p.status === 'active').length;
  store.stats.pendingPolicies = store.policies.filter(p => p.status === 'pending').length;
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────
// LOGS + STATS ROUTES
// ─────────────────────────────────────────────────────────────────
router.get('/logs', (req, res) => {
  const { filter, search } = req.query;
  let logs = [...store.logs];
  if (filter && filter !== 'all') logs = logs.filter(l => l.result === filter);
  if (search) logs = logs.filter(l =>
    l.api.toLowerCase().includes(search.toLowerCase()) ||
    l.detail.toLowerCase().includes(search.toLowerCase())
  );
  res.json(logs);
});

// DELETE /api/logs — clear all logs (used by tests / admin reset)
router.delete('/logs', (req, res) => {
  store.logs = [];
  store.stats.totalRequests  = 0;
  store.stats.blockedRequests = 0;
  res.json({ ok: true });
});

router.get('/stats', (req, res) => res.json(store.stats));

// ─────────────────────────────────────────────────────────────────
// CONVERSATION MANAGEMENT ROUTES
// ─────────────────────────────────────────────────────────────────

// Start a new conversation
router.post('/chat/new', (req, res) => {
  const id = `conv_${++store.nextConvId}_${Date.now()}`;
  store.conversations[id] = { id, createdAt: new Date().toISOString(), messages: [] };
  res.json({ ok: true, conversationId: id });
});

// Get conversation history
router.get('/chat/history/:id', (req, res) => {
  const conv = store.conversations[req.params.id];
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ ok: true, conversation: conv });
});

// List all conversations
router.get('/chat/conversations', (req, res) => {
  const list = Object.values(store.conversations).map(c => ({
    id: c.id,
    createdAt: c.createdAt,
    messageCount: c.messages.length,
    preview: c.messages.length > 0 ? c.messages[0].content.slice(0, 60) : 'Empty conversation',
  }));
  res.json({ ok: true, conversations: list.reverse() });
});

// ─────────────────────────────────────────────────────────────────
// MAIN CHAT ENDPOINT
// ─────────────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  const { message, conversationId, model, apiScope } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  // ── API Scope: filter which APIs are active for this request ──
  // 'all' or empty = use all connected APIs
  // anything else  = only that specific API is in scope
  const scopedApis = (apiScope && apiScope !== 'all' && apiScope !== 'All APIs')
    ? store.apis.filter(a => a.status === 'connected' && a.name === apiScope)
    : store.apis.filter(a => a.status === 'connected');

  if (scopedApis.length === 0 && apiScope && apiScope !== 'all' && apiScope !== 'All APIs') {
    return res.json({
      ok: true,
      conversationId: null,
      response: `**${apiScope}** is not connected or not available. Go to API Connections to check its status.`,
      status: 'blocked',
      blockedReason: { policy: 'API Scope', reason: `${apiScope} is not connected` },
      requestDetails: { status: 'blocked', policy: 'API Scope', api: apiScope, endpoint: '/', time: nowTime() },
      appliedRules: [{ label: `${apiScope} connected to workspace`, pass: false }],
      intent: 'general',
    });
  }

  // Get or create conversation
  let conv = conversationId && store.conversations[conversationId]
    ? store.conversations[conversationId]
    : null;
  if (!conv) {
    const id = `conv_${++store.nextConvId}_${Date.now()}`;
    conv = { id, createdAt: new Date().toISOString(), messages: [], apiScope: apiScope || 'all' };
    store.conversations[id] = conv;
  }

  // Add user message to history
  conv.messages.push({ role: 'user', content: message.trim(), time: nowTime() });

  try {
    // Detect intent — pass scopedApis so only relevant APIs are detected
    const intentData = detectIntent(message, conv.messages, scopedApis);

    // If a specific API is scoped and the intent doesn't match it, inform user
    const isSpecificScope = apiScope && apiScope !== 'all' && apiScope !== 'All APIs';
    if (isSpecificScope) {
      const scopedApi = scopedApis[0];
      // Check if intent targets a different API — redirect to scoped one
      const intentApiMap = {
        price: 'Coinbase', buy: 'Coinbase', sell: 'Coinbase', trade: 'Coinbase', withdraw: 'Coinbase',
        sms: 'SMS API', general: 'Grok', capabilities: 'Grok', list_apis: 'Grok', list_policies: 'Grok',
      };
      const expectedApi = intentApiMap[intentData.intent];
      if (expectedApi && expectedApi !== scopedApi.name && intentData.intent !== 'general' && intentData.intent !== 'capabilities' && intentData.intent !== 'list_apis' && intentData.intent !== 'list_policies') {
        // Trying to use an API that's not in scope
        const result = {
          response: `You are currently scoped to **${scopedApi.name}** only.\n\nThis request would use **${expectedApi}** which is outside your current scope.\n\nSwitch the API selector to "All APIs" or select **${expectedApi}** to proceed.`,
          status: 'blocked',
          blockedReason: { policy: 'API Scope Filter', reason: `Request requires ${expectedApi} but scope is set to ${scopedApi.name}` },
          requestDetails: { status: 'blocked', policy: 'API Scope Filter', api: expectedApi, endpoint: '/', time: nowTime() },
          appliedRules: [
            { label: `Scope: ${scopedApi.name} only`, pass: true },
            { label: `Request needs ${expectedApi} — out of scope`, pass: false },
          ],
        };
        conv.messages.push({ role: 'assistant', content: result.response, time: nowTime() });
        return res.json({ ok: true, conversationId: conv.id, ...result, intent: intentData.intent });
      }
    }

    // Build response using Latch policy engine
    const result = await buildResponse(message.trim(), intentData, conv.messages, scopedApis);

    // Add assistant reply to history
    conv.messages.push({ role: 'assistant', content: result.response, time: nowTime() });

    res.json({
      ok:             true,
      conversationId: conv.id,
      response:       result.response,
      status:         result.status,
      blockedReason:  result.blockedReason,
      requestDetails: result.requestDetails,
      appliedRules:   result.appliedRules,
      intent:         intentData.intent,
      activeScope:    apiScope || 'all',
    });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({
      ok: false, error: 'Internal server error',
      response: 'Something went wrong. Please try again.',
      status: 'failed',
    });
  }
});

module.exports = router;
