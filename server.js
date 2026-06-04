const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// ── Firebase: BintiCare ──
const bintiServiceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
const bintiApp = admin.initializeApp({
  credential: admin.credential.cert(bintiServiceAccount)
}, 'binticare');
const bintiDb = admin.firestore(bintiApp);

// ── Firebase: Changilwa Campaign ──
const changilwaServiceAccount = JSON.parse(process.env.CHANGILWA_SERVICE_ACCOUNT_JSON);
const changilwaApp = admin.initializeApp({
  credential: admin.credential.cert(changilwaServiceAccount)
}, 'changilwa');
const changilwaDb = admin.firestore(changilwaApp);

// ── Health check ──
app.get('/', (req, res) => {
  res.json({ status: 'BintiCare + Changilwa webhook server running ✅' });
});

// ══════════════════════════════
//  BINTI CARE WEBHOOK
// ══════════════════════════════
app.post('/webhook/paynecta', async (req, res) => {
  try {
    console.log('BintiCare webhook received:', JSON.stringify(req.body, null, 2));
    const payload = req.body;
    const d = payload?.data || payload;
    const tx = d?.transaction || {};

    const status = (d?.status || tx?.status || '').toLowerCase();
    if (status !== 'completed' && status !== 'complete' && status !== 'success') {
      console.log('BintiCare: Payment not completed, skipping. Status:', status);
      return res.json({ received: true });
    }

    const amount = d?.Amount || d?.amount || tx?.amount || 0;
    const phone  = d?.PhoneNumber || d?.customer?.mobile_number || tx?.phone || '';
    const ref    = d?.MpesaReceiptNumber || tx?.mpesa_receipt || '';
    const last4  = phone.slice(-4);

    const firstName  = d?.first_name || d?.FirstName || d?.customer?.first_name || tx?.first_name || '';
    const lastName   = d?.last_name  || d?.LastName  || d?.customer?.last_name  || tx?.last_name  || '';
    const fullName   = (firstName + ' ' + lastName).trim();
    const displayName = fullName || 'M-Pesa Donor';

    const donation = {
      amount: Number(amount),
      phone,
      displayName,
      firstName,
      lastName,
      reference: ref,
      source: 'paynecta',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      raw: d
    };

    await bintiDb.collection('donations').add(donation);
    console.log('✅ BintiCare donation saved: KES', amount, 'from', displayName);
    res.json({ success: true });
  } catch (err) {
    console.error('BintiCare webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════
//  CHANGILWA WEBHOOK
// ══════════════════════════════
app.post('/webhook/changilwa', async (req, res) => {
  try {
    console.log('Changilwa webhook received:', JSON.stringify(req.body, null, 2));
    const payload = req.body;
    const d = payload?.data || payload;
    const tx = d?.transaction || {};

    const status = (d?.status || tx?.status || '').toLowerCase();
    if (status !== 'completed' && status !== 'complete' && status !== 'success') {
      console.log('Changilwa: Payment not completed, skipping. Status:', status);
      return res.json({ received: true });
    }

    const amount = d?.Amount || d?.amount || tx?.amount || 0;
    const phone  = d?.PhoneNumber || d?.customer?.mobile_number || tx?.phone || '';
    const ref    = d?.MpesaReceiptNumber || tx?.mpesa_receipt || '';

    const firstName  = d?.first_name || d?.FirstName || d?.customer?.first_name || tx?.first_name || '';
    const lastName   = d?.last_name  || d?.LastName  || d?.customer?.last_name  || tx?.last_name  || '';
    const fullName   = (firstName + ' ' + lastName).trim();
    const displayName = fullName || 'M-Pesa Supporter';

    const donation = {
      amount: Number(amount),
      phone,
      displayName,
      firstName,
      lastName,
      reference: ref,
      source: 'paynecta',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      raw: d
    };

    await changilwaDb.collection('donations').add(donation);
    console.log('✅ Changilwa donation saved: KES', amount, 'from', displayName);
    res.json({ success: true });
  } catch (err) {
    console.error('Changilwa webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ BintiCare + Changilwa webhook server running on port ${PORT}`));
