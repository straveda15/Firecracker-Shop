'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const money = n => (+n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => localDate(new Date());

const S = {
  user: null, lang: localStorage.getItem('lang') || 'en', tab: 'billing',
  products: [], settings: {}, plainPw: false,
  cart: [], customer: '', phone: '', discType: 'amount', discVal: '', gst: false, payment: 'cash', q: '',
  rec: { from: todayStr(), to: todayStr(), q: '' },
};
const t = k => I18N[S.lang][k] ?? I18N.en[k] ?? k;
const pname = p => (S.lang === 'mr' && p.nameMr) ? p.nameMr : p.name;

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login' && url !== '/api/me') { S.user = null; renderApp(); throw new Error(data.error || 'Login required'); }
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}
let toastT;
function toast(msg, err) {
  const el = $('#toast'); el.textContent = msg; el.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => el.className = '', 2600);
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

// ---------------- app shell ----------------
async function init() {
  document.documentElement.lang = S.lang;
  try { S.user = await api('GET', '/api/me'); } catch { S.user = null; }
  if (S.user) await loadBase();
  renderApp();
}
async function loadBase() {
  [S.products, S.settings] = await Promise.all([api('GET', '/api/products'), api('GET', '/api/settings')]);
}
function setLang(l) { S.lang = l; localStorage.setItem('lang', l); document.documentElement.lang = l; renderApp(); }

function renderApp() {
  const app = $('#app');
  if (!S.user) return renderLogin(app);
  const tabs = [['billing', '🧾'], ['inventory', '📦'], ['records', '📊'], ['settings', '⚙️']];
  app.innerHTML = `
    <header><div class="title">🧨 ${esc(S.lang === 'mr' && S.settings.shopNameMr ? S.settings.shopNameMr : S.settings.shopName || t('appName'))}</div>
      <button id="lg">${S.lang === 'en' ? 'मराठी' : 'English'}</button>
      <button id="lo">${t('logout')}</button></header>
    <nav>${tabs.map(([k, i]) => `<button data-t="${k}" class="${S.tab === k ? 'on' : ''}"><span>${i}</span>${t(k)}</button>`).join('')}</nav>
    <main id="view"></main>`;
  $('#lg').onclick = () => setLang(S.lang === 'en' ? 'mr' : 'en');
  $('#lo').onclick = guard(async () => { await api('POST', '/api/logout'); S.user = null; S.cart = []; renderApp(); });
  app.querySelectorAll('nav button').forEach(b => b.onclick = () => { S.tab = b.dataset.t; renderApp(); });
  ({ billing: viewBilling, inventory: viewInventory, records: viewRecords, settings: viewSettings })[S.tab]($('#view'));
}

function renderLogin(app) {
  app.innerHTML = `<div class="login card"><h2>🧨 ${t('appName')}</h2>
    <form id="f"><label>${t('username')}</label><input id="u" autocomplete="username" autocapitalize="none" required>
    <label>${t('password')}</label><input id="p" type="password" autocomplete="current-password" required>
    <div style="margin-top:14px" class="row"><button class="btn">${t('login')}</button>
    <button type="button" class="btn sec fit" id="lg">${S.lang === 'en' ? 'मराठी' : 'English'}</button></div></form></div>`;
  $('#lg').onclick = () => setLang(S.lang === 'en' ? 'mr' : 'en');
  $('#f').onsubmit = guard(async e => {
    e.preventDefault();
    const pw = $('#p').value;
    S.user = await api('POST', '/api/login', { username: $('#u').value, password: pw });
    S.plainPw = ['admin123', 'staff123'].includes(pw);
    await loadBase(); renderApp();
    if (S.plainPw) toast(t('defaultPwWarn'));
  });
}

// ---------------- billing ----------------
function calc() {
  const subtotal = r2(S.cart.reduce((a, i) => a + i.qty * i.rate, 0));
  const dv = Math.max(0, Number(S.discVal) || 0);
  const discount = Math.min(subtotal, S.discType === 'percent' ? r2(subtotal * Math.min(dv, 100) / 100) : r2(dv));
  const taxable = r2(subtotal - discount);
  const rate = S.gst && S.settings.gstEnabled ? +S.settings.gstRate || 0 : 0;
  const gst = r2(taxable * rate / 100), raw = r2(taxable + gst), total = Math.round(raw);
  return { subtotal, discount, taxable, gst, rate, roundOff: r2(total - raw), total };
}

function viewBilling(v) {
  const gstOn = S.settings.gstEnabled;
  v.innerHTML = `<div class="grid cols2">
    <section class="card"><h3>${t('customer')}</h3>
      <div class="row"><div><input id="cn" placeholder="${t('customer')}" value="${esc(S.customer)}" maxlength="80"></div>
      <div><input id="cp" placeholder="${t('phone')}" inputmode="tel" value="${esc(S.phone)}" maxlength="20"></div></div>
      <label>${t('product')}</label><input id="ps" placeholder="${t('searchProduct')}" value="${esc(S.q)}" autocomplete="off">
      <div id="res"></div></section>
    <section class="card"><h3>${t('cart')}</h3><div id="cart"></div>
      <div id="tot"></div>
      <div class="row" style="margin-top:10px"><div><label>${t('discount')}</label>
        <div class="row" style="flex-wrap:nowrap"><input id="dv" type="number" min="0" step="any" inputmode="decimal" value="${esc(S.discVal)}">
        <div class="seg fit"><button type="button" data-d="amount">₹</button><button type="button" data-d="percent">%</button></div></div></div>
        <div><label>${t('payment')}</label><select id="pay">${['cash', 'upi', 'card'].map(p => `<option value="${p}" ${S.payment === p ? 'selected' : ''}>${t(p)}</option>`).join('')}</select></div></div>
      <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="gst" style="width:auto;min-height:0" ${S.gst && gstOn ? 'checked' : ''} ${gstOn ? '' : 'disabled'}>
        ${t('applyGst')} ${gstOn ? `(${esc(S.settings.gstRate)}%)` : `<span class="mute">— ${t('gstNote')}</span>`}</label>
      <div class="row" style="margin-top:12px"><button class="btn" id="gen">${t('generate')}</button><button class="btn sec fit" id="clr">${t('clear')}</button></div>
    </section></div>`;
  $('#cn').oninput = e => S.customer = e.target.value;
  $('#cp').oninput = e => S.phone = e.target.value;
  $('#ps').oninput = e => { S.q = e.target.value; drawResults(); };
  $('#dv').oninput = e => { S.discVal = e.target.value; drawTotals(); };
  $('#pay').onchange = e => S.payment = e.target.value;
  $('#gst').onchange = e => { S.gst = e.target.checked; drawTotals(); };
  v.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.discType = b.dataset.d; drawSeg(); drawTotals(); });
  $('#clr').onclick = () => { resetBill(); viewBilling(v); };
  $('#gen').onclick = guard(generate);
  drawSeg(); drawResults(); drawCart(); drawTotals();
}
function resetBill() { Object.assign(S, { cart: [], customer: '', phone: '', discVal: '', discType: 'amount', gst: false, payment: 'cash', q: '' }); }
function drawSeg() { document.querySelectorAll('[data-d]').forEach(b => b.classList.toggle('on', b.dataset.d === S.discType)); }

function drawResults() {
  const el = $('#res'); if (!el) return;
  const q = S.q.trim().toLowerCase();
  const list = S.products.filter(p => !q || (p.name + ' ' + p.nameMr).toLowerCase().includes(q)).slice(0, 30);
  if (!S.products.length) { el.innerHTML = `<div class="empty">${t('noProducts')}</div>`; return; }
  el.innerHTML = `<div class="results">${list.map(p => `<div data-id="${p.id}" class="${p.stock <= 0 ? 'dis' : ''}">
    <span>${esc(pname(p))}</span><span class="mute">₹${money(p.price)} · ${p.stock <= 0 ? t('outOfStock') : t('stock') + ': ' + p.stock}</span></div>`).join('')}</div>`;
  el.querySelectorAll('[data-id]').forEach(d => d.onclick = () => addToCart(+d.dataset.id));
}
function addToCart(id) {
  const p = S.products.find(x => x.id === id); if (!p || p.stock <= 0) return;
  const ex = S.cart.find(i => i.productId === id);
  if (ex) { if (ex.qty < p.stock) ex.qty++; else toast(t('stock') + ': ' + p.stock, true); }
  else S.cart.push({ productId: id, qty: 1, rate: p.price });
  drawCart(); drawTotals();
}
function drawCart() {
  const el = $('#cart'); if (!el) return;
  if (!S.cart.length) { el.innerHTML = `<div class="empty">${t('emptyCart')}</div>`; return; }
  el.innerHTML = `<div class="table-wrap"><table><tr><th>${t('product')}</th><th>${t('qty')}</th><th>${t('rate')}</th><th class="n">${t('amount')}</th><th></th></tr>
    ${S.cart.map((i, n) => { const p = S.products.find(x => x.id === i.productId); return `<tr>
      <td>${esc(pname(p))}<div class="mute" style="font-size:12px">${t('stock')}: ${p.stock}</div></td>
      <td><input class="qty-in" type="number" min="1" max="${p.stock}" step="1" inputmode="numeric" data-n="${n}" data-f="qty" value="${i.qty}"></td>
      <td><input class="rate-in" type="number" min="0" step="any" inputmode="decimal" data-n="${n}" data-f="rate" value="${i.rate}"></td>
      <td class="n" id="amt${n}">${money(i.qty * i.rate)}</td>
      <td><button class="btn danger sm" data-x="${n}" aria-label="remove">✕</button></td></tr>`; }).join('')}</table></div>`;
  el.querySelectorAll('input[data-n]').forEach(inp => inp.oninput = () => {
    const i = S.cart[+inp.dataset.n], p = S.products.find(x => x.id === i.productId);
    let val = Number(inp.value);
    if (inp.dataset.f === 'qty') { val = Math.floor(val) || 0; if (val > p.stock) { val = p.stock; inp.value = val; toast(t('stock') + ': ' + p.stock, true); } }
    i[inp.dataset.f] = val;
    $('#amt' + inp.dataset.n).textContent = money(i.qty * i.rate); drawTotals();
  });
  el.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { S.cart.splice(+b.dataset.x, 1); drawCart(); drawTotals(); });
}
function drawTotals() {
  const el = $('#tot'); if (!el) return;
  const c = calc(), line = (k, v) => `<div class="tot"><span>${k}</span><span>${v}</span></div>`;
  el.innerHTML = line(t('subtotal'), '₹' + money(c.subtotal)) +
    (c.discount ? line(t('discount'), '− ₹' + money(c.discount)) : '') +
    (c.rate ? line(`${t('gst')} ${c.rate}%`, '+ ₹' + money(c.gst)) : '') +
    (c.roundOff ? line(t('roundOff'), (c.roundOff > 0 ? '+ ' : '− ') + '₹' + money(Math.abs(c.roundOff))) : '') +
    `<div class="tot big"><span>${t('total')}</span><span>₹${money(c.total)}</span></div>`;
}
async function generate() {
  const btn = $('#gen'); btn.disabled = true;
  try {
    const inv = await api('POST', '/api/invoices', {
      customer: S.customer, phone: S.phone, payment: S.payment, gstApplied: S.gst,
      discountType: S.discType, discountValue: Number(S.discVal) || 0,
      items: S.cart.map(i => ({ productId: i.productId, qty: i.qty, rate: i.rate })),
    });
    S.products = await api('GET', '/api/products');
    resetBill(); renderApp(); toast(t('billCreated') + ' ' + inv.no);
    showInvoice(inv, true);
  } finally { btn.disabled = false; }
}

// ---------------- inventory ----------------
function viewInventory(v) {
  const rows = S.products.map(p => `<tr><td>${esc(p.name)}${p.nameMr ? `<div class="mute">${esc(p.nameMr)}</div>` : ''}</td>
    <td class="n">₹${money(p.price)}${p.unit ? `<div class="mute">/ ${esc(p.unit)}</div>` : ''}</td>
    <td class="n">${p.stock} ${p.stock <= 0 ? `<span class="badge">${t('outOfStock')}</span>` : p.stock <= p.lowStock ? `<span class="badge warn">${t('low')}</span>` : ''}</td>
    <td class="n" style="white-space:nowrap"><button class="btn sec sm" data-s="${p.id}">± ${t('stock')}</button>
    <button class="btn sec sm" data-e="${p.id}">${t('edit')}</button></td></tr>`).join('');
  v.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h3 style="flex:1">${t('inventory')}</h3><button class="btn fit" id="add">+ ${t('addProduct')}</button></div>
    ${S.products.length ? `<div class="table-wrap"><table><tr><th>${t('product')}</th><th class="n">${t('price')}</th><th class="n">${t('stock')}</th><th></th></tr>${rows}</table></div>` : `<div class="empty">${t('noProducts')}</div>`}</div>`;
  $('#add').onclick = () => productForm();
  v.querySelectorAll('[data-e]').forEach(b => b.onclick = () => productForm(S.products.find(p => p.id === +b.dataset.e)));
  v.querySelectorAll('[data-s]').forEach(b => b.onclick = () => stockForm(S.products.find(p => p.id === +b.dataset.s)));
}
function modal(html, wide) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box ${wide ? 'wide' : ''}">${html}</div>`;
  m.addEventListener('mousedown', e => { if (e.target === m) m.remove(); });
  document.body.appendChild(m); return m;
}
function productForm(p) {
  const m = modal(`<h3>${p ? t('editProduct') : t('addProduct')}</h3><form id="pf">
    <label>${t('nameEn')}</label><input name="name" required value="${esc(p?.name)}" maxlength="80">
    <label>${t('nameMr')}</label><input name="nameMr" value="${esc(p?.nameMr)}" maxlength="80">
    <div class="row"><div><label>${t('price')} (₹)</label><input name="price" type="number" min="0" step="any" required value="${p?.price ?? ''}"></div>
    <div><label>${t('unit')}</label><input name="unit" value="${esc(p?.unit)}" maxlength="12"></div></div>
    <div class="row"><div><label>${t('stock')}</label><input name="stock" type="number" min="0" step="1" required value="${p?.stock ?? 0}"></div>
    <div><label>${t('lowStock')}</label><input name="lowStock" type="number" min="0" step="1" value="${p?.lowStock ?? 10}"></div></div>
    <div class="row" style="margin-top:14px"><button class="btn">${t('save')}</button><button type="button" class="btn sec" data-c>${t('cancel')}</button>
    ${p ? `<button type="button" class="btn danger" data-del>${t('delete')}</button>` : ''}</div></form>`);
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
  const m = modal(`<h3>${esc(p.name)}</h3><p class="mute">${t('stock')}: <b>${p.stock}</b></p><form id="sf">
    <label>${t('stockChange')}</label><input name="d" type="number" step="1" required inputmode="numeric" placeholder="+50 / -5" autofocus>
    <div class="row" style="margin-top:14px"><button class="btn">${t('save')}</button><button type="button" class="btn sec" data-c>${t('cancel')}</button></div></form>`);
  m.querySelector('[data-c]').onclick = () => m.remove();
  m.querySelector('#sf').onsubmit = guard(async e => {
    e.preventDefault();
    await api('POST', `/api/products/${p.id}/stock`, { delta: Number(e.target.d.value) });
    await refreshProducts(); m.remove(); toast(t('saved'));
  });
}
async function refreshProducts() { S.products = await api('GET', '/api/products'); S.cart = S.cart.filter(i => S.products.some(p => p.id === i.productId)); renderApp(); }

// ---------------- records ----------------
async function viewRecords(v) {
  const R = S.rec;
  v.innerHTML = `<div class="card"><div class="row">
    <div><label>${t('from')}</label><input type="date" id="rf" value="${R.from}"></div>
    <div><label>${t('to')}</label><input type="date" id="rt" value="${R.to}"></div>
    <div><label>${t('search')}</label><input id="rq" value="${esc(R.q)}"></div>
    <div class="fit" style="align-self:flex-end"><button class="btn sec" id="rtd">${t('today')}</button></div></div></div>
    <div id="rbody"><div class="empty">…</div></div>`;
  const reload = guard(drawRecords);
  $('#rf').onchange = e => { R.from = e.target.value; reload(); };
  $('#rt').onchange = e => { R.to = e.target.value; reload(); };
  let tm; $('#rq').oninput = e => { R.q = e.target.value; clearTimeout(tm); tm = setTimeout(reload, 250); };
  $('#rtd').onclick = () => { R.from = R.to = todayStr(); viewRecords(v); };
  reload();
}
async function drawRecords() {
  const R = S.rec, qs = new URLSearchParams({ from: R.from, to: R.to, q: R.q });
  const [sum, list] = await Promise.all([api('GET', '/api/summary?' + qs), api('GET', '/api/invoices?' + qs)]);
  const el = $('#rbody'); if (!el) return;
  el.innerHTML = `<div class="kpis" style="margin-bottom:14px">
    <div class="kpi"><small>${t('sales')}</small><b>₹${money(sum.sales)}</b></div>
    <div class="kpi"><small>${t('invoices')}</small><b>${sum.invoices}</b></div>
    <div class="kpi"><small>${t('qtySold')}</small><b>${sum.qty}</b></div></div>
    <div class="grid cols2">
    <div class="card"><h3>${t('daily')}</h3>${sum.days.length ? `<div class="table-wrap"><table><tr><th>${t('date')}</th><th class="n">${t('invoices')}</th><th class="n">${t('qty')}</th><th class="n">${t('total')}</th></tr>
      ${sum.days.map(d => `<tr><td>${d.date}</td><td class="n">${d.invoices}</td><td class="n">${d.qty}</td><td class="n">₹${money(d.total)}</td></tr>`).join('')}</table></div>` : `<div class="empty">${t('noRecords')}</div>`}</div>
    <div class="card"><h3>${t('topItems')}</h3>${sum.products.length ? `<div class="table-wrap"><table><tr><th>${t('product')}</th><th class="n">${t('qty')}</th><th class="n">${t('amount')}</th></tr>
      ${sum.products.map(p => `<tr><td>${esc(S.lang === 'mr' && p.nameMr ? p.nameMr : p.name)}</td><td class="n">${p.qty}</td><td class="n">₹${money(p.amount)}</td></tr>`).join('')}</table></div>` : `<div class="empty">${t('noRecords')}</div>`}</div></div>
    <div class="card"><h3>${t('history')}</h3>${list.length ? `<div class="table-wrap"><table><tr><th>${t('billNo')}</th><th>${t('date')}</th><th>${t('customer')}</th><th class="n">${t('total')}</th><th></th></tr>
      ${list.map(i => `<tr><td>${i.no} ${i.status === 'void' ? `<span class="badge">${t('cancelled')}</span>` : ''}</td><td>${i.date}</td><td>${esc(i.customer)}</td>
      <td class="n" ${i.status === 'void' ? 'style="text-decoration:line-through"' : ''}>₹${money(i.total)}</td><td class="n"><button class="btn sec sm" data-v="${i.id}">${t('view')}</button></td></tr>`).join('')}</table></div>` : `<div class="empty">${t('noRecords')}</div>`}</div>`;
  el.querySelectorAll('[data-v]').forEach(b => b.onclick = guard(async () => showInvoice(await api('GET', '/api/invoices/' + b.dataset.v))));
}

// ---------------- invoice / receipt ----------------
function receiptHTML(inv) {
  const s = S.settings, mr = S.lang === 'mr', w = s.paper === 58 ? 58 : 80;
  const L = (a, b, cls = '') => `<div class="line ${cls}"><span>${a}</span><span>${b}</span></div>`;
  const d = new Date(inv.createdAt);
  return `<div class="receipt w${w}">
    <div class="c sh">${esc(mr && s.shopNameMr ? s.shopNameMr : s.shopName)}</div>
    ${s.address ? `<div class="c">${esc(s.address)}</div>` : ''}${s.phone ? `<div class="c">☎ ${esc(s.phone)}</div>` : ''}
    ${s.gstin ? `<div class="c">GSTIN: ${esc(s.gstin)}</div>` : ''}
    <hr><div class="c b">${t('invoice')}</div>${inv.status === 'void' ? `<div class="void">${t('cancelled').toUpperCase()}</div>` : ''}
    ${L(t('billNo'), inv.no)}${L(t('date'), `${inv.date} ${d.toTimeString().slice(0, 5)}`)}
    ${L(t('customer'), esc(inv.customer))}${inv.phone ? L(t('phone').replace(/ \(.*/, ''), esc(inv.phone)) : ''}
    <hr><table><tr><th>${t('product')}</th><th class="r">${t('qty')}</th><th class="r">${t('rate')}</th><th class="r">${t('amount')}</th></tr>
    ${inv.items.map(i => `<tr><td>${esc(mr && i.nameMr ? i.nameMr : i.name)}</td><td class="r">${i.qty}</td><td class="r">${money(i.rate)}</td><td class="r">${money(i.amount)}</td></tr>`).join('')}</table>
    <hr>${L(t('subtotal'), money(inv.subtotal))}
    ${inv.discount ? L(`${t('discount')}${inv.discountType === 'percent' ? ` (${inv.discountValue}%)` : ''}`, '-' + money(inv.discount)) : ''}
    ${inv.gstApplied ? L(`${t('gst')} ${inv.gstRate}%`, '+' + money(inv.gst)) : ''}
    ${inv.roundOff ? L(t('roundOff'), (inv.roundOff > 0 ? '+' : '-') + money(Math.abs(inv.roundOff))) : ''}
    <hr>${L(t('total'), '₹' + money(inv.total), 'b sh')}<hr>
    ${L(t('payment'), t(inv.payment))}${L(t('qty'), inv.items.reduce((a, i) => a + i.qty, 0))}
    <hr><div class="c">${esc(s.footer || t('thanks'))}</div></div>`;
}
function showInvoice(inv, fresh) {
  const m = modal(`<div class="rwrap" id="rc">${receiptHTML(inv)}</div>
    <div class="row"><button class="btn" data-p>🖨 ${t('print')}</button><button class="btn sec" data-d>⬇ ${t('pdf')}</button></div>
    <div class="row" style="margin-top:8px">
    ${inv.status === 'active' && !fresh ? `<button class="btn danger" data-v>${t('voidInv')}</button>` : ''}<button class="btn sec" data-c>${fresh ? t('newBill') : t('close')}</button></div>`, true);
  m.querySelector('[data-c]').onclick = () => m.remove();
  m.querySelector('[data-p]').onclick = () => printReceipt(inv);
  m.querySelector('[data-d]').onclick = guard(() => downloadPdf(inv, m.querySelector('.receipt')));
  const vb = m.querySelector('[data-v]');
  if (vb) vb.onclick = guard(async () => {
    if (!confirm(t('voidConfirm'))) return;
    await api('POST', `/api/invoices/${inv.id}/void`); S.products = await api('GET', '/api/products');
    m.remove(); if (S.tab === 'records') drawRecords(); toast(t('done'));
  });
}
function printReceipt(inv) {
  const w = S.settings.paper === 58 ? 58 : 80;
  let st = $('#pageStyle'); if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.appendChild(st); }
  st.textContent = `@page{size:${w}mm auto;margin:0}`;
  $('#printArea').innerHTML = receiptHTML(inv);
  setTimeout(() => window.print(), 50);
}
async function downloadPdf(inv, el) {
  if (!window.html2canvas || !window.jspdf) { toast('PDF library not loaded (internet needed once). Use Print → Save as PDF.', true); return; }
  const canvas = await html2canvas(el, { scale: 3, backgroundColor: '#fff' });
  const w = S.settings.paper === 58 ? 58 : 80, h = Math.max(30, w * canvas.height / canvas.width);
  const pdf = new jspdf.jsPDF({ unit: 'mm', format: [w, h], orientation: h > w ? 'p' : 'l' });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h);
  pdf.save(inv.no + '.pdf');
}

// ---------------- settings ----------------
function viewSettings(v) {
  const s = S.settings;
  v.innerHTML = `<div class="grid cols2"><section class="card"><h3>${t('shopDetails')}</h3><form id="sf">
    <label>${t('shopName')}</label><input name="shopName" value="${esc(s.shopName)}">
    <label>${t('shopNameMr')}</label><input name="shopNameMr" value="${esc(s.shopNameMr)}">
    <label>${t('address')}</label><input name="address" value="${esc(s.address)}">
    <div class="row"><div><label>${t('phone')}</label><input name="phone" value="${esc(s.phone)}"></div><div><label>${t('gstin')}</label><input name="gstin" value="${esc(s.gstin)}"></div></div>
    <div class="row"><div><label>${t('paper')}</label><select name="paper"><option value="80" ${s.paper !== 58 ? 'selected' : ''}>80 mm</option><option value="58" ${s.paper === 58 ? 'selected' : ''}>58 mm</option></select></div>
    <div><label>${t('gstRate')}</label><input name="gstRate" type="number" min="0" max="100" step="any" value="${s.gstRate}"></div></div>
    <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" name="gstEnabled" style="width:auto;min-height:0" ${s.gstEnabled ? 'checked' : ''}> ${t('enableGst')}</label>
    <label>${t('footer')}</label><input name="footer" value="${esc(s.footer)}">
    <div style="margin-top:14px"><button class="btn">${t('save')}</button></div></form></section>
    <section class="card"><h3>${t('security')}: ${esc(S.user.username)}</h3><form id="pf">
    <label>${t('current')}</label><input type="password" name="current" autocomplete="current-password" required>
    <label>${t('newPw')}</label><input type="password" name="next" autocomplete="new-password" minlength="6" required>
    <div style="margin-top:14px"><button class="btn">${t('savePw')}</button></div></form></section></div>`;
  $('#sf').onsubmit = guard(async e => {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f)); d.gstEnabled = f.gstEnabled.checked;
    S.settings = await api('PUT', '/api/settings', d); renderApp(); toast(t('saved'));
  });
  $('#pf').onsubmit = guard(async e => {
    e.preventDefault();
    await api('POST', '/api/password', Object.fromEntries(new FormData(e.target)));
    e.target.reset(); toast(t('saved'));
  });
}

init();
