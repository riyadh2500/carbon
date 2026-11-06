/* ═══════════════════════════════════════════════════════════════
   CARBON — DASHBOARD JS
═══════════════════════════════════════════════════════════════ */

// ── Toast notification ─────────────────────────────────────
function showToast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type}`;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 3200);
}

// ── API Tab filtering ──────────────────────────────────────
function initApiTabs() {
  const tabs = document.getElementById('api-tabs');
  const list = document.getElementById('api-list');
  if (!tabs || !list) return;

  tabs.querySelectorAll('.tab-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('tab-active'));
      btn.classList.add('tab-active');
      const f = btn.dataset.filter;
      list.querySelectorAll('.api-row').forEach(row => {
        const st = row.dataset.status;
        if (f === 'all') { row.style.display = ''; return; }
        if (f === 'connected' && st === 'connected') { row.style.display = ''; return; }
        if (f === 'disconnected' && st === 'disconnected') { row.style.display = ''; return; }
        if (f === 'soon' && st === 'soon') { row.style.display = ''; return; }
        row.style.display = 'none';
      });
    });
  });

  // Search filter
  const search = document.getElementById('api-search');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      list.querySelectorAll('.api-row').forEach(row => {
        const name = (row.dataset.name || '').toLowerCase();
        row.style.display = name.includes(q) ? '' : 'none';
      });
    });
  }
}

// ── Add API Modal ──────────────────────────────────────────
function initAddApiModal() {
  const btn      = document.getElementById('add-api-btn');
  const overlay  = document.getElementById('add-api-overlay');
  const closeBtn = document.getElementById('close-add-api');
  const cancelBtn= document.getElementById('cancel-add-api');
  const confirmBtn=document.getElementById('confirm-add-api');
  if (!btn || !overlay) return;

  const open = () => {
    overlay.style.display = 'flex';
    document.getElementById('new-api-name').focus();
  };
  const close = () => {
    overlay.style.display = 'none';
    ['new-api-name','new-api-url','new-api-key','new-api-cat'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    ['err-name','err-url','err-key'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '';
    });
  };

  btn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Enter key on last field submits
  document.getElementById('new-api-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmBtn.click();
  });

  confirmBtn.addEventListener('click', async () => {
    const name = document.getElementById('new-api-name').value.trim();
    const url  = document.getElementById('new-api-url').value.trim();
    const key  = document.getElementById('new-api-key').value.trim();
    const cat  = document.getElementById('new-api-cat').value.trim();

    let valid = true;
    const errName = document.getElementById('err-name');
    const errUrl  = document.getElementById('err-url');
    const errKey  = document.getElementById('err-key');

    if (!name) { errName.textContent = 'Name is required'; valid = false; }
    else errName.textContent = '';
    if (!url)  { errUrl.textContent  = 'Base URL is required'; valid = false; }
    else errUrl.textContent = '';
    if (!key)  { errKey.textContent  = 'API Key is required'; valid = false; }
    else errKey.textContent = '';
    if (!valid) return;

    // Basic URL validation
    try { new URL(url); } catch {
      errUrl.textContent = 'Enter a valid URL (e.g. https://api.example.com)';
      return;
    }

    confirmBtn.textContent = 'Connecting…';
    confirmBtn.disabled = true;

    try {
      const res  = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, baseUrl: url, apiKey: key, category: cat || 'Custom API' }),
      });
      const data = await res.json();
      if (data.ok) {
        close();
        showToast(`✓ ${name} connected successfully!`, 'ok');
        setTimeout(() => location.reload(), 1000);
      } else {
        // Show specific server error inline
        if (data.error && data.error.toLowerCase().includes('name')) {
          errName.textContent = data.error;
        } else {
          showToast(data.error || 'Connection failed', 'err');
        }
      }
    } catch {
      showToast('Network error — please try again', 'err');
    } finally {
      confirmBtn.textContent = 'Connect API';
      confirmBtn.disabled = false;
    }
  });
}

// ── Manage API Modal ───────────────────────────────────────
function initManageApiModal() {
  const overlay       = document.getElementById('manage-api-overlay');
  const closeBtn      = document.getElementById('close-manage-api');
  const nameLabel     = document.getElementById('manage-api-name');
  const catLabel      = document.getElementById('manage-api-cat');
  const urlLabel      = document.getElementById('manage-api-url');
  const statusBadge   = document.getElementById('manage-api-status-badge');
  const testBtn       = document.getElementById('test-api-btn');
  const editBtn       = document.getElementById('edit-api-btn');
  const toggleBtn     = document.getElementById('toggle-api-btn');
  const toggleLabel   = document.getElementById('toggle-api-label');
  const removeBtn     = document.getElementById('disconnect-api-btn');
  const resultEl      = document.getElementById('manage-result');
  const editPanel     = document.getElementById('edit-creds-panel');
  const confirmPanel  = document.getElementById('confirm-remove-panel');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  const saveEditBtn   = document.getElementById('save-edit-btn');
  const cancelRemBtn  = document.getElementById('cancel-remove-btn');
  const confirmRemBtn = document.getElementById('confirm-remove-btn');
  const confirmRemNm  = document.getElementById('confirm-remove-name');
  if (!overlay) return;

  let currentId     = null;
  let currentStatus = null;

  function resetModal() {
    if (editPanel)    editPanel.style.display    = 'none';
    if (confirmPanel) confirmPanel.style.display = 'none';
    if (resultEl)     resultEl.style.display     = 'none';
    if (testBtn)      testBtn.textContent = '↗ Test Connection';
    if (testBtn) {
      testBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#aaff00" stroke-width="2" stroke-linecap="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/></svg> Test Connection';
    }
  }

  function openModal(id, name, status, cat, url) {
    currentId     = id;
    currentStatus = status;
    if (nameLabel)   nameLabel.textContent = name;
    if (catLabel)    catLabel.textContent  = cat  || '';
    if (urlLabel)    urlLabel.textContent  = url  || '';

    if (statusBadge) {
      if (status === 'connected') {
        statusBadge.className = 'status-pill s-connected';
        statusBadge.innerHTML = '<span></span>Connected';
      } else {
        statusBadge.className = 'status-pill s-disconnected';
        statusBadge.innerHTML = '<span></span>Disconnected';
      }
    }

    if (toggleLabel) {
      toggleLabel.textContent = status === 'connected' ? 'Disconnect API' : 'Reconnect API';
    }
    if (toggleBtn) {
      toggleBtn.style.color = status === 'connected' ? '' : 'var(--c-green)';
    }

    // Pre-fill edit form
    const nameInput = document.getElementById('edit-api-name-input');
    const catInput  = document.getElementById('edit-api-cat-input');
    const urlInput  = document.getElementById('edit-api-url-input');
    const keyInput  = document.getElementById('edit-api-key-input');
    if (nameInput) nameInput.value = name;
    if (catInput)  catInput.value  = cat || '';
    if (urlInput)  urlInput.value  = url || '';
    if (keyInput)  keyInput.value  = '';

    resetModal();
    overlay.style.display = 'flex';
  }

  // Wire manage buttons (use event delegation for dynamically added rows)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.btn-manage');
    if (!btn) return;
    const row = btn.closest('.api-row');
    if (!row) return;
    openModal(
      btn.dataset.id,
      btn.dataset.name,
      row.dataset.status,
      row.dataset.cat,
      row.dataset.url
    );
  });

  function closeModal() { overlay.style.display = 'none'; resetModal(); }
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  // ── Test connection ──────────────────────────────────────────
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.innerHTML = '<div class="spin" style="width:14px;height:14px;border:2px solid rgba(170,255,0,.3);border-top-color:#aaff00;border-radius:50%;animation:spin .7s linear infinite;display:inline-block;margin-right:6px"></div> Testing…';
      if (resultEl) resultEl.style.display = 'none';

      try {
        const res  = await fetch(`/api/connections/${currentId}/test`, { method: 'POST' });
        const data = await res.json();
        if (resultEl) {
          resultEl.style.display = 'flex';
          resultEl.style.color   = data.ok ? 'var(--c-green)' : 'var(--c-red)';
          resultEl.style.borderColor = data.ok ? 'rgba(170,255,0,.25)' : 'rgba(255,68,68,.25)';
          resultEl.style.background  = data.ok ? 'var(--c-green-dim)' : 'rgba(255,68,68,.08)';
          resultEl.textContent = (data.ok ? '✓ ' : '✗ ') + data.message;
        }
      } catch {
        if (resultEl) { resultEl.style.display='flex'; resultEl.textContent='✗ Network error'; }
      } finally {
        testBtn.disabled = false;
        testBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#aaff00" stroke-width="2" stroke-linecap="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/></svg> Test Connection';
      }
    });
  }

  // ── Edit credentials toggle ──────────────────────────────────
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      const open = editPanel.style.display !== 'none';
      editPanel.style.display     = open ? 'none' : 'block';
      if (confirmPanel) confirmPanel.style.display = 'none';
    });
  }
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', () => { editPanel.style.display = 'none'; });
  }
  if (saveEditBtn) {
    saveEditBtn.addEventListener('click', async () => {
      const name = document.getElementById('edit-api-name-input').value.trim();
      const cat  = document.getElementById('edit-api-cat-input').value.trim();
      const url  = document.getElementById('edit-api-url-input').value.trim();
      const key  = document.getElementById('edit-api-key-input').value.trim();
      if (!name) { showToast('API name is required', 'err'); return; }

      saveEditBtn.textContent = 'Saving…';
      saveEditBtn.disabled = true;
      try {
        const body = { name, category: cat, baseUrl: url };
        if (key) body.apiKey = key;
        const res  = await fetch(`/api/connections/${currentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.ok) {
          showToast('✓ API updated', 'ok');
          editPanel.style.display = 'none';
          setTimeout(() => location.reload(), 900);
        } else {
          showToast(data.error || 'Update failed', 'err');
        }
      } catch { showToast('Network error', 'err'); }
      finally {
        saveEditBtn.textContent = 'Save Changes';
        saveEditBtn.disabled = false;
      }
    });
  }

  // ── Toggle connected / disconnected ─────────────────────────
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      toggleBtn.disabled = true;
      try {
        const res  = await fetch(`/api/connections/${currentId}/toggle`, { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          const newStatus = data.status;
          showToast(newStatus === 'connected' ? '✓ API reconnected' : 'API disconnected', 'ok');
          closeModal();
          setTimeout(() => location.reload(), 900);
        } else {
          showToast(data.error || 'Toggle failed', 'err');
        }
      } catch { showToast('Network error', 'err'); }
      finally { toggleBtn.disabled = false; }
    });
  }

  // ── Remove / delete ──────────────────────────────────────────
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      if (confirmRemNm) confirmRemNm.textContent = nameLabel.textContent;
      if (confirmPanel) confirmPanel.style.display = 'block';
      if (editPanel)    editPanel.style.display    = 'none';
    });
  }
  if (cancelRemBtn) {
    cancelRemBtn.addEventListener('click', () => { confirmPanel.style.display = 'none'; });
  }
  if (confirmRemBtn) {
    confirmRemBtn.addEventListener('click', async () => {
      confirmRemBtn.textContent = 'Removing…';
      confirmRemBtn.disabled    = true;
      try {
        const res  = await fetch(`/api/connections/${currentId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.ok) {
          closeModal();
          showToast('API removed', 'ok');
          setTimeout(() => location.reload(), 900);
        } else {
          showToast(data.error || 'Remove failed', 'err');
        }
      } catch { showToast('Network error', 'err'); }
      finally {
        confirmRemBtn.textContent = 'Remove';
        confirmRemBtn.disabled    = false;
      }
    });
  }
}

// ── Policy Builder (Latch-powered) ─────────────────────────
function initPolicyBuilder() {
  const textarea       = document.getElementById('policy-input');
  const charCt         = document.getElementById('char-ct');
  const genBtn         = document.getElementById('gen-policy-btn');
  const resultPanel    = document.getElementById('policy-result-panel');
  const jsonOut        = document.getElementById('policy-json-out');
  const previewBtn     = document.getElementById('preview-policy-btn');
  const activateBtn    = document.getElementById('activate-policy-btn');
  const confirmOverlay = document.getElementById('policy-confirm-overlay');
  const cancelActivate = document.getElementById('cancel-activate-btn');
  const confirmActivate= document.getElementById('confirm-activate-btn');
  const modalPolicyText= document.getElementById('modal-policy-text');
  const successBanner  = document.getElementById('policy-success-banner');
  const errEl          = document.getElementById('policy-error');
  const nameInput      = document.getElementById('policy-name-input');
  const rulesPreview   = document.getElementById('rules-preview-list');
  const validationEl   = document.getElementById('validation-result');
  const latchTokensEl  = document.getElementById('latch-tokens-preview');
  const latchListEl    = document.getElementById('latch-tokens-list');
  const validityBadge  = document.getElementById('policy-validity-badge');
  if (!textarea) return;

  let generatedPolicy = null;

  // ── Step indicator helper ────────────────────────────────────
  function setStep(n) {
    document.querySelectorAll('.step').forEach((s, i) => {
      s.classList.remove('step-active', 'step-done');
      if (i + 1 < n)  s.classList.add('step-done');
      if (i + 1 === n) s.classList.add('step-active');
    });
  }

  // ── Char counter ─────────────────────────────────────────────
  textarea.addEventListener('input', () => {
    charCt.textContent = `${textarea.value.length}/500`;
  });

  // ── Chip fill ────────────────────────────────────────────────
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      textarea.value = chip.dataset.text;
      charCt.textContent = `${textarea.value.length}/500`;
      textarea.focus();
    });
  });

  // ── Render rules as readable cards ───────────────────────────
  function renderRules(rules) {
    if (!rulesPreview || !rules) return;
    const typeColors = { allow: 'var(--c-green)', block: 'var(--c-red)', rateLimit: '#ffcc00' };
    const typeIcons  = {
      allow:     '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
      block:     '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      rateLimit: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    };
    rulesPreview.innerHTML = rules.map(r => `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-radius:8px;background:var(--bg3);border:1px solid var(--bd2);margin-bottom:8px">
        <span style="color:${typeColors[r.type]||'var(--txt2)'};flex-shrink:0;margin-top:1px">${typeIcons[r.type]||''}</span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${typeColors[r.type]||'var(--txt3)'}">${r.type}</span>
            <span style="font-size:12px;font-weight:600;color:var(--txt)">${r.api || 'All'}</span>
            ${r.endpoint ? `<span style="font-size:11px;font-family:monospace;color:var(--txt3)">${r.endpoint}</span>` : ''}
            ${r.rateLimit ? `<span style="font-size:10px;background:rgba(255,204,0,.1);color:#ffcc00;padding:2px 7px;border-radius:100px">${r.rateLimit}</span>` : ''}
            ${r.limit     ? `<span style="font-size:10px;background:rgba(255,204,0,.1);color:#ffcc00;padding:2px 7px;border-radius:100px">${r.limit}</span>` : ''}
          </div>
          <div style="font-size:11px;color:var(--txt3);margin-top:3px">${r.description || r.reason || ''}</div>
        </div>
      </div>`).join('');
  }

  // ── Render Latch token preview ───────────────────────────────
  function renderLatchTokens(tokens) {
    if (!latchTokensEl || !latchListEl || !tokens || tokens.length === 0) return;
    latchTokensEl.style.display = 'block';
    latchListEl.innerHTML = tokens.map(t => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg3);border:1px solid rgba(170,255,0,.12);border-radius:8px;margin-bottom:6px;font-size:12px">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#aaff00" stroke-width="2.5" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        <span style="font-weight:600;color:var(--txt);flex:1">${t.api}</span>
        <code style="font-family:monospace;color:#aaff00;background:rgba(170,255,0,.08);padding:2px 8px;border-radius:4px">${t.token}</code>
      </div>`).join('');
  }

  // ── Render validation ─────────────────────────────────────────
  function renderValidation(v) {
    if (!validationEl || !v) return;
    const scoreColor = { strong: 'var(--c-green)', moderate: '#ffcc00', weak: 'var(--c-red)' };
    let html = `<div style="padding:12px 14px;border-radius:8px;border:1px solid ${v.valid ? 'rgba(170,255,0,.25)' : 'rgba(255,68,68,.25)'};background:${v.valid ? 'var(--c-green-dim)' : 'rgba(255,68,68,.07)'}">`;
    html += `<div style="font-size:12px;font-weight:700;color:${scoreColor[v.score]||'var(--txt)'};margin-bottom:8px">
      ${v.valid ? '✓' : '✗'} Policy score: <span style="text-transform:capitalize">${v.score}</span>
    </div>`;
    if (v.issues.length > 0) {
      html += v.issues.map(i => `<div style="font-size:12px;color:var(--c-red);margin-bottom:4px">✗ ${i}</div>`).join('');
    }
    if (v.warnings.length > 0) {
      html += v.warnings.map(w => `<div style="font-size:12px;color:#ffcc00;margin-bottom:4px">⚠ ${w}</div>`).join('');
    }
    if (v.valid && v.warnings.length === 0) {
      html += `<div style="font-size:12px;color:var(--c-green)">All rules are valid and conflict-free</div>`;
    }
    html += '</div>';
    validationEl.innerHTML = html;
    validationEl.style.display = 'block';

    // Update validity badge
    if (validityBadge) {
      if (v.score === 'strong') {
        validityBadge.className = 'status-pill s-connected';
        validityBadge.innerHTML = '<span></span>Valid';
      } else if (v.score === 'moderate') {
        validityBadge.className = 'status-pill';
        validityBadge.style.cssText = 'background:rgba(255,204,0,.1);color:#ffcc00';
        validityBadge.innerHTML = '<span style="background:#ffcc00"></span>Warnings';
      } else {
        validityBadge.className = 'status-pill s-disconnected';
        validityBadge.innerHTML = '<span></span>Issues';
      }
    }

    // Advance to step 3
    setStep(3);
  }

  // ── GENERATE ─────────────────────────────────────────────────
  genBtn.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (text.length < 5) { errEl.textContent = 'Please describe your policy in more detail.'; return; }
    errEl.textContent = '';
    genBtn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px"><div class="spin" style="width:14px;height:14px;border:2px solid rgba(10,10,10,.3);border-top-color:#0a0a0a;border-radius:50%;animation:spin .7s linear infinite"></div>Generating…</span>';
    genBtn.disabled = true;

    try {
      const res  = await fetch('/api/policies/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();

      if (data.ok) {
        generatedPolicy = data.policy;
        if (nameInput) nameInput.value = data.policy.name || '';
        if (jsonOut)   jsonOut.textContent = JSON.stringify(data.policy, null, 2);

        // Render readable rules
        renderRules(data.policy.rules);

        // Show Latch token preview
        renderLatchTokens(data.policy.previewTokens);

        // Show validation inline
        if (data.validation) renderValidation(data.validation);

        resultPanel.style.display = 'block';
        resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setStep(2);
      } else {
        errEl.textContent = data.error || 'Generation failed';
      }
    } catch {
      errEl.textContent = 'Network error — please try again';
    } finally {
      genBtn.textContent = 'Generate Policy →';
      genBtn.disabled = false;
    }
  });

  // ── PREVIEW (validate with Latch) ────────────────────────────
  if (previewBtn) {
    previewBtn.addEventListener('click', async () => {
      if (!generatedPolicy) return;
      previewBtn.disabled = true;
      previewBtn.textContent = 'Validating…';

      try {
        const res  = await fetch('/api/policies/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules: generatedPolicy.rules }),
        });
        const data = await res.json();
        renderValidation(data);
        showToast('Validation complete', 'ok');
      } catch {
        showToast('Validation error', 'err');
      } finally {
        previewBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4-4"/></svg> Validate with Latch';
        previewBtn.disabled = false;
      }
    });
  }

  // ── ACTIVATE (open modal) ────────────────────────────────────
  if (activateBtn) {
    activateBtn.addEventListener('click', () => {
      if (!generatedPolicy) return;
      // Update name from input
      if (nameInput && nameInput.value.trim()) {
        generatedPolicy.name = nameInput.value.trim();
      }
      if (modalPolicyText) {
        modalPolicyText.innerHTML = `<strong>${generatedPolicy.name}</strong><br/><span style="color:var(--txt2);font-size:12px">${generatedPolicy.description}</span>`;
      }
      confirmOverlay.style.display = 'flex';
      setStep(4);
    });
  }

  if (cancelActivate)  cancelActivate.addEventListener('click',  () => { confirmOverlay.style.display = 'none'; setStep(2); });
  const closeModal = document.getElementById('close-policy-modal');
  if (closeModal) closeModal.addEventListener('click', () => { confirmOverlay.style.display = 'none'; });
  if (confirmOverlay) confirmOverlay.addEventListener('click', e => { if (e.target === confirmOverlay) confirmOverlay.style.display = 'none'; });

  // ── CONFIRM & ACTIVATE ───────────────────────────────────────
  if (confirmActivate) {
    confirmActivate.addEventListener('click', async () => {
      if (!generatedPolicy) return;
      confirmActivate.textContent = 'Activating…';
      confirmActivate.disabled    = true;

      try {
        const res  = await fetch('/api/policies/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ policy: generatedPolicy }),
        });
        const data = await res.json();

        if (data.ok) {
          confirmOverlay.style.display  = 'none';
          if (successBanner) successBanner.style.display = 'flex';
          resultPanel.style.display     = 'none';
          document.querySelectorAll('.step').forEach(s => { s.classList.remove('step-active'); s.classList.add('step-done'); });
          showToast('✓ Policy activated by Latch!', 'ok');

          // Reload the policies list after 1.5s
          setTimeout(() => location.reload(), 1500);
        } else {
          showToast(data.error || 'Activation failed', 'err');
        }
      } catch {
        showToast('Activation failed — network error', 'err');
      } finally {
        confirmActivate.textContent = 'Confirm & Activate';
        confirmActivate.disabled    = false;
      }
    });
  }

  // ── POLICY MANAGEMENT (toggle / delete) ──────────────────────
  document.querySelectorAll('.policy-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id      = btn.dataset.id;
      const status  = btn.dataset.status;
      const newStat = status === 'active' ? 'pending' : 'active';
      btn.disabled  = true;
      try {
        const res  = await fetch(`/api/policies/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStat }),
        });
        const data = await res.json();
        if (data.ok) {
          showToast(newStat === 'active' ? '✓ Policy activated' : 'Policy deactivated', 'ok');
          setTimeout(() => location.reload(), 800);
        } else {
          showToast(data.error || 'Failed', 'err');
        }
      } catch { showToast('Network error', 'err'); }
      finally  { btn.disabled = false; }
    });
  });

  document.querySelectorAll('.policy-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id   = btn.dataset.id;
      const row  = btn.closest('[data-policy-id]');
      const name = row ? row.querySelector('.api-row-name')?.textContent : 'this policy';
      if (!confirm(`Remove "${name}"? This cannot be undone.`)) return;
      btn.disabled = true;
      try {
        const res  = await fetch(`/api/policies/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.ok) {
          showToast('Policy removed', 'ok');
          setTimeout(() => location.reload(), 800);
        } else {
          showToast(data.error || 'Failed', 'err');
        }
      } catch { showToast('Network error', 'err'); }
      finally  { btn.disabled = false; }
    });
  });
}

// ── AI Playground ──────────────────────────────────────────
function initPlayground() {
  const input       = document.getElementById('chat-input');
  const sendBtn     = document.getElementById('send-btn');
  const messages    = document.getElementById('chat-messages');
  const newChatBtn  = document.getElementById('new-chat-btn');
  const modelSel    = document.getElementById('model-select');
  const apiSel      = document.getElementById('api-select');
  const welcomeEl   = document.getElementById('chat-welcome');
  const suggestions = document.getElementById('chat-suggestions');
  const charCt      = document.getElementById('chat-char-ct');
  if (!input || !messages) return;

  let conversationId = null;
  let isSending      = false;
  let hasStarted     = false;

  // ── Helpers ──────────────────────────────────────────────────
  function getTime() {
    const d = new Date();
    let h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderMarkdown(text) {
    return escHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:rgba(170,255,0,.1);color:#aaff00;padding:1px 5px;border-radius:4px;font-size:12px">$1</code>')
      .replace(/\n/g, '<br/>');
  }

  // ── Auto-resize textarea ─────────────────────────────────────
  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }

  // ── Show started state ───────────────────────────────────────
  function startConversation() {
    if (hasStarted) return;
    hasStarted = true;
    if (welcomeEl) { welcomeEl.style.display = 'none'; }
    if (suggestions) { suggestions.style.display = 'flex'; }
  }

  // ── Add message bubble ───────────────────────────────────────
  function addMsg(html, cls) {
    // Remove welcome if present
    startConversation();
    const div = document.createElement('div');
    div.className = `msg ${cls}`;
    div.innerHTML = html;
    messages.appendChild(div);
    requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
    return div;
  }

  // ── Disable / enable ─────────────────────────────────────────
  function setSending(state) {
    isSending = state;
    sendBtn.disabled = state;
    input.disabled   = state;
    sendBtn.style.opacity = state ? '0.4' : '1';
  }

  // ── Update request panel ─────────────────────────────────────
  function updateRequestPanel(data) {
    const get = id => document.getElementById(id);
    const statusEl = get('rp-status');
    const intentEl = get('rp-intent');
    const policyEl = get('rp-policy');
    const apiEl    = get('rp-api');
    const epEl     = get('rp-endpoint');
    const timeEl   = get('rp-time');
    const rulesEl  = get('rules-list');
    if (!statusEl || !data.requestDetails) return;

    const st = data.requestDetails.status;
    statusEl.textContent = st === 'blocked' ? 'Blocked' : st === 'failed' ? 'Failed' : 'Allowed';
    statusEl.className   = `rp-val ${st === 'blocked' || st === 'failed' ? 'rp-blocked' : 'rp-allowed'}`;
    statusEl.removeAttribute('style');

    if (intentEl) {
      intentEl.textContent = data.intent ? data.intent.replace('_',' ') : '—';
      intentEl.removeAttribute('style');
    }
    if (policyEl) { policyEl.textContent = data.requestDetails.policy || '—'; policyEl.removeAttribute('style'); }
    if (apiEl)    { apiEl.textContent    = data.requestDetails.api    || '—'; apiEl.removeAttribute('style'); }
    if (epEl)     { epEl.textContent     = data.requestDetails.endpoint || '—'; epEl.removeAttribute('style'); }
    if (timeEl)   { timeEl.textContent   = data.requestDetails.time   || getTime(); timeEl.removeAttribute('style'); }

    if (rulesEl && data.appliedRules) {
      rulesEl.innerHTML = data.appliedRules.map(r => `
        <div class="rule ${r.pass ? 'rule-pass' : 'rule-fail'}">
          ${r.pass
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>'
            : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'}
          ${escHtml(r.label)}
        </div>`).join('');
    }
  }

  // ── Render AI message ─────────────────────────────────────────
  function renderAIMessage(data) {
    const time = getTime();
    if (data.status === 'blocked' || data.status === 'failed') {
      const reason = data.blockedReason || { policy: 'Policy Engine', reason: data.response || 'Blocked.' };
      return addMsg(`
        <div class="msg-avatar msg-av-blocked">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </div>
        <div class="msg-body">
          <div class="msg-bubble msg-bubble-blocked">
            <div class="blocked-tag">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              ${data.status === 'failed' ? 'Request Failed' : 'Blocked by Policy'}
            </div>
            <p style="font-size:13px;color:rgba(255,255,255,.75);margin:0 0 8px">${renderMarkdown(data.response || reason.reason)}</p>
            <span class="blocked-meta">Policy: ${escHtml(reason.policy)}</span>
            <span class="blocked-meta">Reason: ${escHtml(reason.reason)}</span>
          </div>
          <div class="msg-time">${time}</div>
        </div>`, 'msg-ai msg-blocked-wrap');
    }

    return addMsg(`
      <div class="msg-avatar msg-av-ai">
        <img src="/assets/carbon-logo.svg" width="18" height="18" alt="C"/>
      </div>
      <div class="msg-body">
        <div class="msg-bubble">
          ${renderMarkdown(data.response || '')}
        </div>
        <div class="msg-time">${time}</div>
      </div>`, 'msg-ai');
  }

  // ── Clear / new chat ──────────────────────────────────────────
  function clearChat() {
    // Remove all real messages (keep only welcome if re-showing)
    messages.innerHTML = '';
    if (welcomeEl) {
      messages.appendChild(welcomeEl);
      welcomeEl.style.display = 'flex';
    }
    if (suggestions) suggestions.style.display = 'none';
    hasStarted     = false;
    conversationId = null;
    input.value    = '';
    input.style.height = 'auto';
    if (charCt) charCt.textContent = '0';

    // Reset request panel
    ['rp-status','rp-intent','rp-policy','rp-api','rp-endpoint','rp-time'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = '—'; el.style.color = 'rgba(255,255,255,.2)'; el.className = 'rp-val'; }
    });
    const rulesEl = document.getElementById('rules-list');
    if (rulesEl) rulesEl.innerHTML = '<div class="rule" style="color:rgba(255,255,255,.2)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg> Waiting for request…</div>';

    input.focus();
  }

  // ── Main send function ────────────────────────────────────────
  async function send() {
    const text = input.value.trim();
    if (!text || isSending) return;
    input.value = '';
    input.style.height = 'auto';
    if (charCt) charCt.textContent = '0';
    setSending(true);

    const time = getTime();

    // User bubble
    addMsg(`
      <div class="msg-avatar msg-av-user">AC</div>
      <div class="msg-body">
        <div class="msg-bubble">${escHtml(text)}</div>
        <div class="msg-time">${time}</div>
      </div>`, 'msg-user');

    // Typing indicator
    const typing = addMsg(`
      <div class="msg-avatar msg-av-ai">
        <img src="/assets/carbon-logo.svg" width="18" height="18" alt="C"/>
      </div>
      <div class="msg-body">
        <div class="msg-bubble">
          <div class="typing-indicator">
            <span class="typing-dot" style="animation-delay:0s"></span>
            <span class="typing-dot" style="animation-delay:.15s"></span>
            <span class="typing-dot" style="animation-delay:.3s"></span>
            <span class="typing-label">thinking…</span>
          </div>
        </div>
      </div>`, 'msg-ai');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId,
          model:    modelSel ? modelSel.value : 'carbon',
          apiScope: apiSel   ? apiSel.value   : 'all',
        }),
      });

      typing.remove();

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        addMsg(`
          <div class="msg-avatar msg-av-blocked">!</div>
          <div class="msg-body">
            <div class="msg-bubble msg-bubble-blocked">
              <div class="blocked-tag">Server Error</div>
              <p>${escHtml(err.response || 'Something went wrong. Please try again.')}</p>
            </div>
            <div class="msg-time">${getTime()}</div>
          </div>`, 'msg-ai msg-blocked-wrap');
        return;
      }

      const data = await res.json();
      if (data.conversationId) conversationId = data.conversationId;

      renderAIMessage(data);
      updateRequestPanel(data);

    } catch (err) {
      typing.remove();
      addMsg(`
        <div class="msg-avatar msg-av-blocked">!</div>
        <div class="msg-body">
          <div class="msg-bubble msg-bubble-blocked">
            <div class="blocked-tag">Network Error</div>
            <p>Could not reach the server. Check your connection.</p>
          </div>
          <div class="msg-time">${getTime()}</div>
        </div>`, 'msg-ai msg-blocked-wrap');
    } finally {
      setSending(false);
      input.focus();
    }
  }

  // ── Event listeners ───────────────────────────────────────────
  sendBtn.addEventListener('click', send);

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  input.addEventListener('input', () => {
    resizeInput();
    if (charCt) charCt.textContent = input.value.length;
  });

  if (newChatBtn) newChatBtn.addEventListener('click', clearChat);

  // Update status label when API scope changes
  if (apiSel) {
    apiSel.addEventListener('change', () => {
      const label = document.getElementById('api-scope-label');
      if (!label) return;
      const val = apiSel.value;
      if (val === 'all' || val === 'All APIs') {
        label.textContent = `${apiSel.options.length - 1} APIs active`;
      } else {
        label.textContent = `${val} only`;
      }
    });
  }

  // Welcome chips
  document.querySelectorAll('.welcome-chip, .sug-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      if (!prompt) return;
      input.value = prompt;
      resizeInput();
      if (charCt) charCt.textContent = prompt.length;
      input.focus();
      send();
    });
  });

  // Auto-focus input
  input.focus();
}

// ── Request Logs Page Functions ───────────────────────────────────
async function refreshLogs() {
  try {
    const res = await fetch('/api/logs');
    const logs = await res.json();
    renderLogs(logs);
  } catch (err) {
    console.error('Failed to load logs:', err);
  }
}

function renderLogs(logs) {
  const container = document.getElementById('log-rows');
  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">No logs yet</div>';
    return;
  }

  container.innerHTML = logs.map(log => `
    <div class="log-row" data-result="${log.result}">
      <span style="width:80px">${log.time}</span>
      <span style="width:120px">${log.api || log.source}</span>
      <span style="width:90px"><span class="result-badge ${log.result}">${log.result}</span></span>
      <span style="width:140px">${log.policy || '—'}</span>
      <span style="flex:1;color:var(--text3)">${log.detail || '—'}</span>
    </div>
  `).join('');
}

function switchLogTab(btn) {
  // Remove active from all tabs
  const tabs = btn.parentElement.querySelectorAll('.tab-btn');
  tabs.forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  // Hide all tab contents
  const contents = ['tab-request-logs', 'tab-api-limits', 'tab-policy-stats'];
  contents.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Show selected tab
  const tabName = btn.textContent.trim().toLowerCase().replace(/ /g, '-');
  const tabId = 'tab-' + tabName;
  const panel = document.getElementById(tabId);
  if (panel) {
    panel.style.display = 'block';
    // Load data for the selected tab
    if (tabName === 'request-logs') refreshLogs();
    else if (tabName === 'api-limits') loadAPILimits();
    else if (tabName === 'policy-stats') loadPolicyStats();
  }
}

function filterLogs(btn, filter) {
  // Update active button
  const btns = btn.parentElement.querySelectorAll('.tab-btn');
  btns.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Filter rows
  const rows = document.querySelectorAll('#log-rows .log-row');
  rows.forEach(row => {
    if (filter === 'all') {
      row.style.display = '';
    } else {
      row.style.display = row.dataset.result === filter ? '' : 'none';
    }
  });
}

async function loadAPILimits() {
  const container = document.getElementById('api-limits-container');
  if (!container) return;

  try {
    const [policiesRes, logsRes] = await Promise.all([
      fetch('/api/policies'),
      fetch('/api/logs')
    ]);
    const policies = await policiesRes.json();
    const logs = await logsRes.json();

    // Extract rate limits from active policies
    const activePolicies = policies.filter(p => p.status === 'active');
    const limits = [];

    activePolicies.forEach(policy => {
      if (!policy.rules) return;
      policy.rules.forEach(rule => {
        if (rule.rateLimit || rule.limit) {
          const limit = rule.rateLimit || rule.limit;
          const apiName = rule.api || policy.api || 'All';
          
          // Count usage from logs
          const apiLogs = logs.filter(l => 
            (l.api === apiName || apiName === 'All') && l.result === 'allowed'
          );

          limits.push({
            api: apiName,
            limit: limit,
            used: apiLogs.length,
            policy: policy.name
          });
        }
      });
    });

    if (limits.length === 0) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">No rate limits configured</div>';
      return;
    }

    container.innerHTML = limits.map(l => {
      const [max, period] = l.limit.split('/');
      const pct = (l.used / parseInt(max)) * 100;
      const color = pct > 80 ? '#f44336' : pct > 60 ? '#ff9800' : '#4caf50';
      
      return `
        <div style="padding:16px;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px">
            <div>
              <strong>${l.api}</strong>
              <span style="color:var(--text3);margin-left:8px">— ${l.policy}</span>
            </div>
            <span style="color:${color};font-weight:600">${l.used}/${max} ${period}</span>
          </div>
          <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="height:100%;background:${color};width:${Math.min(pct, 100)}%"></div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#f44336">Failed to load API limits</div>';
    console.error('Failed to load API limits:', err);
  }
}

async function loadPolicyStats() {
  const container = document.getElementById('policy-stats-container');
  if (!container) return;

  try {
    const [policiesRes, logsRes] = await Promise.all([
      fetch('/api/policies'),
      fetch('/api/logs')
    ]);
    const policies = await policiesRes.json();
    const logs = await logsRes.json();

    const stats = policies.map(policy => {
      const allowed = logs.filter(l => l.policy === policy.name && l.result === 'allowed').length;
      const blocked = logs.filter(l => l.policy === policy.name && l.result === 'blocked').length;
      const total = allowed + blocked;
      
      return {
        name: policy.name,
        status: policy.status,
        api: policy.api,
        allowed,
        blocked,
        total,
        rules: (policy.rules || []).length
      };
    });

    if (stats.length === 0) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">No policies created yet</div>';
      return;
    }

    container.innerHTML = stats.map(s => `
      <div style="padding:16px;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div>
            <strong>${s.name}</strong>
            <span class="result-badge ${s.status}" style="margin-left:8px;font-size:10px">${s.status}</span>
          </div>
          <span style="color:var(--text3)">${s.api}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
          <div>
            <div style="color:var(--text3);font-size:11px">Rules</div>
            <div style="font-size:18px;font-weight:600">${s.rules}</div>
          </div>
          <div>
            <div style="color:var(--text3);font-size:11px">Total Requests</div>
            <div style="font-size:18px;font-weight:600">${s.total}</div>
          </div>
          <div>
            <div style="color:#4caf50;font-size:11px">Allowed</div>
            <div style="font-size:18px;font-weight:600;color:#4caf50">${s.allowed}</div>
          </div>
          <div>
            <div style="color:#f44336;font-size:11px">Blocked</div>
            <div style="font-size:18px;font-weight:600;color:#f44336">${s.blocked}</div>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#f44336">Failed to load policy stats</div>';
    console.error('Failed to load policy stats:', err);
  }
}

// ── Security & Logs tabs (LEGACY - kept for compatibility) ───────────────────────────────────
function initSecurityTabs() {
  // Legacy function - now handled by switchLogTab
  const tabs = document.getElementById('sec-tabs');
  if (!tabs) return;

  const tabPanels = { logs: 'tab-logs', limits: 'tab-limits', security: 'tab-security' };

  tabs.querySelectorAll('.tab-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('tab-active'));
      btn.classList.add('tab-active');
      Object.values(tabPanels).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      const panel = document.getElementById(tabPanels[btn.dataset.tab]);
      if (panel) panel.style.display = 'block';
    });
  });
}

// ── Log filters (Security & Request Logs) ─────────────────
function initLogFilters() {
  ['log-filters', 'rl-filters'].forEach(containerId => {
    const container = document.getElementById(containerId);
    if (!container) return;

    const tbody = containerId === 'log-filters'
      ? document.getElementById('log-tbody')
      : document.getElementById('rl-tbody');
    if (!tbody) return;

    container.querySelectorAll('.tab-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('tab-active'));
        btn.classList.add('tab-active');
        const f = btn.dataset.filter;
        tbody.querySelectorAll('.log-row').forEach(row => {
          if (f === 'all') { row.style.display = ''; return; }
          row.style.display = row.dataset.result === f ? '' : 'none';
        });
      });
    });
  });

  // Log search
  const logSearch = document.getElementById('log-search');
  const rlTbody   = document.getElementById('rl-tbody');
  if (logSearch && rlTbody) {
    logSearch.addEventListener('input', () => {
      const q = logSearch.value.toLowerCase();
      rlTbody.querySelectorAll('.log-row').forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(q) ? '' : 'none';
      });
    });
  }
}

// ── Settings nav ───────────────────────────────────────────
function initSettings() {
  const nav = document.querySelector('.settings-nav-panel');
  if (!nav) return;

  nav.querySelectorAll('.s-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      nav.querySelectorAll('.s-nav-item').forEach(i => i.classList.remove('s-nav-active'));
      item.classList.add('s-nav-active');
      const section = item.dataset.section;
      document.querySelectorAll('.settings-panel').forEach(p => p.style.display = 'none');
      const panel = document.getElementById(`section-${section}`);
      if (panel) panel.style.display = 'block';
    });
  });

  // Toggles
  document.querySelectorAll('.toggle').forEach(t => {
    t.addEventListener('click', () => t.classList.toggle('on'));
  });

  // ── Save profile (works with or without Supabase) ───────────────
  const saveBtn    = document.getElementById('save-profile-btn');
  const savedEl    = document.getElementById('profile-saved');
  const profileErr = document.getElementById('profile-error');

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const nameVal = (document.getElementById('s-name') || {}).value || '';
      saveBtn.textContent = 'Saving…';
      saveBtn.disabled = true;

      try {
        // If Supabase is configured, update the user metadata
        if (window.__carbonSb && nameVal.trim()) {
          const { error } = await window.__carbonSb.auth.updateUser({
            data: {
              full_name: nameVal.trim(),
              name:      nameVal.trim(),
              initials:  nameVal.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2),
            },
          });
          if (error) throw error;
        }

        if (savedEl)    { savedEl.style.display = 'inline-flex'; }
        if (profileErr) { profileErr.style.display = 'none'; }
        showToast('✓ Profile saved', 'ok');
        setTimeout(() => { if (savedEl) savedEl.style.display = 'none'; }, 3000);

      } catch (err) {
        if (profileErr) {
          profileErr.textContent = '✗ ' + (err.message || 'Save failed');
          profileErr.style.display = 'inline-flex';
        }
        showToast('Profile save failed', 'err');
      } finally {
        saveBtn.textContent = 'Save Changes';
        saveBtn.disabled = false;
      }
    });
  }

  // ── Change password ─────────────────────────────────────────────
  const savePwBtn  = document.getElementById('save-password-btn');
  const pwSaved    = document.getElementById('password-saved');
  const pwError    = document.getElementById('password-error');

  if (savePwBtn) {
    savePwBtn.addEventListener('click', async () => {
      const newPw  = (document.getElementById('s-new-password')  || {}).value || '';
      const confPw = (document.getElementById('s-confirm-password') || {}).value || '';

      if (!newPw || newPw.length < 8) { showToast('Password must be 8+ characters', 'err'); return; }
      if (newPw !== confPw)            { showToast('Passwords do not match', 'err'); return; }

      savePwBtn.textContent = 'Updating…';
      savePwBtn.disabled = true;

      try {
        if (window.__carbonSb) {
          const { error } = await window.__carbonSb.auth.updateUser({ password: newPw });
          if (error) throw error;
        }
        if (pwSaved) { pwSaved.style.display = 'inline-flex'; }
        if (pwError) { pwError.style.display = 'none'; }
        document.getElementById('s-new-password').value = '';
        document.getElementById('s-confirm-password').value = '';
        showToast('✓ Password updated', 'ok');
        setTimeout(() => { if (pwSaved) pwSaved.style.display = 'none'; }, 3000);
      } catch (err) {
        if (pwError) {
          pwError.textContent = '✗ ' + (err.message || 'Update failed');
          pwError.style.display = 'inline-flex';
        }
        showToast('Password update failed', 'err');
      } finally {
        savePwBtn.textContent = 'Update Password';
        savePwBtn.disabled = false;
      }
    });
  }

  // ── Invite team ─────────────────────────────────────────────────
  const inviteBtn = document.getElementById('invite-btn');
  if (inviteBtn) {
    inviteBtn.addEventListener('click', () => {
      const email = document.getElementById('invite-email').value.trim();
      if (!email || !email.includes('@')) { showToast('Enter a valid email', 'err'); return; }
      showToast(`Invitation sent to ${email}`, 'ok');
      document.getElementById('invite-email').value = '';
    });
  }
}

// ── Global search ──────────────────────────────────────────
function initGlobalSearch() {
  const input = document.getElementById('global-search');
  if (!input) return;
  input.addEventListener('keypress', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      showToast(`Searching for "${input.value.trim()}"…`, 'ok');
    }
  });
}

// ── Notification button ────────────────────────────────────
function initNotifBtn() {
  const btn = document.getElementById('notif-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    showToast('3 new notifications', 'ok');
  });
}

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initApiTabs();
  initAddApiModal();
  initManageApiModal();
  initPolicyBuilder();
  initPlayground();
  initSecurityTabs();
  initLogFilters();
  initSettings();
  initGlobalSearch();
  initNotifBtn();
});


// ── Profile Dropdowns ──────────────────────────────────────
(function(){
  function setupDropdown(btnId, dropdownId, avatarId){
    const btn      = document.getElementById(btnId);
    const dropdown = document.getElementById(dropdownId);
    const avatar   = avatarId ? document.getElementById(avatarId) : btn;
    if(!btn || !dropdown) return;

    btn.addEventListener('click', function(e){
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('open');
      // Close all open dropdowns first
      document.querySelectorAll('.profile-dropdown.open').forEach(d => d.classList.remove('open'));
      document.querySelectorAll('.tb-avatar.active,.sb-user.active').forEach(a => a.classList.remove('active'));
      if(!isOpen){
        dropdown.classList.add('open');
        if(avatar) avatar.classList.add('active');
      }
    });
  }

  // Topbar avatar
  setupDropdown('tb-avatar-btn', 'tb-dropdown', 'tb-avatar-btn');
  // Sidebar user row
  setupDropdown('sb-user-btn',   'sb-dropdown',  'sb-user-btn');

  // Close on outside click
  document.addEventListener('click', function(){
    document.querySelectorAll('.profile-dropdown.open').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.tb-avatar.active,.sb-user.active').forEach(a => a.classList.remove('active'));
  });

  // Sign out buttons — just reload to home for demo
  document.querySelectorAll('#signout-btn, .pd-signout').forEach(function(btn){
    btn.addEventListener('click', function(){
      window.location.href = '/';
    });
  });
})();
