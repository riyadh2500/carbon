/* ============================================
   CARBON — APP LOGIC
   ============================================ */

// ---- DASHBOARD PAGES ----
const pages = {

  overview: () => `
    <div class="page-header">
      <h1>Overview</h1>
      <p>Your AI workspace at a glance</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Connected APIs</div>
        <div class="stat-value">3 <span style="font-size:16px;color:var(--text3)">/ 5</span></div>
        <div class="stat-meta green">2 more available</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Policies</div>
        <div class="stat-value">2</div>
        <div class="stat-meta" style="color:var(--yellow)">1 pending review</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Requests</div>
        <div class="stat-value">1,248</div>
        <div class="stat-meta">Last 24 hours</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Blocked Requests</div>
        <div class="stat-value">23</div>
        <div class="stat-meta">1.8% of total</div>
      </div>
    </div>

    <div class="overview-grid">
      <div class="card">
        <div class="card-header">
          <span class="card-title">API Requests</span>
          <span class="card-meta">Last 24 hours</span>
        </div>
        <div class="chart-area">
          <svg class="chart-svg" viewBox="0 0 600 140" preserveAspectRatio="none">
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#aaff00" stop-opacity="0.25"/>
                <stop offset="100%" stop-color="#aaff00" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <path d="M0,110 C40,105 80,90 120,75 C160,60 200,40 250,50 C300,60 320,30 370,35 C420,40 460,55 500,45 C540,35 570,50 600,40 L600,140 L0,140 Z" fill="url(#chartGrad)"/>
            <path d="M0,110 C40,105 80,90 120,75 C160,60 200,40 250,50 C300,60 320,30 370,35 C420,40 460,55 500,45 C540,35 570,50 600,40" fill="none" stroke="#aaff00" stroke-width="2.5" stroke-linecap="round"/>
            <!-- dots -->
            <circle cx="250" cy="50" r="4" fill="#aaff00"/>
            <circle cx="370" cy="35" r="4" fill="#aaff00"/>
          </svg>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:8px;">
          ${['12 AM','6 AM','12 PM','6 PM'].map(t=>`<span style="font-size:11px;color:var(--text3)">${t}</span>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">Recent Activity</span>
        </div>
        <div class="activity-list">
          ${[
            {type:'allowed',text:'Bitcoin price request allowed',api:'Coinbase API',time:'2 min ago'},
            {type:'blocked',text:'Solana price request blocked',api:'Coinbase API',time:'8 min ago'},
            {type:'blocked',text:'SMS request blocked',api:'SMS API',time:'12 min ago'},
            {type:'allowed',text:'Policy activated',api:'Grok_API',time:'20 min ago'},
          ].map(a=>`
            <div class="activity-item">
              <div class="activity-dot ${a.type}">${a.type==='allowed'?'✓':'✗'}</div>
              <div class="activity-info">
                <p>${a.text}</p>
                <span>${a.api}</span>
              </div>
              <span class="activity-time">${a.time}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="card-header" style="margin-bottom:16px">
      <span class="card-title" style="font-size:16px">Connected APIs</span>
    </div>
    <div class="apis-grid">
      ${[
        {name:'Grok',type:'AI/LLM API',icon:'🤖',status:'connected'},
        {name:'Coinbase',type:'Crypto Price API',icon:'🔵',status:'connected'},
        {name:'SMS API',type:'Messaging API',icon:'💬',status:'connected'},
      ].map(a=>`
        <div class="api-card">
          <div class="api-icon">${a.icon}</div>
          <div class="api-name">${a.name}</div>
          <div class="api-type">${a.type}</div>
          <div class="status-pill connected">Connected</div>
          <button class="btn-sm">Manage</button>
        </div>
      `).join('')}
      <div class="api-card add-card" onclick="navigate('api-connections')">
        <div class="add-icon">+</div>
        <span style="font-size:13px;font-weight:600;">Add API</span>
        <span style="font-size:11px;color:var(--text3)">Connect a new service</span>
      </div>
    </div>
  `,

  'api-connections': () => `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <h1>API Connections</h1>
        <p>Manage your API integrations and credentials</p>
      </div>
      <button class="btn-primary" onclick="showAddApiModal()">+ Add API</button>
    </div>

    <div class="page-toolbar">
      <div class="search-input">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="text" placeholder="Search APIs..." oninput="filterApis(this.value)"/>
      </div>
    </div>

    <div class="tab-row">
      ${['All (3)','Connected (3)','Disconnected (0)','Coming Soon (2)'].map((t,i)=>`
        <button class="tab-btn ${i===0?'active':''}" onclick="switchApiTab(this,'${t}')">${t}</button>
      `).join('')}
    </div>

    <div class="api-list" id="api-list">
      ${[
        {name:'Grok',cat:'AI/LLM API',desc:'Advanced AI model for natural language processing and intelligent responses.',icon:'🤖',status:'connected'},
        {name:'Coinbase',cat:'Crypto Price API',desc:'Get real-time cryptocurrency prices and market data.',icon:'🔵',status:'connected'},
        {name:'SMS API',cat:'Messaging API',desc:'Send and receive SMS messages programmatically.',icon:'💬',status:'connected'},
        {name:'OpenAI',cat:'LLM API',desc:'Will be available soon.',icon:'⭕',status:'soon'},
        {name:'GitHub',cat:'DevTools API',desc:'Will be available soon.',icon:'🐙',status:'soon'},
      ].map(a=>`
        <div class="api-row" data-status="${a.status}">
          <div class="api-row-icon">${a.icon}</div>
          <div class="api-row-info">
            <div class="api-row-cat">${a.cat}</div>
            <div class="api-row-name">${a.name}</div>
            <div class="api-row-desc">${a.desc}</div>
          </div>
          <div class="api-row-actions">
            ${a.status==='connected'
              ? `<div class="status-pill connected">Connected</div><button class="btn-sm" style="width:auto;padding:7px 16px">Manage</button>`
              : `<button class="btn-sm" style="width:auto;padding:7px 16px">Learn more</button>`
            }
          </div>
        </div>
      `).join('')}
    </div>
  `,

  'policy-builder': () => `
    <div class="page-header">
      <h1>Policy Builder</h1>
      <p>Create API policies using natural language</p>
    </div>

    <div class="policy-steps">
      <div class="policy-step active">
        <span class="step-num">1</span> Write Command
      </div>
      <div class="step-divider"></div>
      <div class="policy-step">
        <span class="step-num">2</span> Review & Preview
      </div>
      <div class="step-divider"></div>
      <div class="policy-step">
        <span class="step-num">3</span> Validate
      </div>
      <div class="step-divider"></div>
      <div class="policy-step">
        <span class="step-num">4</span> Confirm & Activate
      </div>
    </div>

    <div class="policy-form">
      <label>Describe your policy in plain language</label>
      <textarea class="policy-textarea" id="policy-input" maxlength="500"
        placeholder="Allow Coinbase API to return Bitcoin price only.&#10;Block all other asset requests. Limit to 10 requests per hour."
        oninput="updateCharCount(this)"></textarea>
      <div class="policy-textarea-footer">
        <span></span>
        <span class="char-count" id="char-count">0/500</span>
      </div>
      <button class="btn-primary" style="margin-top:16px;width:100%;justify-content:center;border-radius:10px" onclick="generatePolicy()">
        Generate Policy →
      </button>
    </div>

    <div class="policy-examples">
      <h4>Example Commands</h4>
      <div class="example-chips">
        ${[
          'Allow Bitcoin price from Coinbase only',
          'Block Solana and other assets',
          'Limit SMS to 5 per day',
          'Allow Grok for general chat',
          'Restrict API to specific endpoints',
        ].map(e=>`<span class="chip" onclick="setPolicy('${e}')">${e}</span>`).join('')}
      </div>
    </div>

    <div id="policy-result" style="display:none;margin-top:24px">
      <div class="card">
        <div class="card-header">
          <span class="card-title">Generated Policy</span>
          <span class="status-pill connected">Ready</span>
        </div>
        <pre id="policy-json" style="font-size:12px;color:var(--green);background:var(--bg3);padding:16px;border-radius:8px;overflow:auto;line-height:1.7"></pre>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button class="btn-outline" style="flex:1">Preview</button>
          <button class="btn-primary" style="flex:1;justify-content:center;border-radius:10px" onclick="activatePolicy()">Activate Policy</button>
        </div>
      </div>
    </div>
  `,

  'ai-playground': () => `
    <div class="page-header">
      <h1>AI Playground</h1>
      <p>Chat with your AI, powered by your APIs and policies</p>
    </div>

    <div class="playground-layout">
      <div class="chat-area">
        <div class="chat-header">
          <div style="display:flex;align-items:center;gap:12px">
            <h2>Chat with your AI</h2>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <select class="select-sm">
              <option>Grok (Default)</option>
              <option>OpenAI GPT-4o</option>
              <option>Anthropic Claude</option>
            </select>
            <select class="select-sm">
              <option>All APIs</option>
              <option>Coinbase only</option>
              <option>SMS only</option>
            </select>
            <span class="system-status">System Online</span>
          </div>
        </div>
        <div class="chat-messages" id="chat-messages">
          <div class="msg user">
            <div class="msg-avatar">AC</div>
            <div>
              <div class="msg-bubble">What is the current price of Bitcoin?</div>
              <div class="msg-time">10:41 AM</div>
            </div>
          </div>
          <div class="msg">
            <div class="msg-avatar">AI</div>
            <div>
              <div class="msg-bubble">
                The current price of Bitcoin is $67,413.15 (BTC).<br/>
                <span style="color:var(--text3);font-size:11px">Source: Coinbase API</span><br/>
                <span style="color:var(--green);font-size:11px">✓ Request was successful and within allowed limits.</span>
              </div>
              <div class="msg-time">10:42 AM</div>
            </div>
          </div>
          <div class="msg user">
            <div class="msg-avatar">AC</div>
            <div>
              <div class="msg-bubble">What is the price of Solana?</div>
              <div class="msg-time">10:44 AM</div>
            </div>
          </div>
          <div class="msg msg-blocked">
            <div class="msg-avatar" style="background:var(--red-bg);color:var(--red)">!</div>
            <div>
              <div class="msg-bubble">
                <div class="blocked-label">🚫 Request Blocked</div>
                <div class="blocked-detail">
                  The request for Solana price is not allowed by the current policy.
                  <span>Policy: Bitcoin price only</span>
                  <span>Reason: Asset not permitted</span>
                </div>
              </div>
              <div class="msg-time">10:44 AM</div>
            </div>
          </div>
        </div>
        <div class="chat-input-row">
          <input class="chat-input" type="text" placeholder="Type your message..." id="chat-input" onkeypress="handleChatKey(event)"/>
          <button class="send-btn" onclick="sendChat()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/></svg>
          </button>
        </div>
      </div>

      <div class="request-panel">
        <div class="rp-card">
          <div class="rp-title">Request Details</div>
          <div class="rp-row"><span class="rp-label">Status</span><span class="rp-value blocked">Blocked</span></div>
          <div class="rp-row"><span class="rp-label">Policy</span><span class="rp-value">Coinbase - Bitcoin only</span></div>
          <div class="rp-row"><span class="rp-label">API</span><span class="rp-value">Coinbase</span></div>
          <div class="rp-row"><span class="rp-label">Endpoint</span><span class="rp-value">/assets/price</span></div>
          <div class="rp-row"><span class="rp-label">Time</span><span class="rp-value">10:44 AM</span></div>
        </div>
        <div class="rp-card">
          <div class="rp-title">Applied Rules</div>
          <div class="rules-list">
            <div class="rule-item pass"><span class="rule-icon">✓</span> API allowed</div>
            <div class="rule-item pass"><span class="rule-icon">✓</span> Endpoint allowed</div>
            <div class="rule-item fail"><span class="rule-icon">✗</span> Asset not permitted</div>
          </div>
        </div>
      </div>
    </div>
  `,

  /* REMOVED: Security page - moved to Request Logs with tabs
  'security': () => `
    ...
  `,
  */

  'request-logs': () => `
    <div class="page-header">
      <h1>Security & Limits</h1>
      <p>Monitor requests, limits and security events</p>
    </div>

    <div class="logs-grid">
      <div class="logs-main">
        <div class="log-tabs">
          <div class="tab-row">
            ${['Request Logs','Limits','Security'].map((t,i)=>`
              <button class="tab-btn ${i===0?'active':''}" onclick="switchLogTab(this)">${t}</button>
            `).join('')}
          </div>
        </div>

        <div class="filter-row">
          ${['All','Allowed','Blocked'].map((f,i)=>`
            <button class="tab-btn ${i===0?'active':''}" style="font-size:12px;padding:5px 12px" onclick="filterLogs(this,'${f.toLowerCase()}')">${f}</button>
          `).join('')}
          <div style="flex:1"></div>
          <select class="filter-select">
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>Last 90 days</option>
          </select>
        </div>

        <div class="card" style="padding:0;overflow:hidden">
          <div class="log-table-header">
            <span>Time</span>
            <span>API</span>
            <span>Result</span>
            <span>Policy</span>
            <span>Details</span>
          </div>
          <div id="log-rows">
            ${[
              {time:'10:45 AM',api:'Coinbase',result:'Blocked',policy:'Bitcoin only',detail:'Solana asset'},
              {time:'10:43 AM',api:'Coinbase',result:'Allowed',policy:'Bitcoin only',detail:'BTC price'},
              {time:'10:39 AM',api:'Grok',result:'Allowed',policy:'General',detail:'Chat request'},
              {time:'10:32 AM',api:'SMS',result:'Blocked',policy:'SMS limit',detail:'5/5 limit'},
              {time:'10:28 AM',api:'Coinbase',result:'Allowed',policy:'Bitcoin only',detail:'BTC price'},
              {time:'10:21 AM',api:'Grok',result:'Allowed',policy:'General',detail:'Chat request'},
              {time:'10:18 AM',api:'Coinbase',result:'Blocked',policy:'Bitcoin only',detail:'ETH asset'},
              {time:'10:12 AM',api:'SMS',result:'Blocked',policy:'SMS limit',detail:'5/5 limit'},
              {time:'10:05 AM',api:'Coinbase',result:'Allowed',policy:'Bitcoin only',detail:'BTC price'},
            ].map(r=>`
              <div class="log-row" data-result="${r.result.toLowerCase()}">
                <span>${r.time}</span>
                <span>${r.api}</span>
                <span><span class="result-badge ${r.result.toLowerCase()}">${r.result}</span></span>
                <span>${r.policy}</span>
                <span style="color:var(--text3)">${r.detail}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `,

  /* SECURITY PAGE REMOVED - functionality moved to Request Logs with tabs */

  'request-logs': () => `
    <div class="page-header">
      <h1>Request Logs & API Limits</h1>
      <p>Monitor all API requests, applied policies, and rate limits</p>
    </div>

    <div class="logs-grid">
      <div class="logs-main">
        <div class="log-tabs">
          <div class="tab-row">
            ${['Request Logs','API Limits','Policy Stats'].map((t,i)=>`
              <button class="tab-btn ${i===0?'active':''}" onclick="switchLogTab(this)">${t}</button>
            `).join('')}
          </div>
        </div>

        <!-- TAB 1: Request Logs -->
        <div class="tab-content" id="tab-request-logs" style="display:block">
          <div class="filter-row">
            ${['All','Allowed','Blocked','Failed'].map((f,i)=>`
              <button class="tab-btn ${i===0?'active':''}" style="font-size:12px;padding:5px 12px" onclick="filterLogs(this,'${f.toLowerCase()}')">${f}</button>
            `).join('')}
            <div style="flex:1"></div>
            <button class="btn-secondary btn-sm" onclick="refreshLogs()">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Refresh
            </button>
          </div>

          <div class="card" style="padding:0;overflow:hidden">
            <div class="log-table-header">
              <span style="width:80px">Time</span>
              <span style="width:120px">API</span>
              <span style="width:90px">Result</span>
              <span style="width:140px">Policy</span>
              <span style="flex:1">Details</span>
            </div>
            <div id="log-rows">
              <!-- Logs will be dynamically loaded here -->
              <div style="padding:40px;text-align:center;color:var(--text3)">
                Loading logs...
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: API Limits -->
        <div class="tab-content" id="tab-api-limits" style="display:none">
          <div class="card">
            <h3 style="margin-bottom:16px">Active API Rate Limits</h3>
            <div id="api-limits-container">
              <!-- API limits will be dynamically loaded -->
              <div style="padding:20px;text-align:center;color:var(--text3)">
                Loading API limits...
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 3: Policy Stats -->
        <div class="tab-content" id="tab-policy-stats" style="display:none">
          <div class="card">
            <h3 style="margin-bottom:16px">Policy Usage Statistics</h3>
            <div id="policy-stats-container">
              <!-- Policy stats will be dynamically loaded -->
              <div style="padding:20px;text-align:center;color:var(--text3)">
                Loading policy statistics...
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,

  settings: () => `
    <div class="page-header">
      <h1>Settings</h1>
      <p>Manage your account and preferences</p>
    </div>
    <div class="settings-grid">
      <div class="settings-sidebar">
        <div class="settings-nav">
          ${['Profile','API Keys','Billing'].map((s,i)=>`
            <div class="s-nav-item ${i===0?'active':''}" onclick="switchSettingsNav(this)">${s}</div>
          `).join('')}
        </div>
      </div>
      <div class="settings-content">
        <div class="settings-section">
          <h3>Profile Settings</h3>
          <p class="section-desc">Update your personal information</p>
          <div class="form-row-inline">
            <div class="form-row" style="margin-bottom:0">
              <label class="form-label">First Name</label>
              <input class="form-input" value="Alex" type="text"/>
            </div>
            <div class="form-row" style="margin-bottom:0">
              <label class="form-label">Last Name</label>
              <input class="form-input" value="Carter" type="text"/>
            </div>
          </div>
          <div class="form-row" style="margin-top:16px">
            <label class="form-label">Email</label>
            <input class="form-input" value="alex@carbon.dev" type="email"/>
          </div>
          <div class="form-row">
            <label class="form-label">Company</label>
            <input class="form-input" value="Carbon Inc." type="text"/>
          </div>
          <button class="btn-primary" style="margin-top:8px">Save Changes</button>
        </div>

        <div class="settings-section">
          <h3>API Keys</h3>
          <p class="section-desc">Manage your API access keys</p>
          <div style="padding:20px;text-align:center;color:var(--text3)">
            API Keys management coming soon
          </div>
        </div>

        <div class="settings-section">
          <h3>Billing & Usage</h3>
          <p class="section-desc">View your subscription and usage details</p>
          <div style="padding:20px;text-align:center;color:var(--text3)">
            Billing dashboard coming soon
          </div>
        </div>
      </div>
    </div>
  `,
};

// ---- NAVIGATION ----
function navigate(page) {
  const content = document.getElementById('page-content');
  if (!content) return;

  // Update sidebar active state
  document.querySelectorAll('.sb-link').forEach(l => {
    l.classList.toggle('active', l.dataset.page === page);
  });

  content.innerHTML = pages[page] ? pages[page]() : `<div class="page-header"><h1>Page not found</h1></div>`;
  content.scrollTop = 0;
}

// ---- INIT DASHBOARD ----
function initDashboard() {
  const links = document.querySelectorAll('.sb-link');
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(link.dataset.page);
    });
  });
  navigate('overview');
}

// ---- POLICY BUILDER ----
function updateCharCount(el) {
  const count = document.getElementById('char-count');
  if (count) count.textContent = `${el.value.length}/500`;
}

function setPolicy(text) {
  const ta = document.getElementById('policy-input');
  if (!ta) return;
  ta.value = text;
  updateCharCount(ta);
}

function generatePolicy() {
  const ta = document.getElementById('policy-input');
  const result = document.getElementById('policy-result');
  const json = document.getElementById('policy-json');
  if (!ta || !result || !json) return;

  const text = ta.value || 'Allow Coinbase API to return Bitcoin price only. Block all other asset requests. Limit to 10 requests per hour.';

  const policy = {
    version: "1.0",
    name: "Auto-generated Policy",
    description: text,
    rules: [
      { type: "allow", api: "Coinbase", endpoint: "/prices/BTC", rateLimit: "10/hour" },
      { type: "block", api: "Coinbase", endpoint: "/prices/*", except: ["BTC"] },
      { type: "block", api: "*", reason: "Not in allowed list" }
    ],
    created: new Date().toISOString()
  };

  result.style.display = 'block';
  json.textContent = JSON.stringify(policy, null, 2);

  // Advance step indicator
  document.querySelectorAll('.policy-step').forEach((s, i) => {
    if (i === 0) { s.classList.remove('active'); s.classList.add('done'); }
    if (i === 1) { s.classList.add('active'); }
  });
}

function activatePolicy() {
  alert('Policy activated successfully! ✓');
}

// ---- CHAT ----
function sendChat() {
  const input = document.getElementById('chat-input');
  const messages = document.getElementById('chat-messages');
  if (!input || !messages || !input.value.trim()) return;

  const text = input.value.trim();
  input.value = '';

  // User message
  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.innerHTML = `
    <div class="msg-avatar">AC</div>
    <div>
      <div class="msg-bubble">${escapeHtml(text)}</div>
      <div class="msg-time">${getTime()}</div>
    </div>`;
  messages.appendChild(userMsg);

  // Simulate AI response
  setTimeout(() => {
    const lower = text.toLowerCase();
    let response;

    if (lower.includes('bitcoin') || lower.includes('btc')) {
      response = `<div class="msg-bubble">The current price of Bitcoin is $67,413.15 (BTC).<br/><span style="color:var(--green);font-size:11px">✓ Request successful and within policy limits.</span></div>`;
    } else if (lower.includes('solana') || lower.includes('sol') || lower.includes('eth') || lower.includes('ethereum')) {
      response = `<div class="msg-bubble"><div class="blocked-label">🚫 Request Blocked</div><div class="blocked-detail">This asset is not allowed by the current policy.<span>Policy: Bitcoin price only</span><span>Reason: Asset not permitted</span></div></div>`;
    } else {
      response = `<div class="msg-bubble">I'm your AI assistant powered by Grok. How can I help you today?<br/><span style="color:var(--green);font-size:11px">✓ Request successful.</span></div>`;
    }

    const aiMsg = document.createElement('div');
    aiMsg.className = 'msg';
    aiMsg.innerHTML = `
      <div class="msg-avatar">AI</div>
      <div>${response}<div class="msg-time">${getTime()}</div></div>`;
    messages.appendChild(aiMsg);
    messages.scrollTop = messages.scrollHeight;
  }, 600);

  messages.scrollTop = messages.scrollHeight;
}

function handleChatKey(e) {
  if (e.key === 'Enter') sendChat();
}

// ---- TABS / FILTERS ----
function switchApiTab(btn, filter) {
  btn.closest('.tab-row').querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function filterApis(val) {
  document.querySelectorAll('.api-row').forEach(row => {
    const name = row.querySelector('.api-row-name')?.textContent.toLowerCase() || '';
    row.style.display = name.includes(val.toLowerCase()) ? '' : 'none';
  });
}

function switchLogTab(btn) {
  btn.closest('.tab-row').querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function filterLogs(btn, filter) {
  btn.closest('.filter-row').querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.log-row').forEach(row => {
    if (filter === 'all') { row.style.display = ''; return; }
    row.style.display = row.dataset.result === filter ? '' : 'none';
  });
}

function switchSettingsNav(el) {
  el.closest('.settings-nav').querySelectorAll('.s-nav-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
}

// ---- TOGGLE SWITCH ----
function toggleSwitch(el) {
  el.classList.toggle('on');
}

// ---- ADD API MODAL ----
function showAddApiModal() {
  const modal = document.createElement('div');
  modal.id = 'add-api-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:200;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:16px;padding:28px;width:440px;max-width:90vw;">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:20px">Add New API</h2>
      <div class="form-row">
        <label class="form-label">API Name</label>
        <input class="form-input" placeholder="e.g. OpenWeather API" type="text"/>
      </div>
      <div class="form-row">
        <label class="form-label">Base URL</label>
        <input class="form-input" placeholder="https://api.example.com" type="url"/>
      </div>
      <div class="form-row">
        <label class="form-label">API Key</label>
        <input class="form-input" placeholder="sk-..." type="password"/>
      </div>
      <div style="display:flex;gap:12px;margin-top:24px">
        <button class="btn-outline" style="flex:1" onclick="document.getElementById('add-api-modal').remove()">Cancel</button>
        <button class="btn-primary" style="flex:1;justify-content:center;border-radius:10px" onclick="document.getElementById('add-api-modal').remove();alert('API connected successfully! ✓')">Connect API</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ---- UTILS ----
function getTime() {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')} ${d.getHours()>=12?'PM':'AM'}`;
}

function escapeHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---- BOOT ----
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('dash-main')) {
    initDashboard();
  }
});
