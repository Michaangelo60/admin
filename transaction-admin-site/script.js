const API_BASE = 'http://localhost:5000';

// Resolve API base at runtime:
// - Use `window.API_BASE` or `window.API_URL` when set by the host/static deploy,
// - otherwise fall back to same origin (`location.origin`) so the admin works when
//   served from the backend (e.g., /admin on Render).
const API_BASE = (window.API_BASE || window.API_URL || location.origin).replace(/\/$/, '');

// Simple helper
function qs(sel, root=document) { return root.querySelector(sel); }
function qsa(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }

// --- Auth / register / login page logic (index.html) ---
if (document.getElementById('auth-form')) {
  let isRegister = false;
  const formTitle = qs('#form-title');
  const toggleLink = qs('#toggle-link');
  const toggleText = qs('#toggle-text');
  const nameInput = qs('#name');
  const emailInput = qs('#email');
  const passwordInput = qs('#password');
  const submitBtn = qs('#submit-btn');
  const statusEl = qs('#status');

  nameInput.style.display = 'none';

  toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    isRegister = !isRegister;
    formTitle.textContent = isRegister ? 'Register' : 'Sign In';
    submitBtn.textContent = isRegister ? 'Register' : 'Sign In';
    toggleText.textContent = isRegister ? 'Already have an account?' : "Don't have an account?";
    toggleLink.textContent = isRegister ? 'Sign In' : 'Register';
    nameInput.style.display = isRegister ? 'block' : 'none';
  });

  qs('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '';
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    if (!email || !password || (isRegister && !name)) { statusEl.textContent = 'Please fill required fields'; return; }

    try {
      if (isRegister) {
        const res = await fetch(API_BASE + '/api/auth/register', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ name, email, password })
        });
        const j = await res.json().catch(()=>({}));
        if (!res.ok) throw new Error(j.message || 'Register failed');
        statusEl.textContent = 'Registered. Logging in...';
        // fallthrough to login
      }

      // login
      const loginRes = await fetch(API_BASE + '/api/auth/login', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ email, password })
      });
      const loginJ = await loginRes.json().catch(()=>({}));
      if (!loginRes.ok) throw new Error(loginJ.message || 'Login failed');
      // store token + user then go to admin
      if (loginJ && (loginJ.token || loginJ.data?.token)) {
        const token = loginJ.token || loginJ.data.token;
        const user = loginJ.user || loginJ.data?.user || loginJ.data || {};
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        window.location.href = 'admin.html';
      } else {
        statusEl.textContent = 'Login succeeded but no token returned';
      }
    } catch (err) {
      statusEl.textContent = err.message || 'Auth error';
      console.error(err);
    }
  });
}

// --- Admin page logic (admin.html) ---
if (document.getElementById('tx-list')) {
  const txListEl = qs('#tx-list');
  const statusEl = qs('#status');
  const userInfoEl = qs('#user-info');
  const refreshBtn = qs('#refresh-btn');
  const promoteBtn = qs('#promote-btn');
  const logoutBtn = qs('#logout-btn');

  logoutBtn.addEventListener('click', () => { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = 'index.html'; });
  refreshBtn.addEventListener('click', loadTransactions);
  if (promoteBtn) promoteBtn.addEventListener('click', promoteToAdmin);

  async function promoteToAdmin() {
    if (!confirm('Promote your account to admin? This is a dev helper.')) return;
    try {
      const token = localStorage.getItem('token') || '';
      const res = await fetch(API_BASE + '/api/dev/promote', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) {
        statusEl.textContent = `Promote failed: ${res.status} ${j && j.message ? j.message : JSON.stringify(j)}`;
        console.error('Promote failed', res.status, j);
        return;
      }
      // store new token + user payload
      if (j && (j.token || j.data)) {
        const newToken = j.token || j.data.token;
        const user = j.data || j.user || j;
        if (newToken) localStorage.setItem('token', newToken);
        if (user) localStorage.setItem('user', JSON.stringify(user));
        statusEl.textContent = 'Promoted to admin — reloading transactions';
        await loadTransactions();
      }
    } catch (err) {
      statusEl.textContent = err.message || 'Promote error';
      console.error(err);
    }
  }

  async function loadTransactions() {
    txListEl.textContent = 'Loading...';
    statusEl.textContent = '';
    try {
      const token = localStorage.getItem('token') || '';
      const res = await fetch(API_BASE + '/api/transactions', { headers: { 'Authorization': 'Bearer ' + token } });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) {
        txListEl.textContent = 'Failed to load transactions';
        // show full server response to help debugging
        statusEl.textContent = JSON.stringify(j, null, 2) || (j.message || 'Failed fetching transactions');
        console.error('Transactions fetch failed', j);
        return;
      }
      const data = Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : (j.transactions || []));
      // Admins should see all transactions (pending + completed). Render all.
      let isAdmin = false;
      try { const u = JSON.parse(localStorage.getItem('user')||'{}'); isAdmin = u && String(u.role||'').toLowerCase() === 'admin'; } catch(e) { isAdmin = false; }
      if (!data || data.length === 0) {
        txListEl.innerHTML = '<div class="card muted">No transactions</div>';
        statusEl.textContent = 'No transactions returned';
        return;
      }
      renderList(data, isAdmin);
      // show user
      try { const u = JSON.parse(localStorage.getItem('user')||'{}'); userInfoEl.textContent = u.name ? `${u.name} — ${u.email||''}` : (u.email||''); } catch(e){}
    } catch (err) {
      txListEl.textContent = 'Failed to load transactions';
      statusEl.textContent = err.message || 'Error';
      console.error(err);
    }
  }

  function renderList(list, isAdmin) {
    if (!list || list.length === 0) { txListEl.innerHTML = '<div class="card muted">No transactions</div>'; return; }
    txListEl.innerHTML = list.map(t => {
      const amount = (typeof t.amount === 'number') ? `$${t.amount.toFixed(2)}` : (t.amount||'');
      const txId = t._id||t.id||'';
      const statusText = t.status ? String(t.status) : 'unknown';
      let controlsHtml = '';
      if (isAdmin) {
        if (String(statusText).toLowerCase() === 'pending') {
          controlsHtml = `<div class="tx-controls"><button class="confirm-btn">Confirm</button></div>`;
        } else {
          controlsHtml = `<div class="tx-controls"><span style="color:#10b981;font-weight:700">✔ ${statusText}</span></div>`;
        }
      } else {
        controlsHtml = `<div class="tx-controls"><span class="muted">Admin only</span></div>`;
      }
      return `<div class="card tx" data-id="${txId}">
        <div><strong>${t.description||t.type||'Transaction'}</strong></div>
        <div>${amount} — ${new Date(t.timestamp||t.createdAt||Date.now()).toLocaleString()}</div>
        <div>User: ${t.userName||t.user || t.userEmail || t.userId || ''}</div>
        ${controlsHtml}
      </div>`;
    }).join('');

    if (isAdmin) {
      qsa('.confirm-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const card = e.target.closest('.tx');
          const id = card.dataset.id;
          if (!confirm('Mark transaction as Completed?')) return;
          try {
            const token = localStorage.getItem('token') || '';
            const res = await fetch(API_BASE + '/api/transactions/' + id + '/status', {
              method: 'PATCH', headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + token },
              body: JSON.stringify({ status: 'Completed' })
            });
            const j = await res.json().catch(()=>({}));
            if (!res.ok) {
              const errMsg = `Confirm failed: ${res.status} ${j && j.error ? j.error : (j && j.message ? j.message : JSON.stringify(j))}`;
              statusEl.textContent = errMsg;
              console.error('Confirm response:', res.status, j);
              return;
            }
            // update card in-place to completed state (so it remains after sign out)
            try {
              const updated = j.data || j || {};
              card.innerHTML = `\n                <div><strong>${updated.description||'Transaction'}</strong></div>\n                <div>${(typeof updated.amount==='number'?`$${updated.amount.toFixed(2)}`:updated.amount)} — ${new Date(updated.timestamp||updated.createdAt||Date.now()).toLocaleString()}</div>\n                <div>User: ${updated.userName||updated.user||updated.userEmail||updated.userId||''}</div>\n                <div class="tx-controls"><span style="color:#10b981;font-weight:700">✔ Completed</span></div>\n              `;
            } catch (e) {
              try { card.remove(); } catch(_){}
            }
            statusEl.textContent = 'Transaction confirmed';
            // refresh user profile so balances update
            try { await fetch(API_BASE + '/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } }).then(r=>r.json()).then(j=>{ if (j && j.data) localStorage.setItem('user', JSON.stringify(j.data)); }); } catch(e){}
          } catch (err) {
            statusEl.textContent = err.message || 'Error confirming';
            console.error(err);
          }
        });
      });
    }
  }

  // initial load
  (async ()=>{
    const token = localStorage.getItem('token');
    if (!token) { window.location.href = 'index.html'; return; }
    await loadTransactions();
  })();
}

