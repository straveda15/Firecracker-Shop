'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const money = n => (+n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const S = {
  user: null, lang: 'en', tab: 'dashboard',
  products: [], settings: {},
  cart: [], customer: '', phone: '', discType: 'amount', discVal: '', payment: 'cash', q: '',
  invQ: '', recDate: '',
};
const t = k => I18N[S.lang][k] ?? I18N.en[k] ?? k;
const pname = p => p.name;
const shopTitle = () => S.settings.shopName || t('appName');

const getAuth = () => { try { return localStorage.getItem('auth'); } catch { return null; } };
const setAuth = v => { try { v ? localStorage.setItem('auth', v) : localStorage.removeItem('auth'); } catch { /* storage blocked */ } };
const makeAuth = (u, p) => btoa(unescape(encodeURIComponent(u.toLowerCase().trim() + ':' + p)));

async function api(method, url, body) {
  const headers = body ? { 'Content-Type': 'application/json' } : {}, auth = getAuth();
  if (auth) headers.Authorization = 'Basic ' + auth;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (data === null) throw new Error('Server error: the API did not return data. Check the deployment and MongoDB settings.');
  if (res.status === 401 && url !== '/api/login' && url !== '/api/me' && url !== '/api/bootstrap') { S.user = null; setAuth(null); renderApp(); throw new Error(data.error || 'Login required'); }
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
  try { applyBoot(await api('GET', '/api/bootstrap')); } catch (e) { S.user = null; if (!/log/i.test(e.message)) setTimeout(() => toast(e.message, true), 100); }
  renderApp();
}
const applyBoot = d => { S.user = { username: d.username, name: d.name }; S.products = d.products; S.settings = d.settings; };
const upsertProduct = p => {
  const i = S.products.findIndex(x => x.id === p.id);
  if (i >= 0) S.products[i] = p; else S.products.push(p);
  S.products.sort((x, y) => x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
};
// disables the form's primary button while a request is running (no double submits, visible feedback)
const busy = async (e, fn) => {
  const b = e.target.querySelector('.btn:not(.sec):not(.danger)'), label = b.textContent;
  b.disabled = true; b.textContent = '...';
  try { await fn(); } finally { b.disabled = false; b.textContent = label; }
};
function setLang(l) { S.lang = l; localStorage.setItem('lang', l); document.documentElement.lang = l; renderApp(); }
const otherLang = () => S.lang === 'en' ? 'मराठी' : 'English';

const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.9 10.9 0 0 1 12 19c-7 0-11-7-11-7a19.8 19.8 0 0 1 5.06-5.94M9.9 4.24A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a19.9 19.9 0 0 1-3.17 4.19M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22"/></svg>';
const pwField = attrs => `<div class="pw"><input type="password" ${attrs}><button type="button" class="eye" aria-label="Show / hide password">${EYE}</button></div>`;
document.addEventListener('click', e => {
  const b = e.target.closest('.eye'); if (!b) return;
  const i = b.parentElement.querySelector('input'), show = i.type === 'password';
  i.type = show ? 'text' : 'password'; b.innerHTML = show ? EYE_OFF : EYE;
});

const spark = (x, y) => `<g transform="translate(${x} ${y})"><path d="M0-3v-3M0 3v3M-3 0h-3M3 0h3M-2.1-2.1l-2-2M2.1-2.1l2-2M-2.1 2.1l-2 2M2.1 2.1l2 2" stroke-width="1.3"/></g>`;
const CRACKER_BODY = `<g transform="translate(34 30) rotate(45)"><path d="M-7-10h14L0-23z"/><rect x="-7" y="-10" width="14" height="22"/><path d="M-7-5q3.5-3 7 0t7 0M-7 0q3.5-3 7 0t7 0M-7 5q3.5-3 7 0t7 0"/><rect x="-2.5" y="12" width="5" height="19" rx="2.5"/></g><path d="M21 33Q15 28 12 29M30 43Q36 50 29 55"/>${spark(8, 28)}${spark(27, 58)}`;
const CRACKER = `<svg viewBox="0 0 64 64" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${CRACKER_BODY}</svg>`;
(() => { const l = document.createElement('link'); l.rel = 'icon'; l.href = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#0c3b5a" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">${CRACKER_BODY}</svg>`); document.head.appendChild(l); })();
const TABS = [['dashboard', 'dashboard'], ['billing', 'billing'], ['inventory', 'inventory'], ['records', 'records']];
function renderApp() {
  const app = $('#app');
  document.title = S.user ? shopTitle() : t('appName');
  if (!S.user) return renderLogin(app);
  const tabBtns = TABS.map(([k, l]) => `<button data-t="${k}" class="${S.tab === k ? 'on' : ''}">${t(l)}</button>`).join('');
  app.innerHTML = `
    <header class="top"><div class="brand"><span class="brand-ico">${CRACKER}</span><span class="brand-name">${esc(shopTitle())}</span></div>
      <nav class="topnav">${tabBtns}</nav>
      <div class="topr"><span class="who">${esc(S.user.username)}</span><button class="sbtn js-out">${t('logout')}</button></div></header>
    <main id="view"></main>`;
  app.querySelectorAll('.js-out').forEach(b => b.onclick = () => { setAuth(null); S.user = null; S.cart = []; renderApp(); });
  app.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { S.tab = b.dataset.t; renderApp(); });
  ({ dashboard: viewDashboard, billing: viewBilling, inventory: viewInventory, records: viewRecords })[S.tab]($('#view'));
}

// ---------------- dashboard ----------------
const inr = n => Math.round(n).toLocaleString('en-IN');
async function viewDashboard(v) {
  v.innerHTML = `<h1 class="ptitle">${t('dashboard')}</h1><div class="empty">...</div>`;
  const d = await api('GET', '/api/dashboard').catch(e => { toast(e.message, true); return null; });
  if (!d || S.tab !== 'dashboard') return;
  const max = Math.max(1, ...d.days.map(x => x.sales));
  const wd = s => new Date(s + 'T00:00:00Z').toLocaleDateString(S.lang === 'mr' ? 'mr-IN' : 'en-IN', { weekday: 'short', timeZone: 'UTC' });
  const card = (k, val, sub) => `<div class="stat"><small>${t(k)}</small><b>${val}</b>${sub ? `<span class="mute">${sub}</span>` : ''}</div>`;
  const none = `<div class="empty">${t('noActivity')}</div>`;
  v.innerHTML = `<h1 class="ptitle">${t('dashboard')}</h1>
    <div class="stats">${card('todayOrders', d.today.orders)}${card('todaySales', '₹' + inr(d.today.sales))}
      ${card('totalSales', '₹' + inr(d.totalSales), `${d.totalOrders} ${t('ordersWord')}`)}${card('totalStock', d.totalStock, `${d.totalProducts} ${t('totalProducts').toLowerCase()}`)}</div>
    <h2 class="sh">${t('last7')}</h2>
    <div class="bars">${d.days.map(x => `<div class="bar" title="${dmy(x.date)}: ${x.orders} ${t('ordersWord')}">
      <span class="bv">₹${money(x.sales).replace(/\.00$/, '')}</span><div class="bf" style="height:${Math.max(3, Math.round(x.sales / max * 100))}%"></div>
      <span class="bl2">${wd(x.date)}</span><span class="bo mute">${x.orders} ${t('ordersWord')}</span></div>`).join('')}</div>
    <div class="dash-cols">
      <section><h2 class="sh">${t('recentProducts')}</h2>${d.products.length ? `<ul class="rlist">${d.products.map(p =>
        `<li><div><b>${esc(p.name)}</b><div class="mute">${esc(p.customer)} · ${dmy(p.date)}</div></div><span class="pill">&times; ${p.qty}</span></li>`).join('')}</ul>` : none}</section>
      <section><h2 class="sh">${t('recentCustomers')}</h2>${d.customers.length ? `<ul class="rlist">${d.customers.map(c =>
        `<li><div><b>${esc(c.customer)}</b><div class="mute">${c.phone ? esc(c.phone) + ' · ' : ''}${dmy(c.date)} · ${c.no}</div></div><b>₹${money(c.total)}</b></li>`).join('')}</ul>` : none}</section>
    </div>`;
}

const PROFILES = [['admin1', 'Admin 1'], ['admin2', 'Admin 2']];
function renderLogin(app) {
  let prof = (() => { try { return localStorage.getItem('profile'); } catch { return null; } })();
  if (!PROFILES.some(p => p[0] === prof)) prof = PROFILES[0][0];
  const name = S.settings.shopName || t('appName');
  app.innerHTML = `<div class="login-wrap"><div class="login">
    <div class="login-logo">${CRACKER}</div>
    <h1>${esc(name)}</h1><p class="sub">${t('welcome')}</p>
    <div class="profiles">${PROFILES.map(([k, l]) => `<button type="button" data-u="${k}">${l}</button>`).join('')}</div>
    <form id="f" class="login-card"><label>${t('password')}</label>${pwField('id="p" autocomplete="current-password" required')}
      <button class="btn lg">${t('login')} (<span id="who"></span>)</button></form>
    <p class="login-note">${t('authOnly')}</p></div></div>`;
  const pick = k => {
    prof = k; try { localStorage.setItem('profile', k); } catch { /* storage blocked */ }
    app.querySelectorAll('[data-u]').forEach(b => b.classList.toggle('on', b.dataset.u === k));
    $('#who').textContent = PROFILES.find(p => p[0] === k)[1];
  };
  app.querySelectorAll('[data-u]').forEach(b => b.onclick = () => { pick(b.dataset.u); $('#p').focus(); });
  pick(prof);
  $('#f').onsubmit = guard(async e => {
    e.preventDefault();
    const pw = $('#p').value;
    await busy(e, async () => {
      const d = await api('POST', '/api/login', { username: prof, password: pw });
      setAuth(makeAuth(prof, pw));
      applyBoot(d); renderApp();
    });
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
  v.innerHTML = `<h1 class="ptitle">${t('billing')}</h1>
  <div class="bill-cols">
    <div class="bill-left">
      <h2 class="sh">${t('custDetails')}</h2>
      <div class="row"><div><label>${t('customer')} *</label><input id="cn" value="${esc(S.customer)}" maxlength="80" autocomplete="off"></div>
      <div><label>${t('phone')} <em>(${t('optional')})</em></label><input id="cp" inputmode="numeric" pattern="[0-9]*" value="${esc(S.phone)}" maxlength="10" placeholder="10-digit" autocomplete="off"></div></div>
      <h2 class="sh" style="margin-top:28px">${t('allProducts')}</h2>
      <input id="ps" type="search" placeholder="${t('searchProduct')}" value="${esc(S.q)}" autocomplete="off">
      <div id="plist"></div>
    </div>
    <aside class="bill-right billside"><h2 class="sh">${t('currentBill')}</h2><div id="cart"></div><div id="tot" class="sums"></div>
      <div class="row" style="margin-top:16px"><div><label>${t('discountOpt')}</label>
        <div class="disc"><input id="dv" type="number" min="0" step="any" inputmode="decimal" value="${esc(S.discVal)}">
        <div class="seg"><button type="button" data-d="amount">₹</button><button type="button" data-d="percent">%</button></div></div></div>
        <div><label>${t('payment')}</label><select id="pay">${['cash', 'upi', 'card'].map(p => `<option value="${p}" ${S.payment === p ? 'selected' : ''}>${t(p)}</option>`).join('')}</select></div></div>
      <div style="margin-top:18px"><button class="btn lg" id="gen">${t('generate')}</button></div>
      <div style="text-align:center;margin-top:10px"><button class="link" id="clr">${t('clear')}</button></div>
    </aside></div><button id="cartbar" type="button"></button>`;
  $('#cn').oninput = e => { e.target.value = S.customer = e.target.value.replace(/[^\p{L}\p{M} .'-]/gu, ''); };
  $('#cp').oninput = e => { e.target.value = S.phone = e.target.value.replace(/\D/g, '').slice(0, 10); };
  $('#ps').oninput = e => { S.q = e.target.value; drawList(); };
  $('#dv').oninput = e => { S.discVal = e.target.value; drawTotals(); };
  $('#pay').onchange = e => S.payment = e.target.value;
  v.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.discType = b.dataset.d; drawSeg(); drawTotals(); });
  $('#clr').onclick = () => { resetBill(); viewBilling(v); };
  $('#gen').onclick = guard(generate);
  drawSeg(); drawList(); drawCart(); drawTotals();
}
function resetBill() { Object.assign(S, { cart: [], customer: '', phone: '', discVal: '', discType: 'amount', payment: 'cash', q: '' }); }
function drawSeg() { document.querySelectorAll('[data-d]').forEach(b => b.classList.toggle('on', b.dataset.d === S.discType)); }

function drawList() {
  const el = $('#plist'); if (!el) return;
  if (!S.products.length) { el.innerHTML = `<div class="empty">${t('noProducts')}</div>`; return; }
  const q = S.q.trim().toLowerCase();
  const list = S.products.filter(p => !q || p.name.toLowerCase().includes(q));
  el.innerHTML = `<div class="plist">${list.map(p => {
    const inBill = S.cart.find(i => i.productId === p.id);
    return `<div class="prow ${p.stock <= 0 ? 'off' : ''}"><div class="pn"><b>${esc(pname(p))}</b>${inBill ? `<span class="inb">${inBill.qty} ${t('inBill')}</span>` : ''}</div>
      <div class="pp">₹${money(p.price)}${p.unit ? `<small> / ${esc(p.unit)}</small>` : ''}</div>
      <div class="ps">${p.stock <= 0 ? `<span class="badge">${t('outOfStock')}</span>` : `${p.stock} ${t('inStock')}`}</div>
      <button class="btn sm sec" data-id="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>${t('add')}</button></div>`;
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
  drawList(); drawCart(); drawTotals();
}
function drawCart() {
  const el = $('#cart'); if (!el) return;
  if (!S.cart.length) { el.innerHTML = `<div class="empty">${t('emptyCart')}</div>`; return; }
  el.innerHTML = S.cart.map((i, n) => {
    const p = S.products.find(x => x.id === i.productId);
    return `<div class="bl"><div class="bl-top"><b>${esc(pname(p))}</b><button class="xbtn" data-x="${i.productId}" aria-label="remove">&times;</button></div>
      <div class="bl-calc">
        <div class="rate-box">₹<input type="number" min="0" step="any" inputmode="decimal" data-n="${n}" data-f="rate" value="${i.rate}"></div>
        <span class="op">&times;</span>
        <div class="stepper"><button data-m="${i.productId}">&minus;</button><input type="number" min="1" max="${p.stock}" step="1" inputmode="numeric" data-n="${n}" data-f="qty" value="${i.qty}"><button data-p="${i.productId}">+</button></div>
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
    const i = S.cart[+inp.dataset.n]; if (i.qty < 1) changeQty(i.productId, -1); else drawList();
  });
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => changeQty(+b.dataset.m, -1));
  el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => changeQty(+b.dataset.p, 1));
  el.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { S.cart = S.cart.filter(x => x.productId !== +b.dataset.x); drawList(); drawCart(); drawTotals(); });
}
function drawTotals() {
  const el = $('#tot'); if (!el) return;
  const bar = $('#cartbar'), n = S.cart.reduce((x, i) => x + i.qty, 0);
  if (bar) { bar.className = n ? 'on' : ''; bar.innerHTML = `<span>${n} ${t('items')} &middot; <b>₹${money(calc().total)}</b></span><span>${t('currentBill')} &rsaquo;</span>`; bar.onclick = () => $('.billside').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  const c = calc(), line = (k, val) => `<div class="tot"><span>${k}</span><span>${val}</span></div>`;
  el.innerHTML = line(`${t('subtotal')} (${n} ${t('items')})`, '₹' + money(c.subtotal)) +
    (c.discount ? line(t('discount') + (S.discType === 'percent' ? ` (${Number(S.discVal)}%)` : ''), '&minus; ₹' + money(c.discount)) : '') +
    (c.roundOff ? line(t('roundOff'), (c.roundOff > 0 ? '+ ' : '&minus; ') + '₹' + money(Math.abs(c.roundOff))) : '') +
    `<div class="tot big"><span>${t('total')}</span><span>₹${money(c.total)}</span></div>`;
}
async function generate() {
  const nm = S.customer.trim().replace(/\s+/g, ' ');
  if (!nm) { $('#cn').focus(); return toast(t('enterName'), true); }
  if (nm.length < 2 || !/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(nm)) { $('#cn').focus(); return toast(t('badName'), true); }
  if (S.phone && !/^[6-9]\d{9}$/.test(S.phone)) { $('#cp').focus(); return toast(t('badPhone'), true); }
  S.customer = nm;
  const btn = $('#gen'); btn.disabled = true;
  try {
    const inv = await api('POST', '/api/invoices', {
      customer: S.customer, phone: S.phone, payment: S.payment,
      discountType: S.discType, discountValue: Number(S.discVal) || 0,
      items: S.cart.map(i => ({ productId: i.productId, qty: i.qty, rate: i.rate })),
    });
    inv.items.forEach(it => { const p = S.products.find(x => x.id === it.productId); if (p) p.stock -= it.qty; });
    resetBill(); renderApp(); toast(t('billCreated') + ' ' + inv.no);
    showInvoice(inv, true);
  } catch (e) {
    if (/stock|Unknown product/i.test(e.message)) S.products = await api('GET', '/api/products').catch(() => S.products);
    throw e;
  } finally { btn.disabled = false; }
}

// ---------------- inventory ----------------
function viewInventory(v) {
  const P = S.products;
  const low = P.filter(p => p.stock <= p.lowStock).length, value = P.reduce((a, p) => a + p.stock * p.price, 0);
  v.innerHTML = `<div class="pagehead"><h1 class="ptitle">${t('inventory')}</h1><button class="btn" id="add">+ ${t('addProduct')}</button></div>
    <div class="kpis"><div class="kpi"><small>${t('totalProducts')}</small><b>${P.length}</b></div>
      <div class="kpi"><small>${t('lowItems')}</small><b>${low}</b></div>
      <div class="kpi"><small>${t('stockValue')}</small><b>₹${money(value)}</b></div></div>
    <input id="iq" type="search" placeholder="${t('searchInv')}" value="${esc(S.invQ)}" style="max-width:420px"><div id="itab"></div>`;
  $('#add').onclick = () => productForm();
  $('#iq').oninput = e => { S.invQ = e.target.value; drawInvTable(); };
  drawInvTable();
}
function drawInvTable() {
  const el = $('#itab'), q = S.invQ.trim().toLowerCase();
  const list = S.products.filter(p => !q || p.name.toLowerCase().includes(q));
  if (!list.length) { el.innerHTML = `<div class="empty">${t('noProducts')}</div>`; return; }
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>${t('product')}</th><th class="n">${t('price')}</th><th class="n">${t('stock')}</th><th></th></tr></thead><tbody>
    ${list.map(p => `<tr><td><b>${esc(p.name)}</b></td>
    <td class="n">₹${money(p.price)}${p.unit ? ` <span class="mute">/ ${esc(p.unit)}</span>` : ''}</td>
    <td class="n"><b>${p.stock}</b> ${p.stock <= 0 ? `<span class="badge">${t('outOfStock')}</span>` : p.stock <= p.lowStock ? `<span class="badge warn">${t('low')}</span>` : ''}</td>
    <td class="n" style="white-space:nowrap"><button class="btn sm" data-s="${p.id}">${t('updateStock')}</button> <button class="btn sec sm" data-e="${p.id}">${t('edit')}</button></td></tr>`).join('')}</tbody></table></div>`;
  el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => productForm(S.products.find(p => p.id === +b.dataset.e)));
  el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => stockForm(S.products.find(p => p.id === +b.dataset.s)));
}
function modal(html, size) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box ${size || ''}">${html}</div>`;
  m.addEventListener('mousedown', e => { if (e.target === m) m.remove(); });
  document.body.appendChild(m); return m;
}
function productForm(p) {
  const m = modal(`<h3>${p ? t('editProduct') : t('addProduct')}</h3><form id="pf">
    <label>${t('productName')} *</label><input name="name" required value="${esc(p?.name)}" maxlength="80">
    <div class="row"><div><label>${t('price')} *</label><input name="price" type="number" min="0" step="any" required inputmode="decimal" value="${p?.price ?? ''}"></div>
    <div><label>${t('unit')}</label><input name="unit" value="${esc(p?.unit)}" maxlength="12"></div></div>
    <div class="row"><div><label>${t('openingStock')} *</label><input name="stock" type="number" min="0" step="1" required inputmode="numeric" value="${p?.stock ?? ''}"></div>
    <div><label>${t('lowStock')}</label><input name="lowStock" type="number" min="0" step="1" inputmode="numeric" value="${p?.lowStock ?? 10}"></div></div>
    <div class="row" style="margin-top:20px"><button class="btn">${t('save')}</button><button type="button" class="btn sec" data-c>${t('cancel')}</button>
    ${p ? `<button type="button" class="btn danger fit" data-del>${t('delete')}</button>` : ''}</div></form>`);
  m.querySelector('[data-c]').onclick = () => m.remove();
  const del = m.querySelector('[data-del]');
  if (del) del.onclick = guard(async () => { if (!confirm(t('confirmDelete'))) return; await api('DELETE', '/api/products/' + p.id); S.products = S.products.filter(x => x.id !== p.id); S.cart = S.cart.filter(i => i.productId !== p.id); m.remove(); renderApp(); });
  m.querySelector('#pf').onsubmit = guard(async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    await busy(e, async () => {
      upsertProduct(await (p ? api('PUT', '/api/products/' + p.id, d) : api('POST', '/api/products', d)));
      m.remove(); renderApp(); toast(t('saved'));
    });
  });
}
function stockForm(p) {
  let mode = 1;
  const m = modal(`<h3>${esc(p.name)}</h3><p class="mute" style="margin:4px 0 14px">${t('stock')}: <b style="color:var(--ink)">${p.stock}</b></p><form id="sf">
    <div class="seg"><button type="button" data-k="1" class="on">${t('addStock')}</button><button type="button" data-k="-1">${t('removeStock')}</button></div>
    <label>${t('quantity')}</label><input name="d" type="number" min="1" step="1" required inputmode="numeric" autofocus>
    <p class="mute" id="pv" style="margin:8px 0 0"></p>
    <div class="row" style="margin-top:18px"><button class="btn">${t('save')}</button><button type="button" class="btn sec" data-c>${t('cancel')}</button></div></form>`);
  const inp = m.querySelector('[name=d]'), pv = m.querySelector('#pv');
  const prev = () => { const n = Number(inp.value); pv.textContent = n > 0 ? `${t('newStock')}: ${p.stock + mode * n}` : ''; };
  inp.oninput = prev;
  m.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { mode = +b.dataset.k; m.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('on', x === b)); prev(); });
  m.querySelector('[data-c]').onclick = () => m.remove();
  m.querySelector('#sf').onsubmit = guard(async e => {
    e.preventDefault();
    await busy(e, async () => {
      upsertProduct(await api('POST', `/api/products/${p.id}/stock`, { delta: mode * Number(inp.value) }));
      m.remove(); renderApp(); toast(t('saved'));
    });
  });
  setTimeout(() => inp.focus(), 50);
}

// ---------------- records ----------------
async function viewRecords(v) {
  v.innerHTML = `<div class="pagehead"><h1 class="ptitle">${t('records')}</h1>
    <div class="datef"><label for="rd">${t('date')}</label><input type="date" id="rd" value="${S.recDate}"><button class="link" id="rall" ${S.recDate ? '' : 'hidden'}>${t('showAll')}</button></div></div>
    <div id="rbody"><div class="empty">...</div></div>`;
  $('#rd').onchange = e => { S.recDate = e.target.value; viewRecords(v); };
  $('#rall').onclick = () => { S.recDate = ''; viewRecords(v); };
  await guard(drawRecords)();
}
async function drawRecords() {
  const qs = new URLSearchParams({ from: S.recDate, to: S.recDate });
  const [sum, list] = await Promise.all([api('GET', '/api/summary?' + qs), api('GET', '/api/invoices?' + qs)]);
  const el = $('#rbody'); if (!el) return;
  el.innerHTML = `<div class="kpis">
    <div class="kpi"><small>${t('sales')}</small><b>₹${money(sum.sales)}</b></div>
    <div class="kpi"><small>${t('invoices')}</small><b>${sum.invoices}</b></div>
    <div class="kpi"><small>${t('qtySold')}</small><b>${sum.qty}</b></div></div>
    <h2 class="sh">${t('orders')}</h2>
    ${list.length ? `<div class="table-wrap"><table class="rec"><thead><tr><th>${t('billNo')}</th><th>${t('date')}</th><th>${t('customer')}</th><th>${t('orderDetails')}</th><th class="n">${t('total')}</th><th></th></tr></thead><tbody>
      ${list.map(i => `<tr><td><b>${i.no}</b>${i.status === 'void' ? `<div><span class="badge">${t('cancelled')}</span></div>` : ''}</td><td style="white-space:nowrap">${i.date.split('-').reverse().join('-')}</td>
      <td>${esc(i.customer)}${i.phone ? `<div class="mute">${esc(i.phone)}</div>` : ''}</td>
      <td class="od">${i.items.map(it => `<div>${esc(it.name)} <span class="mute">&times; ${it.qty} @ ${money(it.rate)}</span></div>`).join('')}${i.discount ? `<div class="mute">${t('discount')}: &minus; ${money(i.discount)}</div>` : ''}</td>
      <td class="n" ${i.status === 'void' ? 'style="text-decoration:line-through;color:var(--mute)"' : ''}><b>₹${money(i.total)}</b></td>
      <td class="n" style="white-space:nowrap"><button class="btn sec sm" data-v="${i.id}">${t('view')}</button> <button class="btn sec sm" data-prt="${i.id}">${t('print')}</button> <button class="btn sec sm" data-pdf="${i.id}">PDF</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${t('noRecords')}</div>`}`;
  const byId = Object.fromEntries(list.map(i => [i.id, i]));
  el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => showInvoice(byId[b.dataset.v]));
  el.querySelectorAll('[data-prt]').forEach(b => b.onclick = () => printInvoice(byId[b.dataset.prt]));
  el.querySelectorAll('[data-pdf]').forEach(b => b.onclick = guard(() => downloadPdf(byId[b.dataset.pdf])));
}

// ---------------- invoice (A4, same layout as the mock invoice) ----------------
const DEFAULT_TERMS = 'Goods once sold will not be taken back or exchanged.\nStore in a cool, dry place away from fire.';
const termsText = () => S.settings.terms ?? DEFAULT_TERMS;
const dmy = d => d.split('-').reverse().join('-');
function words(n) {
  n = Math.round(n); if (n <= 0) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = x => x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : '');
  const three = x => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  const parts = [[Math.floor(n / 1e7), 'Crore'], [Math.floor(n / 1e5) % 100, 'Lakh'], [Math.floor(n / 1e3) % 100, 'Thousand']];
  let s = parts.filter(([v]) => v).map(([v, l]) => three(v) + ' ' + l).join(' ');
  if (n % 1000) s += (s ? ' ' : '') + three(n % 1000);
  return s;
}
function invoiceHTML(inv) {
  const s = S.settings, qty = inv.items.reduce((x, i) => x + i.qty, 0);
  const terms = termsText().split('\n').map(x => x.trim()).filter(Boolean);
  return `<div class="inv">
    <div class="inv-title">${t('invoice')}</div>${inv.status === 'void' ? `<div class="inv-void">${t('cancelled').toUpperCase()}</div>` : ''}
    <div class="inv-box inv-top">
      <div><div class="inv-co">${esc(s.shopName || t('appName'))}</div>${s.address ? esc(s.address) + '<br>' : ''}${s.phone ? t('ph') + ': ' + esc(s.phone) : ''}</div>
      <table class="inv-meta"><tr><td><b>${t('invNo')}:</b></td><td>${inv.no}</td></tr><tr><td><b>${t('invDate')}:</b></td><td>${dmy(inv.date)}</td></tr>
      <tr><td><b>${t('payMode')}:</b></td><td>${t(inv.payment)}</td></tr></table></div>
    <table class="inv-t inv-bill"><tr><td><b>${t('billTo')}:</b><br>${esc(inv.customer)}${inv.phone ? '<br>' + t('ph') + ': ' + esc(inv.phone) : ''}</td></tr></table>
    <table class="inv-t inv-items"><thead><tr><th style="width:7%">${t('sr')}</th><th>${t('desc')}</th><th style="width:10%">${t('qty')}</th><th style="width:14%">${t('rate')} (₹)</th><th style="width:17%">${t('amount')} (₹)</th></tr></thead><tbody>
      ${inv.items.map((i, n) => `<tr><td class="c">${n + 1}</td><td>${esc(i.name)}</td><td class="c">${i.qty}</td><td class="r">${money(i.rate)}</td><td class="r">${money(i.amount)}</td></tr>`).join('')}
      <tr class="pad"><td></td><td></td><td></td><td></td><td></td></tr></tbody></table>
    <table class="inv-t inv-foot"><tr><td class="inv-words"><b>${t('words')}:</b><br>Rupees ${words(inv.total)} Only${terms.length ? `<br><br><b>${t('terms')}:</b><br>${terms.map((x, n) => `${n + 1}. ${esc(x)}`).join('<br>')}` : ''}</td>
      <td class="inv-sums"><table>
        <tr><td>${t('subtotal')} (${qty} ${t('qty')})</td><td class="r">${money(inv.subtotal)}</td></tr>
        ${inv.discount ? `<tr><td>${t('discount')}${inv.discountType === 'percent' ? ` (${inv.discountValue}%)` : ''}</td><td class="r">- ${money(inv.discount)}</td></tr>` : ''}
        ${inv.roundOff ? `<tr><td>${t('roundOff')}</td><td class="r">${inv.roundOff > 0 ? '+' : '-'} ${money(Math.abs(inv.roundOff))}</td></tr>` : ''}
        <tr class="grand"><td>${t('grand')}</td><td class="r">₹ ${money(inv.total)}</td></tr></table></td></tr></table>
    <table class="inv-t inv-sign"><tr><td>${t('custSign')}</td><td class="r">${t('forShop')} <b>${esc(s.shopName || t('appName'))}</b><br><br><br>${t('authSign')}</td></tr></table>
    <div class="inv-note">${t('computerGen')}</div></div>`;
}
const fileBase = inv => (inv.customer || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || inv.no;

// ---- thermal receipt (58 / 80 mm rolls) ----
function receiptHTML(inv, w) {
  const s = S.settings, d = new Date(inv.createdAt);
  const L = (x, y, cls = '') => `<div class="line ${cls}"><span>${x}</span><span>${y}</span></div>`;
  const terms = termsText().split('\n').map(x => x.trim()).filter(Boolean);
  return `<div class="receipt w${w}">
    <div class="c sh">${esc(s.shopName || t('appName'))}</div>
    ${s.address ? `<div class="c">${esc(s.address)}</div>` : ''}${s.phone ? `<div class="c">${t('ph')}: ${esc(s.phone)}</div>` : ''}
    <hr><div class="c b">${t('invoice')}</div>${inv.status === 'void' ? `<div class="void">${t('cancelled').toUpperCase()}</div>` : ''}
    ${L(t('invNo'), inv.no)}${L(t('invDate'), `${dmy(inv.date)} ${d.toTimeString().slice(0, 5)}`)}
    ${L(t('customer'), esc(inv.customer))}${inv.phone ? L(t('ph'), esc(inv.phone)) : ''}
    <hr><table><tr><th>${t('product')}</th><th class="r">${t('qty')}</th><th class="r">${t('rate')}</th><th class="r">${t('amount')}</th></tr>
    ${inv.items.map(i => `<tr><td>${esc(i.name)}</td><td class="r">${i.qty}</td><td class="r">${money(i.rate)}</td><td class="r">${money(i.amount)}</td></tr>`).join('')}</table>
    <hr>${L(t('subtotal'), money(inv.subtotal))}
    ${inv.discount ? L(`${t('discount')}${inv.discountType === 'percent' ? ` (${inv.discountValue}%)` : ''}`, '-' + money(inv.discount)) : ''}
    ${inv.roundOff ? L(t('roundOff'), (inv.roundOff > 0 ? '+' : '-') + money(Math.abs(inv.roundOff))) : ''}
    <hr>${L(t('grand'), '₹' + money(inv.total), 'b sh')}<hr>
    ${L(t('payMode'), t(inv.payment))}
    ${terms.length ? `<hr><div>${terms.map(x => esc(x)).join('<br>')}</div>` : ''}
    <hr><div class="c">${t('thanks')}</div></div>`;
}
const getFmt = () => { try { return localStorage.getItem('fmt') || 'a4'; } catch { return 'a4'; } };
const setFmt = v => { try { localStorage.setItem('fmt', v); } catch { /* storage blocked */ } };
const docHTML = inv => { const f = getFmt(); return f === 'a4' ? invoiceHTML(inv) : receiptHTML(inv, +f); };

function showInvoice(inv, fresh) {
  const fmtBtns = [['a4', 'A4'], ['80', '80 mm'], ['58', '58 mm']].map(([k, l]) => `<button type="button" data-f="${k}">${l}</button>`).join('');
  const m = modal(`<div class="seg fmt">${fmtBtns}</div>
    <div class="rwrap"></div>
    <div class="row"><button class="btn" data-p>${t('print')}</button><button class="btn sec" data-d>${t('pdf')}</button></div>
    <p class="mute hint">${t('printHelp')}</p>
    <div class="row" style="margin-top:10px">
    ${inv.status === 'active' && !fresh ? `<button class="btn danger" data-v>${t('voidInv')}</button>` : ''}<button class="btn sec" data-c>${fresh ? t('newBill') : t('close')}</button></div>`, 'inv');
  const wrap = m.querySelector('.rwrap');
  const draw = () => {
    wrap.innerHTML = docHTML(inv);
    m.querySelectorAll('[data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === getFmt()));
    const el = wrap.firstElementChild;
    el.style.zoom = Math.min(1, (wrap.clientWidth - 16) / el.offsetWidth); // shrink to fit small screens
  };
  m.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { setFmt(b.dataset.f); draw(); });
  draw();
  m.querySelector('[data-c]').onclick = () => m.remove();
  m.querySelector('[data-p]').onclick = () => printInvoice(inv);
  m.querySelector('[data-d]').onclick = guard(() => downloadPdf(inv));
  const vb = m.querySelector('[data-v]');
  if (vb) vb.onclick = guard(async () => {
    if (!confirm(t('voidConfirm'))) return;
    await api('POST', `/api/invoices/${inv.id}/void`); S.products = await api('GET', '/api/products');
    m.remove(); if (S.tab === 'records') drawRecords(); toast(t('done'));
  });
}
function printInvoice(inv) {
  const oldTitle = document.title, f = getFmt();
  let st = $('#pageStyle'); if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.appendChild(st); }
  st.textContent = f === 'a4' ? '@page{size:A4;margin:0}' : `@page{size:${f}mm auto;margin:0}`; // thermal: roll width, height follows the content
  $('#printArea').innerHTML = docHTML(inv);
  document.title = fileBase(inv); // "Save as PDF" in the print dialog uses the title as file name
  window.addEventListener('afterprint', () => { document.title = oldTitle; $('#printArea').innerHTML = ''; }, { once: true });
  setTimeout(() => window.print(), 50);
}
async function downloadPdf(inv) {
  if (!window.html2canvas || !window.jspdf) return toast(t('pdfFail'), true);
  const f = getFmt(), host = document.createElement('div'); host.className = 'offscreen'; host.innerHTML = docHTML(inv);
  document.body.appendChild(host);
  try {
    const canvas = await html2canvas(host.firstElementChild, { scale: f === 'a4' ? 2 : 3, backgroundColor: '#fff' });
    if (f === 'a4') {
      const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'p' });
      const W = 210, H = 297, h = W * canvas.height / canvas.width, img = canvas.toDataURL('image/jpeg', 0.95);
      for (let y = 0, pg = 0; y < h - 0.5; y += H, pg++) { if (pg) pdf.addPage(); pdf.addImage(img, 'JPEG', 0, -y, W, h); }
      pdf.save(fileBase(inv) + '.pdf');
    } else {
      const w = +f, h = Math.max(30, w * canvas.height / canvas.width);
      const pdf = new jspdf.jsPDF({ unit: 'mm', format: [w, h], orientation: h > w ? 'p' : 'l' });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h);
      pdf.save(fileBase(inv) + '.pdf');
    }
  } finally { host.remove(); }
}

init();
