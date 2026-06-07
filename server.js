const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// ── Firebase: BintiCare ──
const bintiApp = admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.SERVICE_ACCOUNT_JSON))
}, 'binticare');
const bintiDb = admin.firestore(bintiApp);

// ── Firebase: Changilwa Campaign ──
const changilwaApp = admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.CHANGILWA_SERVICE_ACCOUNT_JSON))
}, 'changilwa');
const changilwaDb = admin.firestore(changilwaApp);

// ── Firebase: Lishe Kwa Mtoto ──
const lisheApp = admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.LISHE_SERVICE_ACCOUNT_JSON))
}, 'lishe');
const lisheDb = admin.firestore(lisheApp);

// ── Health check ──
app.get('/', (req, res) => {
  res.json({ status: 'BintiCare + Changilwa + Lishe Kwa Mtoto webhook server running ✅' });
});

// ── Shared donation parser ──
function parseDonation(req) {
  const payload = req.body;
  const d = payload?.data || payload;
  const tx = d?.transaction || {};
  const status = (d?.status || tx?.status || '').toLowerCase();
  const completed = ['completed','complete','success'].includes(status);
  const amount = d?.Amount || d?.amount || tx?.amount || 0;
  const phone  = d?.PhoneNumber || d?.customer?.mobile_number || tx?.phone || '';
  const ref    = d?.MpesaReceiptNumber || tx?.mpesa_receipt || '';
  const firstName  = d?.first_name || d?.FirstName || d?.customer?.first_name || tx?.first_name || '';
  const lastName   = d?.last_name  || d?.LastName  || d?.customer?.last_name  || tx?.last_name  || '';
  const fullName   = (firstName + ' ' + lastName).trim();
  return { completed, amount: Number(amount), phone, ref, firstName, lastName, displayName: fullName || null, raw: d };
}

// ══════════════════════════════
//  BINTI CARE WEBHOOK
// ══════════════════════════════
app.post('/webhook/paynecta', async (req, res) => {
  try {
    console.log('BintiCare webhook received:', JSON.stringify(req.body, null, 2));
    const p = parseDonation(req);
    if (!p.completed) { console.log('BintiCare: not completed, skipping'); return res.json({ received: true }); }
    await bintiDb.collection('donations').add({
      amount: p.amount, phone: p.phone, displayName: p.displayName || 'M-Pesa Donor',
      firstName: p.firstName, lastName: p.lastName, reference: p.ref,
      source: 'paynecta', timestamp: admin.firestore.FieldValue.serverTimestamp(), raw: p.raw
    });
    console.log('✅ BintiCare donation saved: KES', p.amount);
    res.json({ success: true });
  } catch (err) { console.error('BintiCare error:', err); res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════
//  CHANGILWA WEBHOOK
// ══════════════════════════════
app.post('/webhook/changilwa', async (req, res) => {
  try {
    console.log('Changilwa webhook received:', JSON.stringify(req.body, null, 2));
    const p = parseDonation(req);
    if (!p.completed) { console.log('Changilwa: not completed, skipping'); return res.json({ received: true }); }
    await changilwaDb.collection('donations').add({
      amount: p.amount, phone: p.phone, displayName: p.displayName || 'M-Pesa Supporter',
      firstName: p.firstName, lastName: p.lastName, reference: p.ref,
      source: 'paynecta', timestamp: admin.firestore.FieldValue.serverTimestamp(), raw: p.raw
    });
    console.log('✅ Changilwa donation saved: KES', p.amount);
    res.json({ success: true });
  } catch (err) { console.error('Changilwa error:', err); res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════
//  LISHE KWA MTOTO WEBHOOK
// ══════════════════════════════
app.post('/webhook/lishe', async (req, res) => {
  try {
    console.log('Lishe webhook received:', JSON.stringify(req.body, null, 2));
    const p = parseDonation(req);
    if (!p.completed) { console.log('Lishe: not completed, skipping'); return res.json({ received: true }); }
    await lisheDb.collection('donations').add({
      amount: p.amount, phone: p.phone, displayName: p.displayName || 'Kind Donor',
      firstName: p.firstName, lastName: p.lastName, reference: p.ref,
      source: 'paynecta', timestamp: admin.firestore.FieldValue.serverTimestamp(), raw: p.raw
    });
    console.log('✅ Lishe donation saved: KES', p.amount);
    res.json({ success: true });
  } catch (err) { console.error('Lishe error:', err); res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
