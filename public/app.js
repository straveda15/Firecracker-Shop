'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const money = n => (+n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const S = {
  user: null, lang: (() => { try { return localStorage.getItem('lang') === 'mr' ? 'mr' : 'en'; } catch { return 'en'; } })(), tab: 'dashboard',
  products: [], settings: {},
  cart: [], customer: '', phone: '', discType: 'amount', discVal: '', payment: 'cash', 
  invQ: '', invF: 'all', recFrom: '', recTo: '',
};
const t = k => I18N[S.lang][k] ?? I18N.en[k] ?? k;
const pname = p => (S.lang === 'mr' && p.nameMr) || p.name; // products and invoice lines both carry name + nameMr
const shopTitle = () => (S.lang === 'mr' ? S.settings.shopNameMr : S.settings.shopName) || t('appName');

const ICONS = {
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  rupee: '<path d="M6 4h12M6 9h12M9 4h1c3.5 0 6 2 6 5s-2.5 5-6 5H9l7 6"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
};
const ico = (n, s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

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
  S.cart.forEach(c => { if (c.productId === p.id) c.rate = p.price; }); // bills always use the catalogue price
  S.products.sort((x, y) => x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
};
// disables the form's primary button while a request is running (no double submits, visible feedback)
const busy = async (e, fn) => {
  const b = e.target.querySelector('.btn:not(.sec):not(.danger)'), label = b.textContent;
  b.disabled = true; b.textContent = '...';
  try { await fn(); } finally { b.disabled = false; b.textContent = label; }
};
function setLang(l) { S.lang = l; try { localStorage.setItem('lang', l); } catch { /* storage blocked */ } document.documentElement.lang = l; renderApp(); }
const langSwitch = () => `<div class="lang" role="group" aria-label="${t('lang')}">${[['en', 'EN'], ['mr', 'मराठी']].map(([k, l]) => `<button type="button" data-lang="${k}" class="${S.lang === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const bindLang = root => root.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { if (b.dataset.lang !== S.lang) setLang(b.dataset.lang); });

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
      <div class="topr">${langSwitch()}<span class="who">${esc(S.user.username)}</span><button class="sbtn js-out" title="${t('logout')}" aria-label="${t('logout')}">${ico('logout', 17)}<span class="lt">${t('logout')}</span></button></div></header>
    <main id="view"></main>`;
  bindLang(app);
  app.querySelectorAll('.js-out').forEach(b => b.onclick = () => { setAuth(null); S.user = null; S.cart = []; renderApp(); });
  app.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { S.tab = b.dataset.t; renderApp(); });
  ({ dashboard: viewDashboard, billing: viewBilling, inventory: viewInventory, records: viewRecords })[S.tab]($('#view'));
}

// ---------------- dashboard ----------------
const inr = n => Math.round(n).toLocaleString('en-IN');
const locale = () => S.lang === 'mr' ? 'mr-IN-u-nu-latn' : 'en-IN'; // Marathi words, Western digits (matches the rest of the UI)
const kcard = (tone, icon, label, val, sub) => `<div class="kcard"><div class="kh"><small>${label}</small><span class="kico ${tone}">${ico(icon)}</span></div><b>${val}</b><span class="ksub">${sub || ''}</span></div>`;
const initial = s => ([...String(s || '?').trim()][0] || '?').toUpperCase();
async function viewDashboard(v) {
  const dateStr = new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const head = `<div class="pagehead"><div><h1 class="ptitle">${t('dashboard')}</h1><p class="psub">${dateStr}</p></div></div>`;
  v.innerHTML = head + `<div class="empty">...</div>`;
  const d = await api('GET', '/api/dashboard').catch(e => { toast(e.message, true); return null; });
  if (!d || S.tab !== 'dashboard') return;
  const max = Math.max(1, ...d.days.map(x => x.sales));
  const wd = s => new Date(s + 'T00:00:00Z').toLocaleDateString(locale(), { weekday: 'short', timeZone: 'UTC' });
  const weekSales = d.days.reduce((a, x) => a + x.sales, 0), weekOrders = d.days.reduce((a, x) => a + x.orders, 0);
  const none = `<div class="empty">${t('noActivity')}</div>`;
  v.innerHTML = head + `
    <div class="kcards">
      ${kcard('sky', 'receipt', t('todayOrders'), d.today.orders, dmy(d.today.date))}
      ${kcard('green', 'rupee', t('todaySales'), '₹' + inr(d.today.sales), d.today.orders ? `${t('avgOrder')} ₹${inr(d.today.sales / d.today.orders)}` : '')}
      ${kcard('violet', 'trend', t('totalSales'), '₹' + inr(d.totalSales), `${d.totalOrders} ${t('ordersWord')}`)}
      ${kcard('amber', 'box', t('totalStock'), d.totalStock, `${d.totalProducts} ${t('totalProducts').toLowerCase()}`)}
    </div>
    <section class="card chart">
      <div class="chead"><div><h2 class="ct">${t('last7')}</h2><p class="mute csub">${weekOrders ? `₹${inr(weekSales)} · ${weekOrders} ${t('ordersWord')}` : t('noOrdersWeek')}</p></div></div>
      <div class="plot"><div class="grid"><i></i><i></i><i></i><i></i></div>
        <div class="cols">${d.days.map((x, n) => {
          const p = Math.max(2, Math.round(x.sales / max * 86));
          return `<div class="col ${n === d.days.length - 1 ? 'now' : ''}" title="${dmy(x.date)}: ₹${money(x.sales)} · ${x.orders} ${t('ordersWord')}">
            <div class="track">${x.sales ? `<span class="bv" style="bottom:calc(${p}% + 6px)">₹${inr(x.sales)}</span><div class="bf" style="height:${p}%"></div>` : '<div class="bf zero"></div>'}</div>
            <span class="bl2">${wd(x.date)}</span><span class="bo">${x.orders} ${t('ordersWord')}</span></div>`;
        }).join('')}</div></div>
    </section>
    <div class="dash-cols">
      <section class="card"><div class="chead"><h2 class="ct">${t('recentOrders')}</h2></div>${d.orders.length ? `<ul class="rlist">${d.orders.map(o => {
        const names = o.items.slice(0, 2).map(it => `${esc(pname(it))} &times; ${it.qty}`).join(', '), extra = o.items.length - 2;
        return `<li><span class="av sky">${ico('receipt', 18)}</span><div class="rl"><b>${o.no} · ${esc(o.customer)}</b><div class="mute">${names}${extra > 0 ? ` +${extra} ${t('more')}` : ''} · ${dmy(o.date)}</div></div><b class="ramt">₹${money(o.total)}</b></li>`;
      }).join('')}</ul>` : none}</section>
      <section class="card"><div class="chead"><h2 class="ct">${t('recentCustomers')}</h2></div>${d.customers.length ? `<ul class="rlist">${d.customers.map(c =>
        `<li><span class="av green">${esc(initial(c.customer))}</span><div class="rl"><b>${esc(c.customer)}</b><div class="mute">${c.phone ? esc(c.phone) + ' · ' : ''}${dmy(c.date)} · ${c.no}</div></div><b class="ramt">₹${money(c.total)}</b></li>`).join('')}</ul>` : none}</section>
    </div>`;
}

const PROFILES = [['admin1', 'Admin 1'], ['admin2', 'Admin 2']];
function renderLogin(app) {
  let prof = (() => { try { return localStorage.getItem('profile'); } catch { return null; } })();
  if (!PROFILES.some(p => p[0] === prof)) prof = PROFILES[0][0];
  const name = shopTitle();
  app.innerHTML = `<div class="login-wrap"><div class="login-lang">${langSwitch()}</div><div class="login">
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
  bindLang(app);
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
  const subtotal = r2(filled().reduce((a, i) => a + i.qty * i.rate, 0));
  const dv = Math.max(0, Number(S.discVal) || 0);
  const discount = Math.min(subtotal, S.discType === 'percent' ? r2(subtotal * Math.min(dv, 100) / 100) : r2(dv));
  const raw = r2(subtotal - discount), total = Math.round(raw);
  return { subtotal, discount, roundOff: r2(total - raw), total };
}
const prod = id => S.products.find(x => x.id === +id);
const stepper = (u, val, max) => `<div class="stepper"><button type="button" data-lm="${u}" aria-label="&minus;">&minus;</button><input type="number" min="1" max="${max}" step="1" inputmode="numeric" data-lq="${u}" value="${val}" aria-label="${t('qty')}"><button type="button" data-lp="${u}" aria-label="+">+</button></div>`;

function viewBilling(v) {
  v.innerHTML = `<h1 class="ptitle">${t('billing')}</h1>
  <div class="bill-cols">
    <div class="bill-left">
      <section class="card"><h2 class="ct">${t('custDetails')}</h2>
        <div class="row"><div><label>${t('customer')} *</label><input id="cn" value="${esc(S.customer)}" maxlength="80" autocomplete="off"></div>
        <div><label>${t('phone')} <em>(${t('optional')})</em></label><input id="cp" inputmode="numeric" pattern="[0-9]*" value="${esc(S.phone)}" maxlength="10" placeholder="${t('phHint')}" autocomplete="off"></div></div></section>
      <section class="card"><div class="chead"><div><h2 class="ct">${t('billItems')}</h2><p class="mute csub">${t('addItemHint')}</p></div>
        <button type="button" class="plus" id="addLine" title="${t('addItem')}" aria-label="${t('addItem')}">${ico('plus', 22)}</button></div>
        <div id="lines"></div>
        <button type="button" class="addrow" id="addLine2">${ico('plus', 18)} ${t('addItem')}</button></section>
      <section class="card"><h2 class="ct">${t('payDisc')}</h2>
        <div class="row"><div><label>${t('discountOpt')}</label>
          <div class="disc"><input id="dv" type="number" min="0" step="any" inputmode="decimal" value="${esc(S.discVal)}">
          <div class="seg"><button type="button" data-d="amount">₹</button><button type="button" data-d="percent">%</button></div></div>
          <p class="mute dhint" id="dhint"></p></div>
          <div><label>${t('payment')}</label><select id="pay">${['cash', 'upi', 'card'].map(p => `<option value="${p}" ${S.payment === p ? 'selected' : ''}>${t(p)}</option>`).join('')}</select></div></div></section>
    </div>
    <aside class="bill-right billside card">
      <div class="chead"><h2 class="ct">${t('billPreview')}</h2><div class="seg fmt sm">${[['a4', 'A4'], ['80', '80 mm'], ['58', '58 mm']].map(([k, l]) => `<button type="button" data-pf="${k}">${l}</button>`).join('')}</div></div>
      <div class="pvwrap"><div id="pv"></div></div>
      <div id="tot" class="sums"></div>
      <button class="btn lg" id="gen">${t('generate')}</button>
      <div style="text-align:center;margin-top:8px"><button class="link" id="clr">${t('clear')}</button></div>
    </aside></div><button id="cartbar" type="button"></button>`;
  $('#cn').oninput = e => { e.target.value = S.customer = e.target.value.replace(/[^\p{L}\p{M} .'-]/gu, ''); drawPreview(); };
  $('#cp').oninput = e => { e.target.value = S.phone = e.target.value.replace(/\D/g, '').slice(0, 10); drawPreview(); };
  $('#addLine').onclick = $('#addLine2').onclick = addLine;
  $('#dv').oninput = e => { S.discVal = e.target.value; drawTotals(); };
  $('#pay').onchange = e => { S.payment = e.target.value; drawPreview(); };
  v.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.discType = b.dataset.d; drawSeg(); drawTotals(); });
  v.querySelectorAll('[data-pf]').forEach(b => b.onclick = () => { setFmt(b.dataset.pf); drawPreview(); });
  $('#clr').onclick = () => { resetBill(); viewBilling(v); };
  $('#gen').onclick = guard(generate);
  drawSeg(); drawLines(); drawTotals();
}
function resetBill() { Object.assign(S, { cart: [], customer: '', phone: '', discVal: '', discType: 'amount', payment: 'cash' }); }
function drawSeg() { document.querySelectorAll('[data-d]').forEach(b => b.classList.toggle('on', b.dataset.d === S.discType)); }

// ---- bill lines: "+" adds a row, each row has a product dropdown and a quantity ----
let lineSeq = 0;
const filled = () => S.cart.filter(i => i.productId && prod(i.productId)); // lines that have a product chosen
const lineOpts = line => S.products.map(p => {
  const taken = S.cart.some(x => x !== line && x.productId === p.id), out = p.stock <= 0;
  return `<option value="${p.id}" ${line.productId === p.id ? 'selected' : ''} ${taken || out ? 'disabled' : ''}>${esc(pname(p))} · ₹${money(p.price)}${p.unit ? ' / ' + esc(p.unit) : ''}${out ? ' · ' + t('outOfStock') : ''}</option>`;
}).join('');
function addLine() {
  let line = S.cart.find(x => !x.productId);
  if (!line) { line = { uid: ++lineSeq, productId: null, qty: 1, rate: 0 }; S.cart.push(line); }
  drawLines(); drawTotals();
  const sel = document.querySelector(`[data-ls="${line.uid}"]`); if (sel) { sel.focus(); sel.scrollIntoView({ block: 'nearest' }); }
}
function drawLines() {
  const el = $('#lines'); if (!el) return;
  if (!S.products.length) { el.innerHTML = `<div class="empty">${t('noProducts')}</div>`; return; }
  if (!S.cart.length) { el.innerHTML = `<div class="empty lempty">${t('emptyCart')}</div>`; return; }
  el.innerHTML = S.cart.map(i => {
    const p = i.productId && prod(i.productId);
    return `<div class="lrow ${p ? 'set' : ''}"><div class="lf"><select data-ls="${i.uid}" aria-label="${t('product')}"><option value="">${t('selectProduct')}</option>${lineOpts(i)}</select>
      ${p ? `<span class="pmeta">₹${money(p.price)}${p.unit ? ` / ${esc(p.unit)}` : ''} &middot; ${p.stock} ${t('inStock')}</span>` : ''}</div>
      <div class="lc">${p ? stepper(i.uid, i.qty, p.stock) : ''}<span class="pamt" id="amt${i.uid}">${p ? '₹' + money(i.qty * i.rate) : ''}</span>
      <button type="button" class="ib del" data-lx="${i.uid}" title="${t('removeItem')}" aria-label="${t('removeItem')}">${ico('trash', 17)}</button></div></div>`;
  }).join('');
  const line = u => S.cart.find(x => x.uid === +u);
  el.querySelectorAll('[data-ls]').forEach(sel => sel.onchange = () => {
    const i = line(sel.dataset.ls), p = prod(sel.value);
    if (p) { i.productId = p.id; i.rate = p.price; i.qty = Math.min(Math.max(1, i.qty), p.stock); } else { i.productId = null; i.rate = 0; }
    drawLines(); drawTotals();
  });
  el.querySelectorAll('[data-lx]').forEach(b => b.onclick = () => { S.cart = S.cart.filter(x => x.uid !== +b.dataset.lx); drawLines(); drawTotals(); });
  const setQty = (i, n, inp) => {
    const p = prod(i.productId);
    if (n > p.stock) { n = p.stock; toast(`${pname(p)}: ${t('stock')} ${p.stock}`, true); }
    i.qty = n; if (inp) inp.value = n;
    const a = $('#amt' + i.uid); if (a) a.textContent = '₹' + money(i.qty * i.rate);
    drawTotals();
  };
  el.querySelectorAll('[data-lm]').forEach(b => b.onclick = () => { const i = line(b.dataset.lm); setQty(i, Math.max(1, i.qty - 1), b.nextElementSibling); });
  el.querySelectorAll('[data-lp]').forEach(b => b.onclick = () => { const i = line(b.dataset.lp); setQty(i, i.qty + 1, b.previousElementSibling); });
  el.querySelectorAll('[data-lq]').forEach(inp => {
    const i = line(inp.dataset.lq);
    inp.oninput = () => { const n = Math.floor(Number(inp.value)); if (n >= 1) setQty(i, n, n > prod(i.productId).stock ? inp : null); };
    inp.onchange = () => setQty(i, Math.max(1, Math.floor(Number(inp.value)) || 1), inp);
  });
}
// the bill as it would be saved, built from the current cart (shown live in the preview)
function draftInvoice() {
  const c = calc(), now = new Date();
  return { no: t('draft'), date: now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), createdAt: now.toISOString(), status: 'active',
    customer: S.customer.trim() || '—', phone: S.phone, payment: S.payment, discountType: S.discType, discountValue: Number(S.discVal) || 0,
    subtotal: c.subtotal, discount: c.discount, roundOff: c.roundOff, total: c.total,
    items: filled().map(i => { const p = prod(i.productId); return { productId: i.productId, name: p.name, nameMr: p.nameMr || '', qty: i.qty, rate: i.rate, amount: r2(i.qty * i.rate) }; }) };
}
function drawPreview() {
  const el = $('#pv'); if (!el) return;
  el.innerHTML = docHTML(draftInvoice());
  document.querySelectorAll('[data-pf]').forEach(b => b.classList.toggle('on', b.dataset.pf === getFmt()));
  const node = el.firstElementChild;
  node.style.zoom = Math.min(1, el.clientWidth / node.offsetWidth); // scale the paper down to the panel width
}
// a discount can never exceed the bill amount (₹) or 100 (%)
function clampDiscount() {
  const sub = r2(filled().reduce((a, i) => a + i.qty * i.rate, 0)), pct = S.discType === 'percent', max = pct ? 100 : sub;
  const inp = $('#dv'), hint = $('#dhint');
  if (inp) inp.max = max;
  if (hint) hint.textContent = filled().length ? `${t('maxDisc')}: ${pct ? '100%' : '₹' + money(sub)}` : '';
  if (!filled().length || S.discVal === '') return;
  const dv = Number(S.discVal);
  if (dv < 0 || Number.isNaN(dv)) { S.discVal = ''; if (inp) inp.value = ''; }
  else if (dv > max) { S.discVal = String(max); if (inp) inp.value = S.discVal; toast(t('discTooHigh'), true); }
}
function drawTotals() {
  const el = $('#tot'); if (!el) return;
  clampDiscount();
  const bar = $('#cartbar'), n = filled().reduce((x, i) => x + i.qty, 0), c = calc();
  if (bar) { bar.className = n ? 'on' : ''; bar.innerHTML = `<span>${n} ${t('items')} &middot; <b>₹${money(c.total)}</b></span><span>${t('billPreview')} &rsaquo;</span>`; bar.onclick = () => $('.billside').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  el.innerHTML = (filled().length ? '' : `<p class="mute pvhint">${t('previewHint')}</p>`) +
    `<div class="tot big"><span>${t('total')} <small>(${n} ${t('items')})</small></span><span>₹${money(c.total)}</span></div>`;
  drawPreview();
}
async function generate() {
  const nm = S.customer.trim().replace(/\s+/g, ' ');
  if (!nm) { $('#cn').focus(); return toast(t('enterName'), true); }
  if (nm.length < 2 || !/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(nm)) { $('#cn').focus(); return toast(t('badName'), true); }
  if (S.phone && !/^[6-9]\d{9}$/.test(S.phone)) { $('#cp').focus(); return toast(t('badPhone'), true); }
  if (!filled().length) return toast(t('emptyCart'), true);
  if (calc().discount < (Number(S.discVal) || 0) && S.discType === 'amount') return toast(t('discTooHigh'), true);
  S.customer = nm;
  const btn = $('#gen'); btn.disabled = true;
  try {
    const inv = await api('POST', '/api/invoices', {
      customer: S.customer, phone: S.phone, payment: S.payment,
      discountType: S.discType, discountValue: Number(S.discVal) || 0,
      items: filled().map(i => ({ productId: i.productId, qty: i.qty })),
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
const stockState = p => p.stock <= 0 ? 'out' : p.stock <= p.lowStock ? 'low' : 'ok';
function viewInventory(v) {
  const P = S.products, low = P.filter(p => stockState(p) === 'low').length, out = P.filter(p => stockState(p) === 'out').length;
  const units = P.reduce((a, p) => a + p.stock, 0), value = P.reduce((a, p) => a + p.stock * p.price, 0);
  const chips = [['all', t('all'), P.length], ['low', t('low'), low], ['out', t('outOfStock'), out]];
  v.innerHTML = `<div class="pagehead"><h1 class="ptitle">${t('inventory')}</h1><button class="btn" id="add">+ ${t('addProduct')}</button></div>
    <div class="kcards c5">
      ${kcard('sky', 'box', t('totalProducts'), P.length, t('productsSub'))}
      ${kcard('violet', 'layers', t('unitsInStock'), units.toLocaleString('en-IN'), '')}
      ${kcard('green', 'rupee', t('stockValue'), '₹' + inr(value), t('valueSub'))}
      ${kcard('amber', 'alert', t('lowItems'), low, low ? t('needRestock') : '')}
      ${kcard('red', 'x', t('outItems'), out, out ? t('noneLeft') : '')}
    </div>
    <div class="tools"><div class="sbox">${ico('search', 18)}<input id="iq" type="search" placeholder="${t('searchInv')}" value="${esc(S.invQ)}" autocomplete="off"></div>
      <div class="chips">${chips.map(([k, l, n]) => `<button type="button" data-fc="${k}" class="${S.invF === k ? 'on' : ''}">${l} <span>${n}</span></button>`).join('')}</div></div>
    <div id="itab"></div>`;
  $('#add').onclick = () => productForm();
  $('#iq').oninput = e => { S.invQ = e.target.value; drawInvTable(); };
  v.querySelectorAll('[data-fc]').forEach(b => b.onclick = () => { S.invF = b.dataset.fc; v.querySelectorAll('[data-fc]').forEach(x => x.classList.toggle('on', x === b)); drawInvTable(); });
  drawInvTable();
}
function drawInvTable() {
  const el = $('#itab'), q = S.invQ.trim().toLowerCase();
  if (!S.products.length) { el.innerHTML = `<div class="empty">${t('noProducts')}</div>`; return; }
  const list = S.products.filter(p => (!q || (p.name + ' ' + (p.nameMr || '')).toLowerCase().includes(q)) && (S.invF === 'all' || stockState(p) === S.invF));
  if (!list.length) { el.innerHTML = `<div class="empty">${t('noMatch')}</div>`; return; }
  const tone = { ok: 'sky', low: 'amber', out: 'red' };
  el.innerHTML = `<div class="table-wrap"><table class="itable"><thead><tr><th>${t('product')}</th><th class="n">${t('price')}</th><th class="n">${t('stock')}</th><th class="n">${t('value')}</th><th></th></tr></thead><tbody>
    ${list.map(p => {
      const s = stockState(p), alt = S.lang === 'mr' ? p.name : p.nameMr;
      return `<tr><td><div class="pcell"><span class="av ${tone[s]}">${esc(initial(pname(p)))}</span><div><b>${esc(pname(p))}</b>${alt ? `<div class="mute">${esc(alt)}</div>` : ''}</div></div></td>
      <td class="n" data-l="${t('price')}">₹${money(p.price)}${p.unit ? ` <span class="mute">/ ${esc(p.unit)}</span>` : ''}</td>
      <td class="n" data-l="${t('stock')}"><b>${p.stock}</b> ${s === 'out' ? `<span class="badge">${t('outOfStock')}</span>` : s === 'low' ? `<span class="badge warn">${t('low')}</span>` : `<span class="badge ok">${t('inStockBadge')}</span>`}</td>
      <td class="n" data-l="${t('value')}">₹${money(p.stock * p.price)}</td>
      <td class="n"><div class="acts"><button class="btn sm" data-s="${p.id}">${t('updateStock')}</button>
        <button class="ib" data-e="${p.id}" title="${t('edit')}" aria-label="${t('edit')}">${ico('edit', 17)}</button>
        <button class="ib del" data-x="${p.id}" title="${t('deleteProduct')}" aria-label="${t('deleteProduct')}">${ico('trash', 17)}</button></div></td></tr>`;
    }).join('')}</tbody></table></div>`;
  el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => productForm(prod(b.dataset.e)));
  el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => stockForm(prod(b.dataset.s)));
  el.querySelectorAll('[data-x]').forEach(b => b.onclick = () => deleteProduct(prod(b.dataset.x)));
}
function modal(html, size) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box ${size || ''}">${html}</div>`;
  m.addEventListener('mousedown', e => { if (e.target === m) m.remove(); });
  document.body.appendChild(m); return m;
}
// in-app confirmation dialog; resolves true when the user confirms
const ask = (title, msg, okLabel) => new Promise(done => {
  const m = modal(`<h3>${esc(title)}</h3><p class="mute" style="margin:8px 0 20px">${esc(msg)}</p>
    <div class="row"><button class="btn danger solid" data-ok>${okLabel}</button><button class="btn sec" data-no>${t('cancel')}</button></div>`);
  m.addEventListener('mousedown', e => { if (e.target === m) done(false); });
  m.querySelector('[data-no]').onclick = () => { m.remove(); done(false); };
  m.querySelector('[data-ok]').onclick = () => { m.remove(); done(true); };
  m.querySelector('[data-no]').focus();
});
const deleteProduct = guard(async p => {
  if (!await ask(t('deleteProduct'), t('confirmDeleteNamed').replace('{n}', pname(p)), t('delete'))) return;
  await api('DELETE', '/api/products/' + p.id);
  S.products = S.products.filter(x => x.id !== p.id); S.cart = S.cart.filter(i => i.productId !== p.id);
  document.querySelectorAll('.modal').forEach(x => x.remove()); renderApp(); toast(t('deleted'));
});
function productForm(p) {
  const m = modal(`<h3>${p ? t('editProduct') : t('addProduct')}</h3><form id="pf">
    <div class="row"><div><label>${t('nameEn')} *</label><input name="name" required value="${esc(p?.name)}" maxlength="80"></div>
    <div><label>${t('nameMr')}</label><input name="nameMr" value="${esc(p?.nameMr)}" maxlength="80"></div></div>
    <div class="row"><div><label>${t('price')} *</label><input name="price" type="number" min="0" step="any" required inputmode="decimal" value="${p?.price ?? ''}"></div>
    <div><label>${t('unit')}</label><input name="unit" value="${esc(p?.unit)}" maxlength="12"></div></div>
    <div class="row"><div><label>${t('openingStock')} *</label><input name="stock" type="number" min="0" step="1" required inputmode="numeric" value="${p?.stock ?? ''}"></div>
    <div><label>${t('lowStock')}</label><input name="lowStock" type="number" min="0" step="1" inputmode="numeric" value="${p?.lowStock ?? 10}"></div></div>
    <div class="row" style="margin-top:20px"><button class="btn">${t('save')}</button><button type="button" class="btn sec" data-c>${t('cancel')}</button>
    ${p ? `<button type="button" class="btn danger fit" data-del>${t('delete')}</button>` : ''}</div></form>`, 'wide');
  m.querySelector('[data-c]').onclick = () => m.remove();
  const del = m.querySelector('[data-del]');
  if (del) del.onclick = () => deleteProduct(p);
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
  const m = modal(`<h3>${esc(pname(p))}</h3><p class="mute" style="margin:4px 0 14px">${t('stock')}: <b style="color:var(--ink)">${p.stock}</b></p><form id="sf">
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
const istDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const recPresets = () => {
  const today = istDate(), yest = istDate(new Date(Date.now() - 864e5));
  return [['all', t('all'), '', ''], ['today', t('today'), today, today], ['yest', t('yesterday'), yest, yest], ['month', t('thisMonth'), today.slice(0, 8) + '01', today]];
};
async function viewRecords(v) {
  const today = istDate();
  v.innerHTML = `<div class="pagehead"><h1 class="ptitle">${t('records')}</h1></div>
    <div class="card filters"><div class="chips" id="rchips">${recPresets().map(([k, l]) => `<button type="button" data-rp="${k}">${l}</button>`).join('')}</div>
      <div class="fl"><label for="rf">${t('from')}</label><input type="date" id="rf" max="${today}" value="${S.recFrom}"></div>
      <div class="fl"><label for="rt">${t('to')}</label><input type="date" id="rt" max="${today}" value="${S.recTo}"></div></div>
    <div id="rbody"><div class="empty">...</div></div>`;
  const sync = () => {
    $('#rf').value = S.recFrom; $('#rt').value = S.recTo;
    $('#rt').min = S.recFrom || ''; $('#rf').max = S.recTo || today;
    const cur = recPresets().find(([, , f, t2]) => f === S.recFrom && t2 === S.recTo);
    v.querySelectorAll('[data-rp]').forEach(b => b.classList.toggle('on', !!cur && b.dataset.rp === cur[0]));
  };
  const load = () => { sync(); return guard(drawRecords)(); };
  v.querySelectorAll('[data-rp]').forEach(b => b.onclick = () => { const [, , f, t2] = recPresets().find(x => x[0] === b.dataset.rp); S.recFrom = f; S.recTo = t2; load(); });
  $('#rf').onchange = e => { S.recFrom = e.target.value; if (S.recFrom && S.recTo && S.recFrom > S.recTo) { S.recTo = S.recFrom; toast(t('dateRangeErr'), true); } load(); };
  $('#rt').onchange = e => { S.recTo = e.target.value; if (S.recFrom && S.recTo && S.recFrom > S.recTo) { S.recFrom = S.recTo; toast(t('dateRangeErr'), true); } load(); };
  await load();
}
async function drawRecords() {
  const qs = new URLSearchParams({ from: S.recFrom, to: S.recTo });
  const [sum, list] = await Promise.all([api('GET', '/api/summary?' + qs), api('GET', '/api/invoices?' + qs)]);
  const el = $('#rbody'); if (!el) return;
  el.innerHTML = `<div class="kcards c3">
    ${kcard('green', 'rupee', t('sales'), '₹' + inr(sum.sales), '')}
    ${kcard('sky', 'receipt', t('invoices'), sum.invoices, '')}
    ${kcard('violet', 'box', t('qtySold'), sum.qty, '')}</div>
    <h2 class="sh">${t('orders')}</h2>
    ${list.length ? `<div class="table-wrap"><table class="rec"><thead><tr><th>${t('billNo')}</th><th>${t('date')}</th><th>${t('customer')}</th><th>${t('orderDetails')}</th><th class="n">${t('total')}</th><th></th></tr></thead><tbody>
      ${list.map(i => `<tr><td><b>${i.no}</b>${i.status === 'void' ? `<div><span class="badge">${t('cancelled')}</span></div>` : ''}</td><td style="white-space:nowrap">${i.date.split('-').reverse().join('-')}</td>
      <td>${esc(i.customer)}${i.phone ? `<div class="mute">${esc(i.phone)}</div>` : ''}</td>
      <td class="od">${i.items.map(it => `<div>${esc(pname(it))} <span class="mute">&times; ${it.qty} @ ${money(it.rate)}</span></div>`).join('')}${i.discount ? `<div class="mute">${t('discount')}: &minus; ${money(i.discount)}</div>` : ''}</td>
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
      <div><div class="inv-co">${esc(shopTitle())}</div>${s.address ? esc(s.address) + '<br>' : ''}${s.phone ? t('ph') + ': ' + esc(s.phone) : ''}</div>
      <table class="inv-meta"><tr><td><b>${t('invNo')}:</b></td><td>${inv.no}</td></tr><tr><td><b>${t('invDate')}:</b></td><td>${dmy(inv.date)}</td></tr>
      <tr><td><b>${t('payMode')}:</b></td><td>${t(inv.payment)}</td></tr></table></div>
    <table class="inv-t inv-bill"><tr><td><b>${t('billTo')}:</b><br>${esc(inv.customer)}${inv.phone ? '<br>' + t('ph') + ': ' + esc(inv.phone) : ''}</td></tr></table>
    <table class="inv-t inv-items"><thead><tr><th style="width:7%">${t('sr')}</th><th>${t('desc')}</th><th style="width:10%">${t('qty')}</th><th style="width:14%">${t('rate')} (₹)</th><th style="width:17%">${t('amount')} (₹)</th></tr></thead><tbody>
      ${inv.items.map((i, n) => `<tr><td class="c">${n + 1}</td><td>${esc(pname(i))}</td><td class="c">${i.qty}</td><td class="r">${money(i.rate)}</td><td class="r">${money(i.amount)}</td></tr>`).join('')}
      <tr class="pad"><td></td><td></td><td></td><td></td><td></td></tr></tbody></table>
    <table class="inv-t inv-foot"><tr><td class="inv-words"><b>${t('words')}:</b><br>Rupees ${words(inv.total)} Only${terms.length ? `<br><br><b>${t('terms')}:</b><br>${terms.map((x, n) => `${n + 1}. ${esc(x)}`).join('<br>')}` : ''}</td>
      <td class="inv-sums"><table>
        <tr><td>${t('subtotal')} (${qty} ${t('qty')})</td><td class="r">${money(inv.subtotal)}</td></tr>
        ${inv.discount ? `<tr><td>${t('discount')}${inv.discountType === 'percent' ? ` (${inv.discountValue}%)` : ''}</td><td class="r">- ${money(inv.discount)}</td></tr>` : ''}
        ${inv.roundOff ? `<tr><td>${t('roundOff')}</td><td class="r">${inv.roundOff > 0 ? '+' : '-'} ${money(Math.abs(inv.roundOff))}</td></tr>` : ''}
        <tr class="grand"><td>${t('grand')}</td><td class="r">₹ ${money(inv.total)}</td></tr></table></td></tr></table>
    <table class="inv-t inv-sign"><tr><td>${t('custSign')}</td><td class="r">${t('forShop')} <b>${esc(shopTitle())}</b><br><br><br>${t('authSign')}</td></tr></table>
    <div class="inv-note">${t('computerGen')}</div></div>`;
}
const fileBase = inv => (inv.customer || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || inv.no;

// ---- thermal receipt (58 / 80 mm rolls) ----
function receiptHTML(inv, w) {
  const s = S.settings, d = new Date(inv.createdAt), time = isNaN(d) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const L = (x, y, cls = '') => `<div class="line ${cls}"><span>${x}</span><span>${y}</span></div>`;
  const terms = termsText().split('\n').map(x => x.trim()).filter(Boolean);
  return `<div class="receipt w${w}">
    <div class="c sh">${esc(shopTitle())}</div>
    ${s.address ? `<div class="c">${esc(s.address)}</div>` : ''}${s.phone ? `<div class="c">${t('ph')}: ${esc(s.phone)}</div>` : ''}
    <hr><div class="c b">${t('invoice')}</div>${inv.status === 'void' ? `<div class="void">${t('cancelled').toUpperCase()}</div>` : ''}
    ${L(t('billNo'), inv.no)}${L(t('date'), dmy(inv.date))}${time ? L(t('time'), time) : ''}
    ${L(t('customer'), esc(inv.customer))}${inv.phone ? L(t('ph'), esc(inv.phone)) : ''}
    <hr>${L(t('product'), t('amount'), 'b')}
    ${inv.items.map(i => `<div class="it"><div class="in">${esc(pname(i))}</div>${L(`${i.qty} &times; ${money(i.rate)}`, money(i.amount))}</div>`).join('')}
    <hr>${L(t('subtotal'), money(inv.subtotal))}
    ${inv.discount ? L(`${t('discount')}${inv.discountType === 'percent' ? ` (${inv.discountValue}%)` : ''}`, '-' + money(inv.discount)) : ''}
    ${inv.roundOff ? L(t('roundOff'), (inv.roundOff > 0 ? '+' : '-') + money(Math.abs(inv.roundOff))) : ''}
    <hr>${L(t('total'), '₹' + money(inv.total), 'b sh')}<hr>
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
