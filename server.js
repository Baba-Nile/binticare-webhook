const express = require('express');
const cors    = require('cors');
const admin   = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

/* ─────────────────────────────────────────
   FIREBASE APPS — each in a try/catch so
   one missing env var doesn't crash others
───────────────────────────────────────── */
let bintiDb, changilwaDb, lisheDb, gideonDb;

try {
  const bintiApp = admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.SERVICE_ACCOUNT_JSON))
  }, 'binticare');
  bintiDb = admin.firestore(bintiApp);
  console.log('✅ BintiCare Firebase connected');
} catch (e) { console.error('❌ BintiCare Firebase init failed:', e.message); }

try {
  const changilwaApp = admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.CHANGILWA_SERVICE_ACCOUNT_JSON))
  }, 'changilwa');                                  // <-- WAS MISSING, crashed the whole file
  changilwaDb = admin.firestore(changilwaApp);
  console.log('✅ Changilwa Firebase connected');
} catch (e) { console.error('❌ Changilwa Firebase init failed:', e.message); }

try {
  const lisheApp = admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.LISHE_SERVICE_ACCOUNT_JSON))
  }, 'lishe');
  lisheDb = admin.firestore(lisheApp);
  console.log('✅ Lishe Firebase connected');
} catch (e) { console.error('❌ Lishe Firebase init failed (check LISHE_SERVICE_ACCOUNT_JSON env var):', e.message); }

try {
  const gideonApp = admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.GIDEON_SERVICE_ACCOUNT_JSON))
  }, 'gideon');
  gideonDb = admin.firestore(gideonApp);
  console.log('✅ Gideon Firebase connected');
} catch (e) { console.error('❌ Gideon Firebase init failed (check GIDEON_SERVICE_ACCOUNT_JSON env var):', e.message); }

/* ─────────────────────────────────────────
   SHARED PARSER
───────────────────────────────────────── */
function parseDonation(body) {
  console.log('RAW PAYLOAD:', JSON.stringify(body, null, 2));

  const d  = body?.data || body;
  const tx = d?.transaction || {};

  const rawStatus  = (d?.status || tx?.status || body?.event_type || '').toLowerCase();
  const completed  = rawStatus.includes('complet') || rawStatus.includes('success');

  const amount = Number(
    tx?.amount || d?.Amount || d?.amount || body?.amount || 0
  );

  const phone = d?.PhoneNumber || d?.customer?.mobile_number || tx?.phone
              || d?.msisdn || tx?.msisdn || '';

  const ref = d?.MpesaReceiptNumber || tx?.MpesaReceiptNumber
            || tx?.mpesa_receipt || tx?.reference || '';

  const ts = body?.timestamp || d?.TransactionDate || null;

  const firstName  = (d?.first_name || d?.FirstName || d?.customer?.first_name || tx?.first_name || '').trim();
  const lastName   = (d?.last_name  || d?.LastName  || d?.customer?.last_name  || tx?.last_name  || '').trim();
  const fullName   = [firstName, lastName].filter(Boolean).join(' ');

  let displayName = fullName || null;
  if (!displayName && phone) {
    const p = String(phone);
    displayName = p.slice(0, 3) + '***' + p.slice(-3);
  }
  if (!displayName) displayName = 'Kind Donor';

  // metadata PayNecta echoes back if you pass it on widget init
  const metadata = d?.metadata || tx?.metadata || {};

  console.log(`Parsed: completed=${completed}, amount=${amount}, phone=${phone}, name="${displayName}", ref=${ref}`);

  return { completed, amount, phone, ref, firstName, lastName, displayName, ts, metadata };
}

/* ─────────────────────────────────────────
   HEALTH CHECK
───────────────────────────────────────── */
app.get('/', (req, res) => {
  res.json({
    status: 'Webhook server running ✅',
    clients: {
      binticare:  !!bintiDb,
      changilwa:  !!changilwaDb,
      lishe:      !!lisheDb,
      gideon:     !!gideonDb
    }
  });
});

/* ─────────────────────────────────────────
   BINTICARE WEBHOOK
───────────────────────────────────────── */
app.post('/webhook/paynecta', async (req, res) => {
  console.log('\n=== BINTI CARE WEBHOOK ===');
  if (!bintiDb) return res.status(503).json({ error: 'BintiCare DB not connected' });
  try {
    const p = parseDonation(req.body);
    if (!p.completed || p.amount <= 0) {
      console.log('Skipped — not completed or zero amount');
      return res.json({ received: true, skipped: true });
    }
    await bintiDb.collection('donations').add({
      amount: p.amount, phone: p.phone,
      displayName: p.displayName, firstName: p.firstName, lastName: p.lastName,
      reference: p.ref, source: 'paynecta',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ BintiCare saved KES ${p.amount} from ${p.displayName}`);
    res.json({ success: true });
  } catch (err) {
    console.error('BintiCare error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────
   CHANGILWA WEBHOOK
───────────────────────────────────────── */
app.post('/webhook/changilwa', async (req, res) => {
  console.log('\n=== CHANGILWA WEBHOOK ===');
  if (!changilwaDb) return res.status(503).json({ error: 'Changilwa DB not connected' });
  try {
    const p = parseDonation(req.body);
    if (!p.completed || p.amount <= 0) {
      return res.json({ received: true, skipped: true });
    }
    await changilwaDb.collection('donations').add({
      amount: p.amount, phone: p.phone,
      displayName: p.displayName, firstName: p.firstName, lastName: p.lastName,
      reference: p.ref, source: 'paynecta',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ Changilwa saved KES ${p.amount} from ${p.displayName}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Changilwa error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────
   LISHE KWA MTOTO WEBHOOK
───────────────────────────────────────── */
app.post('/webhook/lishe', async (req, res) => {
  console.log('\n=== LISHE WEBHOOK ===');
  if (!lisheDb) return res.status(503).json({ error: 'Lishe DB not connected — check LISHE_SERVICE_ACCOUNT_JSON' });
  try {
    const p = parseDonation(req.body);
    if (!p.completed || p.amount <= 0) {
      return res.json({ received: true, skipped: true });
    }
    await lisheDb.collection('donations').add({
      amount: p.amount, phone: p.phone,
      displayName: p.displayName, firstName: p.firstName, lastName: p.lastName,
      reference: p.ref, source: 'paynecta',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ Lishe saved KES ${p.amount} from ${p.displayName}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Lishe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────
   GIDEON LUSWETI WEBHOOK
   (matches WEBHOOK_URL in donate.html:
    https://binticare-webhook.onrender.com/gideon-donation)
   Writes to collection "gideon_donations" with the field
   names donate.html's onSnapshot listener expects:
   { name, phone, amount, type, program, status, ref, timestamp }
───────────────────────────────────────── */
app.post('/gideon-donation', async (req, res) => {
  console.log('\n=== GIDEON WEBHOOK ===');
  if (!gideonDb) return res.status(503).json({ error: 'Gideon DB not connected — check GIDEON_SERVICE_ACCOUNT_JSON' });
  try {
    const p = parseDonation(req.body);
    if (!p.completed || p.amount <= 0) {
      return res.json({ received: true, skipped: true });
    }
    await gideonDb.collection('gideon_donations').add({
      name: p.displayName,
      phone: p.phone,
      amount: p.amount,
      type: p.metadata.type || 'campaign',
      program: p.metadata.program || '',
      status: 'confirmed',
      ref: p.ref,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ Gideon saved KES ${p.amount} from ${p.displayName}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Gideon error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server on port ${PORT}`));
