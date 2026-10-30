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
  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  await db.collection('products').createIndex({ id: 1 }, { unique: true });
  await db.collection('invoices').createIndex({ id: 1 }, { unique: true });
  await db.collection('invoices').createIndex({ date: 1 });
  await db.collection('settings').updateOne({ _id: 'main' }, { $setOnInsert: {
    shopName: SHOP_EN, shopNameMr: SHOP_MR, address: '', phone: '', paper: 80, footer: 'Thank you! Visit again.' } }, { upsert: true });
  // migrate older settings: drop GST, adopt the company name
  await db.collection('settings').updateOne({ _id: 'main' }, { $unset: { gstin: '', gstEnabled: '', gstRate: '' } });
  await db.collection('settings').updateOne({ _id: 'main', shopName: 'Firecracker Shop' }, { $set: { shopName: SHOP_EN, shopNameMr: SHOP_MR } });
  if (await db.collection('users').countDocuments() === 0) {
    const seed = [['admin', 'Admin', process.env.ADMIN_PASSWORD], ['staff', 'Staff', process.env.STAFF_PASSWORD]];
    for (const [username, name, pw] of seed) {
      if (!pw && PROD) continue; // never seed a guessable password in production
      await db.collection('users').insertOne({ username, name, pass: hash(pw || username + '123') });
    }
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
const authCache = new Map(); // sha256(header) -> {user, exp}; avoids re-running scrypt on every call
async function checkCreds(db, req, username, password) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'x').split(',')[0].trim();
  const at = db.collection('attempts'), a = await at.findOne({ _id: ip });
  if (a && a.until > Date.now()) bad('Too many attempts. Try again in a few minutes.', 429);
  const u = await db.collection('users').findOne({ username: String(username || '').toLowerCase().trim() });
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
  authCache.set(key, { user: u.username, exp: Date.now() + 5 * 60 * 1000 });
  return u.username;
}

// ---------- invoice logic ----------
async function createInvoice(db, body, user) {
  const cust = String(body.customer || '').trim().slice(0, 80);
  const phone = String(body.phone || '').trim().slice(0, 20);
  if (!cust) bad('Customer name is required');
  if (!Array.isArray(body.items) || !body.items.length) bad('Add at least one item');
  if (body.items.length > 200) bad('Too many items');

  const need = {}, items = [];
  for (const it of body.items) {
    const p = await db.collection('products').findOne({ id: +it.productId });
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
  const done = [];
  const rollback = () => Promise.all(done.map(([id, q]) => db.collection('products').updateOne({ id }, { $inc: { stock: q } })));
  try {
    for (const id of Object.keys(need)) {
      const r = await db.collection('products').updateOne({ id: +id, stock: { $gte: need[id] } }, { $inc: { stock: -need[id] } });
      if (!r.modifiedCount) {
        const p = await db.collection('products').findOne({ id: +id });
        bad(`Insufficient stock for ${p ? p.name : 'item'} (available ${p ? p.stock : 0})`);
      }
      done.push([+id, need[id]]);
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

route('POST', '/api/login', async (req, res, { db, body }) => {
  const u = await checkCreds(db, req, body.username, body.password);
  if (!u) bad('Invalid username or password', 401);
  send(res, 200, { username: u.username, name: u.name });
}, true);
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

route('GET', '/api/settings', async (req, res, { db }) => send(res, 200, await db.collection('settings').findOne({ _id: 'main' }, { projection: { _id: 0 } })));
route('PUT', '/api/settings', async (req, res, { db, body: b }) => {
  const set = {};
  for (const k of ['shopName', 'shopNameMr', 'address', 'phone', 'footer']) if (b[k] !== undefined) set[k] = String(b[k]).slice(0, 200);
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
    console.error(e); send(res, 500, { error: 'Server error' });
  }
};
