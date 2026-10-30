'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const money = n => (+n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => localDate(new Date());

const S = {
  user: null, lang: localStorage.getItem('lang') || 'en', tab: 'billing',
  products: [], settings: {},
  cart: [], customer: '', phone: '', discType: 'amount', discVal: '', payment: 'cash', q: '',
  invQ: '', rec: { from: '', to: '', q: '', range: 'all' },
};
const t = k => I18N[S.lang][k] ?? I18N.en[k] ?? k;
const pname = p => (S.lang === 'mr' && p.nameMr) ? p.nameMr : p.name;
const shopTitle = () => S.lang === 'mr' && S.settings.shopNameMr ? S.settings.shopNameMr : (S.settings.shopName || t('appName'));

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (data === null) throw new Error('Server error: the API did not return data. Check the deployment and MongoDB settings.');
  if (res.status === 401 && url !== '/api/login' && url !== '/api/me') { S.user = null; renderApp(); throw new Error(data.error || 'Login required'); }
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}
let toastT;
function toast(msg, err) {
  const el = $('#toast'); el.textContent = msg; el.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => el.className = '', 2800);
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

// ---------------- shell ----------------
async function init() {
  document.documentElement.lang = S.lang;
  try { S.user = await api('GET', '/api/me'); } catch (e) { S.user = null; if (!/log/i.test(e.message)) setTimeout(() => toast(e.message, true), 100); }
  if (S.user) { try { await loadBase(); } catch (e) { S.user = null; setTimeout(() => toast(e.message, true), 100); } }
  renderApp();
}
async function loadBase() {
  [S.products, S.settings] = await Promise.all([api('GET', '/api/products'), api('GET', '/api/settings')]);
}
function setLang(l) { S.lang = l; localStorage.setItem('lang', l); document.documentElement.lang = l; renderApp(); }
const langBtn = id => `<button class="hbtn" id="${id}">${S.lang === 'en' ? 'मराठी' : 'English'}</button>`;

function renderApp() {
  const app = $('#app');
  document.title = S.user ? shopTitle() : t('appName');
  if (!S.user) return renderLogin(app);
  const tabs = [['billing', '🧾'], ['inventory', '📦'], ['records', '📊'], ['settings', '⚙️']];
  app.innerHTML = `
    <header><div class="logo">🧨</div><div class="title">${esc(shopTitle())}</div>${langBtn('lg')}<button class="hbtn" id="lo">${t('logout')}</button></header>
    <nav>${tabs.map(([k, i]) => `<button data-t="${k}" class="${S.tab === k ? 'on' : ''}"><span>${i}</span>${t(k)}</button>`).join('')}</nav>
    <main id="view"></main>`;
  $('#lg').onclick = () => setLang(S.lang === 'en' ? 'mr' : 'en');
  $('#lo').onclick = guard(async () => { await api('POST', '/api/logout'); S.user = null; S.cart = []; renderApp(); });
  app.querySelectorAll('nav button').forEach(b => b.onclick = () => { S.tab = b.dataset.t; renderApp(); });
  ({ billing: viewBilling, inventory: viewInventory, records: viewRecords, settings: viewSettings })[S.tab]($('#view'));
}

function renderLogin(app) {
  app.innerHTML = `<div class="login-wrap"><div class="login"><div class="logo">🧨</div><h2>${t('appName')}</h2><p>${t('welcome')}</p>
    <form id="f"><label>${t('username')}</label><input id="u" autocomplete="username" autocapitalize="none" required>
    <label>${t('password')}</label><input id="p" type="password" autocomplete="current-password" required>
    <div class="row" style="margin-top:18px;align-items:center"><button class="btn">${t('login')}</button>
    <button type="button" class="btn sec fit" id="lg">${S.lang === 'en' ? 'मराठी' : 'English'}</button></div></form></div></div>`;
  $('#lg').onclick = () => setLang(S.lang === 'en' ? 'mr' : 'en');
  $('#f').onsubmit = guard(async e => {
    e.preventDefault();
    const pw = $('#p').value;
    S.user = await api('POST', '/api/login', { username: $('#u').value, password: pw });
    await loadBase(); renderApp();
    if (['admin123', 'staff123'].includes(pw)) toast(t('defaultPwWarn'), true);
  });
}

// ---------------- billing ----------------
function calc() {
  const subtotal = r2(S.cart.reduce((a, i) => a + i.qty * i.rate, 0));
  const dv = Math.max(0, Number(S.discVal) || 0);
  const discount = Math.min(subtotal, S.discType === 'percent' ? r2(subtotal * Math.min(dv, 100) / 100) : r2(dv));
  const raw = r2(subtotal - discount), total = Math.round(raw);
  return { subtotal, discount, roundOff: r2(total - raw), total };
}

function viewBilling(v) {
  v.innerHTML = `<div class="billgrid">
    <div>
      <section class="card"><h3>${t('custDetails')}</h3>
        <div class="row"><div><label>${t('customer')} *</label><input id="cn" value="${esc(S.customer)}" maxlength="80" autocomplete="off"></div>
        <div><label>${t('phone')} <em>(${t('optional')})</em></label><input id="cp" inputmode="tel" value="${esc(S.phone)}" maxlength="20" autocomplete="off"></div></div></section>
      <section class="card"><h3>${t('allProducts')}</h3><div class="mute" style="font-size:13px;margin-bottom:8px">${t('tapToAdd')}</div>
        <input id="ps" type="search" placeholder="🔍 ${t('searchProduct')}" value="${esc(S.q)}" autocomplete="off"><div id="tiles"></div></section>
    </div>
    <aside class="billside"><section class="card"><h3>${t('currentBill')}</h3><div id="cart"></div><div id="tot" class="sums"></div>
      <div class="row" style="margin-top:12px"><div><label>${t('discountOpt')}</label>
        <div class="row" style="flex-wrap:nowrap;gap:0"><input id="dv" type="number" min="0" step="any" inputmode="decimal" value="${esc(S.discVal)}" style="border-radius:10px 0 0 10px">
        <div class="seg fit"><button type="button" data-d="amount" style="border-radius:0">₹</button><button type="button" data-d="percent" style="border-radius:0 10px 10px 0">%</button></div></div></div>
        <div><label>${t('payment')}</label><select id="pay">${['cash', 'upi', 'card'].map(p => `<option value="${p}" ${S.payment === p ? 'selected' : ''}>${t(p)}</option>`).join('')}</select></div></div>
      <div style="margin-top:16px"><button class="btn lg" id="gen">${t('generate')}</button></div>
      <div style="text-align:center;margin-top:8px"><button class="btn sec sm" id="clr">${t('clear')}</button></div>
    </section></aside></div>`;
  $('#cn').oninput = e => S.customer = e.target.value;
  $('#cp').oninput = e => S.phone = e.target.value;
  $('#ps').oninput = e => { S.q = e.target.value; drawTiles(); };
  $('#dv').oninput = e => { S.discVal = e.target.value; drawTotals(); };
  $('#pay').onchange = e => S.payment = e.target.value;
  v.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.discType = b.dataset.d; drawSeg(); drawTotals(); });
  $('#clr').onclick = () => { resetBill(); viewBilling(v); };
  $('#gen').onclick = guard(generate);
  drawSeg(); drawTiles(); drawCart(); drawTotals();
}
function resetBill() { Object.assign(S, { cart: [], customer: '', phone: '', discVal: '', discType: 'amount', payment: 'cash', q: '' }); }
function drawSeg() { document.querySelectorAll('[data-d]').forEach(b => b.classList.toggle('on', b.dataset.d === S.discType)); }

function drawTiles() {
  const el = $('#tiles'); if (!el) return;
  if (!S.products.length) { el.innerHTML = `<div class="empty"><span class="ico">📦</span>${t('noProducts')}</div>`; return; }
  const q = S.q.trim().toLowerCase();
  const list = S.products.filter(p => !q || (p.name + ' ' + p.nameMr).toLowerCase().includes(q));
  el.innerHTML = `<div class="tiles">${list.map(p => {
    const inBill = S.cart.find(i => i.productId === p.id);
    return `<button class="tile" data-id="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>
      ${inBill ? `<span class="inbill">${inBill.qty}</span>` : ''}<b>${esc(pname(p))}</b>
      <span class="pr">₹${money(p.price)}${p.unit ? ` <small>/ ${esc(p.unit)}</small>` : ''}</span>
      <small>${p.stock <= 0 ? `<span class="badge">${t('outOfStock')}</span>` : `${p.stock} ${t('inStock')}`}</small></button>`;
  }).join('')}</div>`;
  el.querySelectorAll('[data-id]').forEach(d => d.onclick = () => changeQty(+d.dataset.id, 1, true));
}
function changeQty(id, delta, add) {
  const p = S.products.find(x => x.id === id); if (!p) return;
  let i = S.cart.find(x => x.productId === id);
  if (!i) { if (!add || p.stock <= 0) return; i = { productId: id, qty: 0, rate: p.price }; S.cart.push(i); }
  const n = i.qty + delta;
  if (n > p.stock) return toast(`${pname(p)}: ${t('stock')} ${p.stock}`, true);
  if (n < 1) S.cart = S.cart.filter(x => x !== i); else i.qty = n;
  drawTiles(); drawCart(); drawTotals();
}
function drawCart() {
  const el = $('#cart'); if (!el) return;
  if (!S.cart.length) { el.innerHTML = `<div class="empty"><span class="ico">🧾</span>${t('emptyCart')}</div>`; return; }
  el.innerHTML = S.cart.map((i, n) => {
    const p = S.products.find(x => x.id === i.productId);
    return `<div class="bl"><div class="bl-top"><b>${esc(pname(p))}</b><button class="xbtn" data-x="${i.productId}" aria-label="remove">✕</button></div>
      <div class="bl-calc">
        <div class="rate-box">₹<input type="number" min="0" step="any" inputmode="decimal" data-n="${n}" data-f="rate" value="${i.rate}"></div>
        <span class="op">×</span>
        <div class="stepper"><button data-m="${i.productId}">−</button><input type="number" min="1" max="${p.stock}" step="1" inputmode="numeric" data-n="${n}" data-f="qty" value="${i.qty}"><button data-p="${i.productId}">+</button></div>
        <span class="op">=</span><span class="bl-amt" id="amt${n}">₹${money(i.qty * i.rate)}</span></div></div>`;
  }).join('');
  el.querySelectorAll('input[data-n]').forEach(inp => inp.oninput = () => {
    const i = S.cart[+inp.dataset.n], p = S.products.find(x => x.id === i.productId);
    let val = Number(inp.value);
    if (inp.dataset.f === 'qty') {
      val = Math.floor(val) || 0;
      if (val > p.stock) { val = p.stock; inp.value = val; toast(`${pname(p)}: ${t('stock')} ${p.stock}`, true); }
    }
    i[inp.dataset.f] = val;
    $('#amt' + inp.dataset.n).textContent = '₹' + money(i.qty * i.rate); drawTotals();
  });
  el.querySelectorAll('input[data-f=qty]').forEach(inp => inp.onchange = () => { // drop empty / zero lines on blur
    const i = S.cart[+inp.dataset.n]; if (i.qty < 1) changeQty(i.productId, -1); else drawTiles();
  });
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => changeQty(+b.dataset.m, -1));
  el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => changeQty(+b.dataset.p, 1));
  el.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { S.cart = S.cart.filter(x => x.productId !== +b.dataset.x); drawTiles(); drawCart(); drawTotals(); });
}
function drawTotals() {
  const el = $('#tot'); if (!el) return;
  const c = calc(), line = (k, v) => `<div class="tot"><span>${k}</span><span>${v}</span></div>`;
  el.innerHTML = line(`${t('subtotal')} (${S.cart.reduce((a, i) => a + i.qty, 0)} ${t('items')})`, '₹' + money(c.subtotal)) +
    (c.discount ? line(t('discount') + (S.discType === 'percent' ? ` (${Number(S.discVal)}%)` : ''), '− ₹' + money(c.discount)) : '') +
    (c.roundOff ? line(t('roundOff'), (c.roundOff > 0 ? '+ ' : '− ') + '₹' + money(Math.abs(c.roundOff))) : '') +
    `<div class="tot big"><span>${t('total')}</span><span>₹${money(c.total)}</span></div>`;
}
async function generate() {
  if (!S.customer.trim()) { $('#cn').focus(); return toast(t('enterName'), true); }
  const btn = $('#gen'); btn.disabled = true;
  try {
    const inv = await api('POST', '/api/invoices', {
      customer: S.customer, phone: S.phone, payment: S.payment,
      discountType: S.discType, discountValue: Number(S.discVal) || 0,
      items: S.cart.map(i => ({ productId: i.productId, qty: i.qty, rate: i.rate })),
    });
    S.products = await api('GET', '/api/products');
    resetBill(); renderApp(); toast(t('billCreated') + ' ' + inv.no);
    showInvoice(inv, true);
  } catch (e) {
    if (/stock|Unknown product/i.test(e.message)) S.products = await api('GET', '/api/products').catch(() => S.products);
    throw e;
  } finally { btn.disabled = false; }
}

// ---------------- inventory ----------------
function viewInventory(v) {
  const P = S.products, q = S.invQ.trim().toLowerCase();
  const low = P.filter(p => p.stock > 0 && p.stock <= p.lowStock).length, out = P.filter(p => p.stock <= 0).length;
  const value = P.reduce((a, p) => a + p.stock * p.price, 0);
  v.innerHTML = `<div class="pagehead"><h2>${t('inventory')}</h2><button class="btn" id="add">+ ${t('addProduct')}</button></div>
    <div class="kpis"><div class="kpi"><small>${t('totalProducts')}</small><b>${P.length}</b></div>
      <div class="kpi w"><small>${t('lowItems')}</small><b>${low}</b></div><div class="kpi r"><small>${t('outItems')}</small><b>${out}</b></div>
      <div class="kpi g"><small>${t('stockValue')}</small><b>₹${money(value)}</b></div></div>
    <div class="card"><input id="iq" type="search" placeholder="🔍 ${t('searchInv')}" value="${esc(S.invQ)}"><div id="itab"></div></div>`;
  $('#add').onclick = () => productForm();
  $('#iq').oninput = e => { S.invQ = e.target.value; drawInvTable(); };
  drawInvTable();
}
function drawInvTable() {
  const el = $('#itab'), q = S.invQ.trim().toLowerCase();
  const list = S.products.filter(p => !q || (p.name + ' ' + p.nameMr).toLowerCase().includes(q));
  if (!list.length) { el.innerHTML = `<div class="empty"><span class="ico">📦</span>${t('noProducts')}</div>`; return; }
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>${t('product')}</th><th class="n">${t('price')}</th><th class="n">${t('stock')}</th><th></th></tr></thead><tbody>
    ${list.map(p => `<tr><td><b>${esc(p.name)}</b>${p.nameMr ? `<div class="mute">${esc(p.nameMr)}</div>` : ''}</td>
    <td class="n">₹${money(p.price)}${p.unit ? `<div class="mute">/ ${esc(p.unit)}</div>` : ''}</td>
    <td class="n"><b>${p.stock}</b> ${p.stock <= 0 ? `<span class="badge">${t('outOfStock')}</span>` : p.stock <= p.lowStock ? `<span class="badge warn">${t('low')}</span>` : ''}</td>
    <td class="n" style="white-space:nowrap"><button class="btn sm" data-s="${p.id}">＋ ${t('updateStock')}</button> <button class="btn sec sm" data-e="${p.id}">${t('edit')}</button></td></tr>`).join('')}</tbody></table></div>`;
  el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => productForm(S.products.find(p => p.id === +b.dataset.e)));
  el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => stockForm(S.products.find(p => p.id === +b.dataset.s)));
}
function modal(html, wide) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box ${wide ? 'wide' : ''}">${html}</div>`;
  m.addEventListener('mousedown', e => { if (e.target === m) m.remove(); });
  document.body.appendChild(m); return m;
}
function productForm(p) {
  const m = modal(`<h3>${p ? t('editProduct') : t('addProduct')}</h3><form id="pf">
    <label>${t('nameEn')} *</label><input name="name" required value="${esc(p?.name)}" maxlength="80">
    <label>${t('nameMr')}</label><input name="nameMr" value="${esc(p?.nameMr)}" maxlength="80">
    <div class="row"><div><label>${t('price')} *</label><input name="price" type="number" min="0" step="any" required inputmode="decimal" value="${p?.price ?? ''}"></div>
    <div><label>${t('unit')}</label><input name="unit" value="${esc(p?.unit)}" maxlength="12"></div></div>
    <div class="row"><div><label>${t('openingStock')} *</label><input name="stock" type="number" min="0" step="1" required inputmode="numeric" value="${p?.stock ?? ''}"></div>
    <div><label>${t('lowStock')}</label><input name="lowStock" type="number" min="0" step="1" inputmode="numeric" value="${p?.lowStock ?? 10}"></div></div>
    <div class="row" style="margin-top:18px"><button class="btn">${t('save')}</button><button type="button" class="btn sec" data-c>${t('cancel')}</button>
    ${p ? `<button type="button" class="btn danger fit" data-del>${t('delete')}</button>` : ''}</div></form>`);
  m.querySelector('[data-c]').onclick = () => m.remove();
  const del = m.querySelector('[data-del]');
  if (del) del.onclick = guard(async () => { if (!confirm(t('confirmDelete'))) return; await api('DELETE', '/api/products/' + p.id); await refreshProducts(); m.remove(); });
  m.querySelector('#pf').onsubmit = guard(async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    await (p ? api('PUT', '/api/products/' + p.id, d) : api('POST', '/api/products', d));
    await refreshProducts(); m.remove(); toast(t('saved'));
  });
}
function stockForm(p) {
  let mode = 1;
  const m = modal(`<h3>${esc(p.name)}</h3><p class="mute" style="margin:4px 0 12px">${t('stock')}: <b style="color:var(--ink)">${p.stock}</b></p><form id="sf">
    <div class="seg"><button type="button" data-k="1" class="on">＋ ${t('addStock')}</button><button type="button" data-k="-1">− ${t('removeStock')}</button></div>
    <label>${t('quantity')}</label><input name="d" type="number" min="1" step="1" required inputmode="numeric" autofocus>
    <p class="mute" id="pv" style="margin:8px 0 0"></p>
    <div class="row" style="margin-top:16px"><button class="btn">${t('save')}</button><button type="button" class="btn sec" data-c>${t('cancel')}</button></div></form>`);
  const inp = m.querySelector('[name=d]'), pv = m.querySelector('#pv');
  const prev = () => { const n = Number(inp.value); pv.textContent = n > 0 ? `${t('newStock')}: ${p.stock + mode * n}` : ''; };
  inp.oninput = prev;
  m.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { mode = +b.dataset.k; m.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('on', x === b)); prev(); });
  m.querySelector('[data-c]').onclick = () => m.remove();
  m.querySelector('#sf').onsubmit = guard(async e => {
    e.preventDefault();
    await api('POST', `/api/products/${p.id}/stock`, { delta: mode * Number(inp.value) });
    await refreshProducts(); m.remove(); toast(t('saved'));
  });
  setTimeout(() => inp.focus(), 50);
}
async function refreshProducts() { S.products = await api('GET', '/api/products'); S.cart = S.cart.filter(i => S.products.some(p => p.id === i.productId)); renderApp(); }

// ---------------- records ----------------
function setRange(k) {
  const R = S.rec, d = new Date(); R.range = k;
  if (k === 'all') { R.from = R.to = ''; }
  else if (k === 'today') { R.from = R.to = todayStr(); }
  else if (k === 'yesterday') { d.setDate(d.getDate() - 1); R.from = R.to = localDate(d); }
  else if (k === 'month') { R.from = localDate(new Date(d.getFullYear(), d.getMonth(), 1)); R.to = todayStr(); }
}
async function viewRecords(v) {
  const R = S.rec;
  v.innerHTML = `<div class="pagehead"><h2>${t('records')}</h2></div><div class="card">
    <div class="chips" style="margin-bottom:6px">${[['today', 'today'], ['yesterday', 'yesterday'], ['month', 'thisMonth'], ['all', 'all']].map(([k, l]) => `<button class="chip ${R.range === k ? 'on' : ''}" data-r="${k}">${t(l)}</button>`).join('')}</div>
    <div class="row"><div><label>${t('from')}</label><input type="date" id="rf" value="${R.from}"></div>
    <div><label>${t('to')}</label><input type="date" id="rt" value="${R.to}"></div>
    <div style="flex:2"><label>${t('search')}</label><input id="rq" type="search" value="${esc(R.q)}"></div></div></div>
    <div id="rbody"><div class="empty">…</div></div>`;
  const reload = guard(drawRecords);
  v.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { setRange(b.dataset.r); viewRecords(v); });
  const custom = () => { R.range = ''; v.querySelectorAll('[data-r]').forEach(b => b.classList.remove('on')); reload(); };
  $('#rf').onchange = e => { R.from = e.target.value; custom(); };
  $('#rt').onchange = e => { R.to = e.target.value; custom(); };
  let tm; $('#rq').oninput = e => { R.q = e.target.value; clearTimeout(tm); tm = setTimeout(reload, 250); };
  reload();
}
async function drawRecords() {
  const R = S.rec, qs = new URLSearchParams({ from: R.from, to: R.to, q: R.q });
  const [sum, list] = await Promise.all([api('GET', '/api/summary?' + qs), api('GET', '/api/invoices?' + qs)]);
  const el = $('#rbody'); if (!el) return;
  const none = `<div class="empty"><span class="ico">🗂️</span>${t('noRecords')}</div>`;
  el.innerHTML = `<div class="kpis">
    <div class="kpi g"><small>${t('sales')}</small><b>₹${money(sum.sales)}</b></div>
    <div class="kpi"><small>${t('invoices')}</small><b>${sum.invoices}</b></div>
    <div class="kpi w"><small>${t('qtySold')}</small><b>${sum.qty}</b></div>
    <div class="kpi r"><small>${t('discount')}</small><b>₹${money(sum.discount)}</b></div></div>
    <div class="card"><h3>${t('history')}</h3>${list.length ? `<div class="table-wrap"><table><thead><tr><th>${t('billNo')}</th><th>${t('date')}</th><th>${t('customer')}</th><th class="n">${t('total')}</th><th></th></tr></thead><tbody>
      ${list.map(i => `<tr><td><b>${i.no}</b> ${i.status === 'void' ? `<span class="badge">${t('cancelled')}</span>` : ''}</td><td>${i.date}</td>
      <td>${esc(i.customer)}${i.phone ? `<div class="mute">${esc(i.phone)}</div>` : ''}</td>
      <td class="n" ${i.status === 'void' ? 'style="text-decoration:line-through;color:var(--mute)"' : ''}><b>₹${money(i.total)}</b></td>
      <td class="n" style="white-space:nowrap"><button class="btn sec sm" data-v="${i.id}">${t('view')}</button> <button class="btn sec sm" data-pdf="${i.id}" title="${t('pdf')}">⬇ PDF</button></td></tr>`).join('')}</tbody></table></div>` : none}</div>
    <div class="grid cols2">
    <div class="card"><h3>${t('daily')}</h3>${sum.days.length ? `<div class="table-wrap"><table><thead><tr><th>${t('date')}</th><th class="n">${t('invoices')}</th><th class="n">${t('qty')}</th><th class="n">${t('total')}</th></tr></thead><tbody>
      ${sum.days.map(d => `<tr><td>${d.date}</td><td class="n">${d.invoices}</td><td class="n">${d.qty}</td><td class="n"><b>₹${money(d.total)}</b></td></tr>`).join('')}</tbody></table></div>` : none}</div>
    <div class="card"><h3>${t('topItems')}</h3>${sum.products.length ? `<div class="table-wrap"><table><thead><tr><th>${t('product')}</th><th class="n">${t('qty')}</th><th class="n">${t('amount')}</th></tr></thead><tbody>
      ${sum.products.map(p => `<tr><td>${esc(S.lang === 'mr' && p.nameMr ? p.nameMr : p.name)}</td><td class="n">${p.qty}</td><td class="n">₹${money(p.amount)}</td></tr>`).join('')}</tbody></table></div>` : none}</div></div>`;
  const byId = Object.fromEntries(list.map(i => [i.id, i]));
  el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => showInvoice(byId[b.dataset.v]));
  el.querySelectorAll('[data-pdf]').forEach(b => b.onclick = guard(() => downloadPdf(byId[b.dataset.pdf])));
}

// ---------------- invoice / receipt ----------------
function receiptHTML(inv) {
  const s = S.settings, mr = S.lang === 'mr', w = s.paper === 58 ? 58 : 80;
  const L = (a, b, cls = '') => `<div class="line ${cls}"><span>${a}</span><span>${b}</span></div>`;
  const d = new Date(inv.createdAt);
  return `<div class="receipt w${w}">
    <div class="c sh">${esc(mr && s.shopNameMr ? s.shopNameMr : s.shopName)}</div>
    ${s.address ? `<div class="c">${esc(s.address)}</div>` : ''}${s.phone ? `<div class="c">☎ ${esc(s.phone)}</div>` : ''}
    <hr><div class="c b">${t('invoice')}</div>${inv.status === 'void' ? `<div class="void">${t('cancelled').toUpperCase()}</div>` : ''}
    ${L(t('billNo'), inv.no)}${L(t('date'), `${inv.date} ${d.toTimeString().slice(0, 5)}`)}
    ${L(t('customer'), esc(inv.customer))}${inv.phone ? L(t('phone'), esc(inv.phone)) : ''}
    <hr><table><tr><th>${t('product')}</th><th class="r">${t('qty')}</th><th class="r">${t('rate')}</th><th class="r">${t('amount')}</th></tr>
    ${inv.items.map(i => `<tr><td>${esc(mr && i.nameMr ? i.nameMr : i.name)}</td><td class="r">${i.qty}</td><td class="r">${money(i.rate)}</td><td class="r">${money(i.amount)}</td></tr>`).join('')}</table>
    <hr>${L(t('subtotal'), money(inv.subtotal))}
    ${inv.discount ? L(`${t('discount')}${inv.discountType === 'percent' ? ` (${inv.discountValue}%)` : ''}`, '-' + money(inv.discount)) : ''}
    ${inv.roundOff ? L(t('roundOff'), (inv.roundOff > 0 ? '+' : '-') + money(Math.abs(inv.roundOff))) : ''}
    <hr>${L(t('total'), '₹' + money(inv.total), 'b sh')}<hr>
    ${L(t('payment'), t(inv.payment))}${L(t('qty'), inv.items.reduce((a, i) => a + i.qty, 0))}
    <hr><div class="c">${esc(s.footer || '')}</div></div>`;
}
const fileBase = inv => (inv.customer || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || inv.no;

function showInvoice(inv, fresh) {
  const m = modal(`<div class="rwrap">${receiptHTML(inv)}</div>
    <div class="row"><button class="btn" data-p>🖨 ${t('print')}</button><button class="btn sec" data-d>⬇ ${t('pdf')}</button></div>
    <div class="row" style="margin-top:10px">
    ${inv.status === 'active' && !fresh ? `<button class="btn danger" data-v>${t('voidInv')}</button>` : ''}<button class="btn sec" data-c>${fresh ? t('newBill') : t('close')}</button></div>`, true);
  m.querySelector('[data-c]').onclick = () => m.remove();
  m.querySelector('[data-p]').onclick = () => printReceipt(inv);
  m.querySelector('[data-d]').onclick = guard(() => downloadPdf(inv));
  const vb = m.querySelector('[data-v]');
  if (vb) vb.onclick = guard(async () => {
    if (!confirm(t('voidConfirm'))) return;
    await api('POST', `/api/invoices/${inv.id}/void`); S.products = await api('GET', '/api/products');
    m.remove(); if (S.tab === 'records') drawRecords(); toast(t('done'));
  });
}
function printReceipt(inv) {
  const w = S.settings.paper === 58 ? 58 : 80, oldTitle = document.title;
  let st = $('#pageStyle'); if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.appendChild(st); }
  st.textContent = `@page{size:${w}mm auto;margin:0}`;
  $('#printArea').innerHTML = receiptHTML(inv);
  document.title = fileBase(inv); // "Save as PDF" in the print dialog uses the title as file name
  window.addEventListener('afterprint', () => { document.title = oldTitle; $('#printArea').innerHTML = ''; }, { once: true });
  setTimeout(() => window.print(), 50);
}
async function downloadPdf(inv) {
  if (!window.html2canvas || !window.jspdf) return toast(t('pdfFail'), true);
  const host = document.createElement('div'); host.className = 'offscreen'; host.innerHTML = receiptHTML(inv);
  document.body.appendChild(host);
  try {
    const canvas = await html2canvas(host.firstElementChild, { scale: 3, backgroundColor: '#fff' });
    const w = S.settings.paper === 58 ? 58 : 80, h = Math.max(30, w * canvas.height / canvas.width);
    const pdf = new jspdf.jsPDF({ unit: 'mm', format: [w, h], orientation: h > w ? 'p' : 'l' });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h);
    pdf.save(fileBase(inv) + '.pdf');
  } finally { host.remove(); }
}

// ---------------- settings ----------------
function viewSettings(v) {
  const s = S.settings;
  v.innerHTML = `<div class="pagehead"><h2>${t('settings')}</h2></div><div class="grid cols2"><section class="card"><h3>${t('shopDetails')}</h3><form id="sf">
    <label>${t('shopName')}</label><input name="shopName" value="${esc(s.shopName)}">
    <label>${t('shopNameMr')}</label><input name="shopNameMr" value="${esc(s.shopNameMr)}">
    <label>${t('address')}</label><input name="address" value="${esc(s.address)}">
    <div class="row"><div><label>${t('phone')}</label><input name="phone" value="${esc(s.phone)}"></div>
    <div><label>${t('paper')}</label><select name="paper"><option value="80" ${s.paper !== 58 ? 'selected' : ''}>80 mm</option><option value="58" ${s.paper === 58 ? 'selected' : ''}>58 mm</option></select></div></div>
    <label>${t('footer')}</label><input name="footer" value="${esc(s.footer)}">
    <div style="margin-top:18px"><button class="btn">${t('save')}</button></div></form></section>
    <section class="card"><h3>${t('security')}: ${esc(S.user.username)}</h3><form id="pf">
    <label>${t('current')}</label><input type="password" name="current" autocomplete="current-password" required>
    <label>${t('newPw')}</label><input type="password" name="next" autocomplete="new-password" minlength="6" required>
    <div style="margin-top:18px"><button class="btn">${t('savePw')}</button></div></form></section></div>`;
  $('#sf').onsubmit = guard(async e => {
    e.preventDefault();
    S.settings = await api('PUT', '/api/settings', Object.fromEntries(new FormData(e.target))); renderApp(); toast(t('saved'));
  });
  $('#pf').onsubmit = guard(async e => {
    e.preventDefault();
    await api('POST', '/api/password', Object.fromEntries(new FormData(e.target)));
    e.target.reset(); toast(t('saved'));
  });
}

init();
