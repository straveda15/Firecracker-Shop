// Shared request handler: used by api/index.js (Vercel) and server.js (local).
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const SHOP_EN = 'Jaybhadra Fatake Wholesaler', SHOP_MR = 'जयभद्र फटाके होलसेलर';
const PROD = !!process.env.VERCEL || process.env.NODE_ENV === 'production';

// ---------- mongo ----------
let cached = global.__mongo;
async function getDb() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  if (!cached) {
    const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 });
    cached = global.__mongo = { promise: client.connect().then(c => c.db(process.env.MONGODB_DB || 'firecracker')) };
  }
  let db;
  try { db = await cached.promise; } catch (e) { cached = global.__mongo = null; throw e; }
  if (!db.__ready) { db.__ready = true; await setup(db).catch(e => { db.__ready = false; throw e; }); }
  return db;
}
const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const verify = (pw, stored) => {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(h, 'hex'), b = Buffer.from(hash(pw, salt).split(':')[1], 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
async function setup(db) {
  await Promise.all([
    db.collection('users').createIndex({ username: 1 }, { unique: true }),
    db.collection('products').createIndex({ id: 1 }, { unique: true }),
    db.collection('invoices').createIndex({ id: 1 }, { unique: true }),
    db.collection('invoices').createIndex({ date: 1 }),
    db.collection('printjobs').createIndex({ id: 1 }, { unique: true }),
    db.collection('printjobs').createIndex({ status: 1, id: 1 }),
    db.collection('printlog').createIndex({ at: 1 }, { expireAfterSeconds: 7 * 24 * 3600 }),
    db.collection('settings').updateOne({ _id: 'main' }, { $setOnInsert: {
      shopName: SHOP_EN, shopNameMr: SHOP_MR, address: '', phone: '', paper: 80, footer: 'Thank you! Visit again.' } }, { upsert: true }),
  ]);
  for (const [from, to, name] of [['admin', 'admin1', 'Admin 1'], ['staff', 'admin2', 'Admin 2']]) {
    if (!await db.collection('users').findOne({ username: to }))
      await db.collection('users').updateOne({ username: from }, { $set: { username: to, name } }).catch(() => {});
  }
  if (await db.collection('users').countDocuments() === 0) {
    const seed = [['admin1', 'Admin 1', process.env.ADMIN_PASSWORD], ['admin2', 'Admin 2', process.env.STAFF_PASSWORD]];
    await Promise.all(seed.filter(([, , pw]) => pw || !PROD) // never seed a guessable password in production
      .map(([username, name, pw]) => db.collection('users').insertOne({ username, name, pass: hash(pw || username + '123') })));
  }
}
const nextId = async (db, name) =>
  (await db.collection('counters').findOneAndUpdate({ _id: name }, { $inc: { n: 1 } }, { upsert: true, returnDocument: 'after' })).n;

// ---------- helpers ----------
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (msg, code = 400) => { throw new HttpError(code, msg); };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const noId = d => { if (d) delete d._id; return d; };

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let s = typeof req.body === 'string' ? req.body : '';
  if (req.body === undefined) {
    s = await new Promise((resolve, reject) => {
      let d = '';
      req.on('data', c => { d += c; if (d.length > 1e6) { reject(new HttpError(413, 'Too large')); req.destroy(); } });
      req.on('end', () => resolve(d));
      req.on('error', reject);
    });
  }
  try { return s ? JSON.parse(s) : {}; } catch { throw new HttpError(400, 'Bad JSON'); }
}
// Basic auth: the browser sends "Authorization: Basic base64(user:pass)" on every request.
const AUTH_TTL = 30 * 60 * 1000;
const authCache = new Map(); // sha256(header) -> {user, exp}; avoids re-running scrypt on every call
async function checkCreds(db, req, username, password) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'x').split(',')[0].trim();
  const at = db.collection('attempts');
  const [a, u] = await Promise.all([at.findOne({ _id: ip }), db.collection('users').findOne({ username: String(username || '').toLowerCase().trim() })]);
  if (a && a.until > Date.now()) bad('Too many attempts. Try again in a few minutes.', 429);
  if (!u || !verify(String(password || ''), u.pass)) {
    const n = (a ? a.n : 0) + 1;
    await at.updateOne({ _id: ip }, { $set: n >= 5 ? { n: 0, until: Date.now() + 5 * 60 * 1000 } : { n, until: 0 } }, { upsert: true });
    return null;
  }
  if (a) await at.deleteOne({ _id: ip });
  return u;
}
async function authUser(db, req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return null;
  const key = crypto.createHash('sha256').update(h).digest('hex'), hit = authCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.user;
  const [username, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
  const u = await checkCreds(db, req, username, rest.join(':'));
  if (!u) return null;
  authCache.set(key, { user: u.username, exp: Date.now() + AUTH_TTL });
  return u.username;
}

// ---------- invoice logic ----------
async function createInvoice(db, body, user) {
  const cust = String(body.customer || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  let phone = String(body.phone || '').replace(/[\s-]/g, '');
  if (!cust) bad('Customer name is required');
  if (cust.length < 2 || !/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(cust)) bad('Enter a valid customer name (letters only)');
  if (phone) {
    phone = phone.replace(/^(\+91|91|0)(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(phone)) bad('Enter a valid 10-digit phone number');
  }
  if (!Array.isArray(body.items) || !body.items.length) bad('Add at least one item');
  if (body.items.length > 200) bad('Too many items');

  const items = [];
  const found = await db.collection('products').find({ id: { $in: body.items.map(i => +i.productId) } }).toArray();
  const byId = new Map(found.map(p => [p.id, p]));
  for (const it of body.items) {
    const p = byId.get(+it.productId);
    if (!p) bad('Unknown product');
    const qty = Number(it.qty), rate = p.price; // price always comes from the catalogue, never from the client
    if (!(qty > 0) || !Number.isInteger(qty)) bad(`Invalid quantity for ${p.name}`);
    items.push({ productId: p.id, name: p.name, nameMr: p.nameMr || '', brand: p.brand || '', unit: p.unit || '', qty, rate: r2(rate), amount: r2(qty * rate) });
  }
  const subtotal = r2(items.reduce((a, i) => a + i.amount, 0));
  const discType = body.discountType === 'percent' ? 'percent' : 'amount';
  const discVal = Math.max(0, Number(body.discountValue) || 0);
  if (discType === 'percent' && discVal > 100) bad('Discount cannot exceed 100%');
  const discount = discType === 'percent' ? r2(subtotal * discVal / 100) : r2(discVal);
  if (discount > subtotal) bad('Discount cannot exceed the bill amount');
  const raw = r2(subtotal - discount), total = Math.round(raw);

  const id = await nextId(db, 'invoice');
  const inv = {
    id, no: 'INV-' + String(id).padStart(5, '0'), date: today(), createdAt: new Date().toISOString(), by: user,
    customer: cust, phone, items, subtotal, discountType: discType, discountValue: discVal, discount,
    roundOff: r2(total - raw), total,
    payment: ['cash', 'upi', 'card'].includes(body.payment) ? body.payment : 'cash', status: 'active',
  };
  await db.collection('invoices').insertOne({ ...inv });
  return inv;
}

function invoiceQuery(q) {
  const f = {};
  if (q.from || q.to) f.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.q) {
    const rx = new RegExp(q.q.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    f.$or = [{ no: rx }, { customer: rx }, { phone: rx }];
  }
  return f;
}
const productFields = (b, p = {}) => {
  const name = String(b.name ?? p.name ?? '').trim().slice(0, 80);
  if (!name) bad('Product name is required');
  const price = Number(b.price ?? p.price);
  if (!(price >= 0)) bad('Invalid price');
  const category = String(b.category ?? p.category ?? '').toUpperCase();
  if (category && !['A', 'B', 'C'].includes(category)) bad('Category must be A, B or C');
  return { name, brand: String(b.brand ?? p.brand ?? '').trim().slice(0, 60), category, nameMr: String(b.nameMr ?? p.nameMr ?? '').trim().slice(0, 80), unit: String(b.unit ?? p.unit ?? '').trim().slice(0, 12),
    price: r2(price) };
};

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn, open = false) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '/?$'), fn, open });

const NO_STOCK = { _id: 0, stock: 0, lowStock: 0 };
const loadAll = db => Promise.all([db.collection('products').find({}, { projection: NO_STOCK }).sort({ name: 1 }).toArray(), db.collection('settings').findOne({ _id: 'main' }, { projection: { _id: 0 } }).then(x => ({ ...x, directPrint: !!PRINT_KEY() }))]);
route('POST', '/api/login', async (req, res, { db, body }) => {
  const u = await checkCreds(db, req, body.username, body.password);
  if (!u) bad('Invalid username or password', 401);
  authCache.set(crypto.createHash('sha256').update('Basic ' + Buffer.from(String(body.username || '').toLowerCase().trim() + ':' + String(body.password || '')).toString('base64')).digest('hex'), { user: u.username, exp: Date.now() + AUTH_TTL });
  const [products, settings] = await loadAll(db);
  send(res, 200, { username: u.username, name: u.name, products, settings });
}, true);
route('GET', '/api/bootstrap', async (req, res, { db, user }) => {
  const [[products, settings], u] = await Promise.all([loadAll(db), db.collection('users').findOne({ username: user })]);
  if (!u) return send(res, 401, { error: 'Please log in' });
  send(res, 200, { username: u.username, name: u.name, products, settings });
});
route('GET', '/api/me', async (req, res, { db, user }) => {
  const u = user && await db.collection('users').findOne({ username: user });
  if (!u) return send(res, 401, { error: 'Not logged in' });
  send(res, 200, { username: u.username, name: u.name });
}, true);
route('POST', '/api/password', async (req, res, { db, body, user }) => {
  const u = await db.collection('users').findOne({ username: user });
  if (!verify(String(body.current || ''), u.pass)) bad('Current password is wrong');
  if (String(body.next || '').length < 6) bad('New password must be at least 6 characters');
  await db.collection('users').updateOne({ username: user }, { $set: { pass: hash(body.next) } });
  authCache.clear();
  send(res, 200, { ok: true });
});

route('GET', '/api/health', async (req, res) => send(res, 200, { ok: true }), true);
route('GET', '/api/settings', async (req, res, { db }) => send(res, 200, await db.collection('settings').findOne({ _id: 'main' }, { projection: { _id: 0 } })));
route('PUT', '/api/settings', async (req, res, { db, body: b }) => {
  const set = {};
  for (const k of ['shopName', 'shopNameMr', 'address', 'phone', 'footer', 'terms']) if (b[k] !== undefined) set[k] = String(b[k]).slice(0, k === 'terms' ? 600 : 200);
  if (b.paper !== undefined) set.paper = Number(b.paper) === 58 ? 58 : 80;
  const r = await db.collection('settings').findOneAndUpdate({ _id: 'main' }, { $set: set }, { returnDocument: 'after', projection: { _id: 0 } });
  send(res, 200, r);
});

route('GET', '/api/products', async (req, res, { db }) =>
  send(res, 200, await db.collection('products').find({}, { projection: NO_STOCK }).sort({ name: 1 }).toArray()));
route('POST', '/api/products', async (req, res, { db, body }) => {
  const p = { id: await nextId(db, 'product'), ...productFields(body) };
  await db.collection('products').insertOne({ ...p }); send(res, 201, p);
});
route('PUT', '/api/products/:id', async (req, res, { db, body, params }) => {
  const old = await db.collection('products').findOne({ id: +params.id }) || bad('Not found', 404);
  send(res, 200, noId(await db.collection('products').findOneAndUpdate({ id: +params.id }, { $set: productFields(body, old), $unset: { stock: '', lowStock: '' } }, { returnDocument: 'after' })));
});
route('DELETE', '/api/products/:id', async (req, res, { db, params }) => {
  const r = await db.collection('products').deleteOne({ id: +params.id });
  if (!r.deletedCount) bad('Not found', 404);
  send(res, 200, { ok: true });
});
route('POST', '/api/invoices', async (req, res, { db, body, user }) => send(res, 201, await createInvoice(db, body, user)));
route('GET', '/api/invoices', async (req, res, { db, query }) =>
  send(res, 200, await db.collection('invoices').find(invoiceQuery(query), { projection: { _id: 0 } }).sort({ id: -1 }).limit(1000).toArray()));
route('GET', '/api/invoices/:id', async (req, res, { db, params }) =>
  send(res, 200, await db.collection('invoices').findOne({ id: +params.id }, { projection: { _id: 0 } }) || bad('Not found', 404)));
route('POST', '/api/invoices/:id/void', async (req, res, { db, params }) => {
  const inv = await db.collection('invoices').findOneAndUpdate({ id: +params.id, status: 'active' }, { $set: { status: 'void' } }, { returnDocument: 'after' });
  if (!inv) bad(await db.collection('invoices').findOne({ id: +params.id }) ? 'Already cancelled' : 'Not found', 400);
  send(res, 200, noId(inv));
});
route('GET', '/api/summary', async (req, res, { db, query }) => {
  const list = await db.collection('invoices').find({ ...invoiceQuery(query), status: 'active' }).limit(5000).toArray();
  const byDay = {}, byProd = {};
  let sales = 0, qty = 0, discount = 0;
  for (const i of list) {
    const d = byDay[i.date] ||= { date: i.date, invoices: 0, qty: 0, total: 0 };
    d.invoices++; d.total = r2(d.total + i.total);
    sales += i.total; discount += i.discount;
    for (const it of i.items) {
      d.qty += it.qty; qty += it.qty;
      const p = byProd[it.productId] ||= { name: it.name, nameMr: it.nameMr, qty: 0, amount: 0 };
      p.qty += it.qty; p.amount = r2(p.amount + it.amount);
    }
  }
  send(res, 200, { invoices: list.length, sales: r2(sales), qty, discount: r2(discount),
    days: Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date)),
    products: Object.values(byProd).sort((a, b) => b.qty - a.qty) });
});

route('GET', '/api/dashboard', async (req, res, { db }) => {
  const inv = db.collection('invoices'), day = today();
  const days = Array.from({ length: 7 }, (_, n) => {
    const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - (6 - n));
    return { date: d.toISOString().slice(0, 10), orders: 0, sales: 0 };
  });
  const [week, totals, recent, products] = await Promise.all([
    inv.find({ date: { $gte: days[0].date }, status: 'active' }, { projection: { _id: 0, date: 1, total: 1 } }).limit(5000).toArray(),
    inv.aggregate([{ $match: { status: 'active' } }, { $group: { _id: null, sales: { $sum: '$total' }, orders: { $sum: 1 } } }]).toArray(),
    inv.find({ status: 'active' }, { projection: { _id: 0 } }).sort({ id: -1 }).limit(60).toArray(),
    db.collection('products').countDocuments(),
  ]);
  const byDate = Object.fromEntries(days.map(d => [d.date, d]));
  for (const i of week) { const d = byDate[i.date]; if (d) { d.orders++; d.sales = r2(d.sales + i.total); } }
  const orders = recent.slice(0, 5).map(i => ({ no: i.no, customer: i.customer, date: i.date, total: i.total,
    items: i.items.map(it => ({ name: it.name, nameMr: it.nameMr || '', brand: it.brand || '', qty: it.qty })) }));
  const known = new Set(), customers = [];
  for (const i of recent) {
    const key = i.phone || i.customer.toLowerCase();
    if (customers.length < 5 && !known.has(key)) {
      known.add(key);
      customers.push({ customer: i.customer, phone: i.phone, date: i.date, no: i.no, total: i.total });
    }
  }
  const t0 = totals[0] || { sales: 0, orders: 0 };
  send(res, 200, { today: days[6], days, totalSales: r2(t0.sales), totalOrders: t0.orders,
    totalProducts: products, orders, customers });
});


// ---------- direct thermal printing (Epson Server Direct Print) ----------
// The browser queues a receipt (ESC/POS bytes drawn client-side). The printer itself polls /api/printer/poll, receives the
// next job as ePOS-Print XML, prints it and reports back; a job is only "printed" once the printer confirms it.
// All state lives in Mongo (printjobs / settings:printer / printlog), so nothing depends on a warm serverless instance.
const PRINT_KEY = () => process.env.PRINTER_KEY || process.env.PRINT_KEY || process.env.SPD_KEY || '';
const PRINTER_FRESH = 45 * 1000, CLAIM_TIMEOUT = 60 * 1000, QUEUE_TTL = 5 * 60 * 1000, KEEP_JOBS = 30 * 24 * 3600 * 1000;
const sameSecret = (got, want) => { const a = Buffer.from(String(got || '')), b = Buffer.from(want); return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b); };
const PRINTER_ERRORS = { EPTR_COVER_OPEN: 'The printer cover is open', EPTR_REC_EMPTY: 'The printer is out of paper', EPTR_COVER_OPEN_AND_REC_EMPTY: 'Printer cover is open and paper is out', EPTR_AUTOMATICAL: 'The printer reported an error', EPTR_UNRECOVERABLE: 'Printer hardware error', EPTR_TIMEOUT: 'The printer timed out' };

const jobPublic = j => ({ id: j.id, invoiceId: j.invoiceId || null, kind: j.kind, status: j.status, attempts: j.attempts || 0, error: j.error || '', createdAt: j.createdAt, printedAt: j.printedAt || null, by: j.by || '' });
// jobs whose printer never answered are failed (never silently re-sent: that could print a receipt twice)
async function sweepJobs(db) {
  const now = Date.now(), pj = db.collection('printjobs');
  await Promise.all([
    pj.updateMany({ status: 'processing', claimedAt: { $lt: now - CLAIM_TIMEOUT } }, { $set: { status: 'failed', error: 'The printer did not confirm the print. Check the printer, then press Retry.' } }),
    pj.updateMany({ status: 'queued', createdAt: { $lt: now - QUEUE_TTL } }, { $set: { status: 'failed', error: 'The printer did not pick this up in time. Check that it is on and connected.' } }),
  ]);
}
function printXml(job) {
  const hex = Buffer.from(job.data, 'base64').toString('hex');
  const pre = job.kind === 'test' ? '<text lang="en" smooth="true">XML text OK&#10;</text><feed line="1"/>' : '';
  return '<?xml version="1.0" encoding="utf-8"?><PrintRequestInfo Version="2.00"><ePOSPrint><Parameter><devid>local_printer</devid><timeout>30000</timeout>' +
    `<printjobid>J${job.id}</printjobid></Parameter><PrintData><epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${pre}<command>${hex}</command></epos-print></PrintData></ePOSPrint></PrintRequestInfo>`;
}
async function readForm(req) {
  let b = req.body;
  if (b === undefined) b = await new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { chunks.push(c); n += c.length; if (n > 1e6) { reject(new HttpError(413, 'Too large')); req.destroy(); } });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject);
  });
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') return { raw: b, f: Object.fromEntries(new URLSearchParams(b)) };
  return { raw: JSON.stringify(b || {}), f: b || {} };
}
// Called by the printer itself (form-encoded POST, authenticated by the secret in the URL), not by the browser.
async function printerPoll(req, res, url) {
  const xml = (code, body = '') => { res.writeHead(code, { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); };
  if (!sameSecret(url.searchParams.get('key'), PRINT_KEY())) return xml(403);
  const db = await getDb(), now = Date.now(), { raw, f } = await readForm(req), type = String(f.ConnectionType || (req.method === 'GET' ? 'GetRequest' : ''));
  const set = { seen: now };
  if (f.Name) set.name = String(f.Name).slice(0, 60);
  if (type !== 'GetRequest') { // everything except routine polling is kept for a week, for troubleshooting
    await db.collection('printlog').insertOne({ at: new Date(), type, method: req.method, ct: req.headers['content-type'] || '', body: raw.slice(0, 4000) });
  } else if (process.env.PRINT_DEBUG) {
    set.lastPoll = { at: new Date(), ct: req.headers['content-type'] || '', ua: req.headers['user-agent'] || '', body: raw.slice(0, 1000) };
  }
  await db.collection('settings').updateOne({ _id: 'printer' }, { $set: set }, { upsert: true });
  if (type === 'SetResponse') {
    const resp = String(f.ResponseFile || ''), jid = (resp.match(/<printjobid>\s*J?(\d+)\s*</) || [])[1];
    const ok = /success\s*=\s*["']true["']/i.test(resp), code = (resp.match(/\bcode\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const q = jid ? { id: +jid, status: 'processing' } : { status: 'processing' };
    await db.collection('printjobs').updateOne(q, ok
      ? { $set: { status: 'printed', printedAt: now, error: '' }, $unset: { data: '' } }
      : { $set: { status: 'failed', error: PRINTER_ERRORS[code] || ('The printer could not print' + (code ? ' (' + code + ')' : '')) } }, { sort: { id: 1 } });
    return xml(200);
  }
  if (type && type !== 'GetRequest') return xml(200);
  await sweepJobs(db);
  const job = await db.collection('printjobs').findOneAndUpdate({ status: 'queued' }, { $set: { status: 'processing', claimedAt: now }, $inc: { attempts: 1 } }, { sort: { id: 1 }, returnDocument: 'after' });
  xml(200, job ? printXml(job) : '');
}
const printerOnline = async db => { const p = await db.collection('settings').findOne({ _id: 'printer' }); return { online: !!p && Date.now() - p.seen < PRINTER_FRESH, seen: p ? p.seen : null, name: p ? p.name || '' : '' }; };

route('POST', '/api/print', async (req, res, { db, body, user }) => {
  if (!PRINT_KEY()) bad('Direct printing is not set up on the server', 501);
  const data = String(body.data || ''), invoiceId = body.invoiceId == null ? null : +body.invoiceId;
  if (!/^[A-Za-z0-9+/]+=*$/.test(data) || data.length > 900000) bad('Invalid print data');
  if (invoiceId !== null && !await db.collection('invoices').findOne({ id: invoiceId }, { projection: { _id: 1 } })) bad('Invoice not found', 404);
  if (await db.collection('printjobs').countDocuments({ createdAt: { $gt: Date.now() - 60000 } }) >= 30) bad('Too many print requests. Please wait a minute.', 429);
  if (!(await printerOnline(db)).online) bad('The printer is offline. Check that it is switched on and connected to Wi-Fi.', 503);
  await sweepJobs(db);
  if (invoiceId !== null) { // double-tap protection: one live job per invoice
    const dup = await db.collection('printjobs').findOne({ invoiceId, status: { $in: ['queued', 'processing'] } });
    if (dup) return send(res, 200, { ...jobPublic(dup), duplicate: true });
  }
  await db.collection('printjobs').deleteMany({ createdAt: { $lt: Date.now() - KEEP_JOBS } });
  const job = { id: await nextId(db, 'printjob'), invoiceId, kind: 'receipt', data, status: 'queued', attempts: 0, createdAt: Date.now(), by: user };
  await db.collection('printjobs').insertOne(job);
  send(res, 201, jobPublic(job));
});
route('GET', '/api/print/:id', async (req, res, { db, params }) => {
  await sweepJobs(db);
  send(res, 200, jobPublic(await db.collection('printjobs').findOne({ id: +params.id }) || bad('Not found', 404)));
});
route('POST', '/api/print/:id/retry', async (req, res, { db, params }) => {
  const j = await db.collection('printjobs').findOneAndUpdate({ id: +params.id, status: 'failed', data: { $exists: true } }, { $set: { status: 'queued', createdAt: Date.now(), error: '' } }, { returnDocument: 'after' });
  if (!j) bad('This job cannot be retried', 409);
  send(res, 200, jobPublic(j));
});
route('GET', '/api/printer/status', async (req, res, { db }) => {
  await sweepJobs(db);
  const [p, jobs] = await Promise.all([printerOnline(db), db.collection('printjobs').find({}).sort({ id: -1 }).limit(15).toArray()]);
  send(res, 200, { ...p, configured: !!PRINT_KEY(), jobs: jobs.map(jobPublic) });
});
route('POST', '/api/printer/test', async (req, res, { db, user }) => {
  if (!PRINT_KEY()) bad('Direct printing is not set up on the server', 501);
  if (!(await printerOnline(db)).online) bad('The printer is offline. Check that it is switched on and connected to Wi-Fi.', 503);
  const text = 'TEST PRINT\n' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + '\nRaw command OK\n\n\n';
  const data = Buffer.concat([Buffer.from([0x1b, 0x40, 0x1b, 0x61, 1]), Buffer.from(text, 'ascii'), Buffer.from([0x1d, 0x56, 0x42, 0])]).toString('base64');
  const job = { id: await nextId(db, 'printjob'), invoiceId: null, kind: 'test', data, status: 'queued', attempts: 0, createdAt: Date.now(), by: user };
  await db.collection('printjobs').insertOne(job);
  send(res, 201, jobPublic(job));
});
// raw record of what the printer last sent (troubleshooting)
route('GET', '/api/printer/log', async (req, res, { db }) => {
  const [p, log] = await Promise.all([db.collection('settings').findOne({ _id: 'printer' }, { projection: { _id: 0 } }), db.collection('printlog').find({}, { projection: { _id: 0 } }).sort({ at: -1 }).limit(30).toArray()]);
  send(res, 200, { printer: p, log });
});

// Safe, human-readable reason for setup problems (no secrets); anything else stays generic.
function explain(e) {
  const m = String(e && e.message || ''), n = String(e && e.name || '');
  if (/MONGODB_URI is not set/.test(m)) return 'Database is not configured: MONGODB_URI is missing in the Vercel environment variables (add it for Production, then redeploy).';
  if (/bad auth|Authentication failed|auth failed/i.test(m)) return 'Database login failed: the MongoDB username or password in MONGODB_URI is wrong.';
  if (n === 'MongoServerSelectionError' || /ENOTFOUND|ECONNREFUSED|querySrv|timed out/i.test(m)) return 'Cannot reach the database: in MongoDB Atlas > Network Access allow 0.0.0.0/0, and check the cluster address in MONGODB_URI.';
  if (n === 'MongoParseError' || /Invalid (scheme|connection string)|URI/i.test(m)) return 'MONGODB_URI is not a valid connection string (special characters in the password must be URL-encoded).';
  return 'Server error';
}

// ---------- entry ----------
module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.replace(/\/$/, '') === '/api/printer/poll' && (req.method === 'POST' || req.method === 'GET')) return await printerPoll(req, res, url);
    const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
    if (!r) return send(res, 404, { error: 'Not found' });
    const db = await getDb();
    const user = await authUser(db, req);
    if (!r.open && !user) return send(res, 401, { error: 'Please log in' });
    const ct = req.headers['content-type'];
    if (req.method !== 'GET' && req.method !== 'DELETE' && ct && !ct.includes('application/json')) bad('Unsupported');
    const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
    await r.fn(req, res, { db, body, user, params: url.pathname.match(r.re).groups || {}, query: Object.fromEntries(url.searchParams) });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e); send(res, 500, { error: explain(e) });
  }
};
