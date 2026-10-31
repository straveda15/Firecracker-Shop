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

  const need = {}, items = [];
  const found = await db.collection('products').find({ id: { $in: body.items.map(i => +i.productId) } }).toArray();
  const byId = new Map(found.map(p => [p.id, p]));
  for (const it of body.items) {
    const p = byId.get(+it.productId);
    if (!p) bad('Unknown product');
    const qty = Number(it.qty), rate = it.rate === undefined ? p.price : Number(it.rate);
    if (!(qty > 0) || !Number.isInteger(qty)) bad(`Invalid quantity for ${p.name}`);
    if (!(rate >= 0)) bad(`Invalid rate for ${p.name}`);
    need[p.id] = (need[p.id] || 0) + qty;
    items.push({ productId: p.id, name: p.name, nameMr: p.nameMr || '', unit: p.unit || '', qty, rate: r2(rate), amount: r2(qty * rate) });
  }
  const subtotal = r2(items.reduce((a, i) => a + i.amount, 0));
  const discType = body.discountType === 'percent' ? 'percent' : 'amount';
  const discVal = Math.max(0, Number(body.discountValue) || 0);
  const discount = discType === 'percent' ? r2(subtotal * Math.min(discVal, 100) / 100) : r2(discVal);
  if (discount > subtotal) bad('Discount exceeds subtotal');
  const raw = r2(subtotal - discount), total = Math.round(raw);

  // atomic stock reservation; roll back on any failure
  const reserved = [];
  const rollback = () => Promise.all(reserved.map(([id, q]) => db.collection('products').updateOne({ id }, { $inc: { stock: q } })));
  try {
    const ids = Object.keys(need);
    const results = await Promise.all(ids.map(id => db.collection('products').updateOne({ id: +id, stock: { $gte: need[id] } }, { $inc: { stock: -need[id] } })));
    results.forEach((r, n) => { if (r.modifiedCount) reserved.push([+ids[n], need[ids[n]]]); });
    const short = ids.findIndex((id, n) => !results[n].modifiedCount);
    if (short >= 0) {
      const p = byId.get(+ids[short]);
      const now = await db.collection('products').findOne({ id: +ids[short] });
      bad(`Insufficient stock for ${p.name} (available ${now ? now.stock : 0})`);
    }
    const id = await nextId(db, 'invoice');
    const inv = {
      id, no: 'INV-' + String(id).padStart(5, '0'), date: today(), createdAt: new Date().toISOString(), by: user,
      customer: cust, phone, items, subtotal, discountType: discType, discountValue: discVal, discount,
      roundOff: r2(total - raw), total,
      payment: ['cash', 'upi', 'card'].includes(body.payment) ? body.payment : 'cash', status: 'active',
    };
    await db.collection('invoices').insertOne({ ...inv });
    return inv;
  } catch (e) { await rollback(); throw e; }
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
  const price = Number(b.price ?? p.price), stock = Number(b.stock ?? p.stock ?? 0);
  if (!(price >= 0)) bad('Invalid price');
  if (!(stock >= 0) || !Number.isInteger(stock)) bad('Stock must be a whole number');
  return { name, nameMr: String(b.nameMr ?? p.nameMr ?? '').trim().slice(0, 80), unit: String(b.unit ?? p.unit ?? '').trim().slice(0, 12),
    price: r2(price), stock, lowStock: Math.max(0, Number(b.lowStock ?? p.lowStock ?? 10) || 0) };
};

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn, open = false) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '/?$'), fn, open });

const loadAll = db => Promise.all([db.collection('products').find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray(), db.collection('settings').findOne({ _id: 'main' }, { projection: { _id: 0 } })]);
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
  send(res, 200, await db.collection('products').find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray()));
route('POST', '/api/products', async (req, res, { db, body }) => {
  const p = { id: await nextId(db, 'product'), ...productFields(body) };
  await db.collection('products').insertOne({ ...p }); send(res, 201, p);
});
route('PUT', '/api/products/:id', async (req, res, { db, body, params }) => {
  const old = await db.collection('products').findOne({ id: +params.id }) || bad('Not found', 404);
  send(res, 200, noId(await db.collection('products').findOneAndUpdate({ id: +params.id }, { $set: productFields(body, old) }, { returnDocument: 'after' })));
});
route('DELETE', '/api/products/:id', async (req, res, { db, params }) => {
  const r = await db.collection('products').deleteOne({ id: +params.id });
  if (!r.deletedCount) bad('Not found', 404);
  send(res, 200, { ok: true });
});
route('POST', '/api/products/:id/stock', async (req, res, { db, body, params }) => {
  const d = Number(body.delta);
  if (!Number.isInteger(d) || d === 0) bad('Enter a whole number');
  const p = await db.collection('products').findOneAndUpdate({ id: +params.id, stock: { $gte: -d } }, { $inc: { stock: d } }, { returnDocument: 'after' });
  if (!p) bad(await db.collection('products').findOne({ id: +params.id }) ? 'Stock cannot go below zero' : 'Not found', 400);
  send(res, 200, noId(p));
});

route('POST', '/api/invoices', async (req, res, { db, body, user }) => send(res, 201, await createInvoice(db, body, user)));
route('GET', '/api/invoices', async (req, res, { db, query }) =>
  send(res, 200, await db.collection('invoices').find(invoiceQuery(query), { projection: { _id: 0 } }).sort({ id: -1 }).limit(1000).toArray()));
route('GET', '/api/invoices/:id', async (req, res, { db, params }) =>
  send(res, 200, await db.collection('invoices').findOne({ id: +params.id }, { projection: { _id: 0 } }) || bad('Not found', 404)));
route('POST', '/api/invoices/:id/void', async (req, res, { db, params }) => {
  const inv = await db.collection('invoices').findOneAndUpdate({ id: +params.id, status: 'active' }, { $set: { status: 'void' } }, { returnDocument: 'after' });
  if (!inv) bad(await db.collection('invoices').findOne({ id: +params.id }) ? 'Already cancelled' : 'Not found', 400);
  for (const it of inv.items) await db.collection('products').updateOne({ id: it.productId }, { $inc: { stock: it.qty } });
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
