const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// ── Firebase Admin Setup ──
// Uses environment variable SERVICE_ACCOUNT_JSON set in Render dashboard
const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'teammembers-binticare'
});

const db = admin.firestore();

// ── Health check ──
app.get('/', (req, res) => {
  res.json({ status: 'BintiCare webhook server running ✅' });
});

// ── PayNecta Webhook Endpoint ──
app.post('/webhook/paynecta', async (req, res) => {
  try {
    const payload = req.body;
    console.log('PayNecta webhook received:', JSON.stringify(payload));

    // Extract donation data from PayNecta payload
    const donation = {
      firstName:    payload.first_name   || payload.firstName   || '',
      lastName:     payload.last_name    || payload.lastName    || '',
      phone:        payload.phone        || payload.msisdn       || '',
      amount:       Number(payload.amount || payload.Amount || 0),
      currency:     'KES',
      reference:    payload.reference    || payload.MpesaReceiptNumber || payload.transaction_id || '',
      status:       payload.status       || 'completed',
      paymentLink:  payload.payment_link || payload.link_slug   || 'binticare',
      channel:      payload.channel      || 'M-Pesa',
      createdAt:    admin.firestore.FieldValue.serverTimestamp(),
      rawPayload:   payload
    };

    // Only save completed payments
    if (
      donation.amount > 0 ||
      payload.status === 'completed' ||
      payload.status === 'success' ||
      payload.ResultCode === '0' ||
      payload.ResultCode === 0
    ) {
      // Save donation to Firestore
      const docRef = await db.collection('donations').add(donation);

      // Update donation stats summary
      const statsRef = db.collection('stats').doc('donations');
      await db.runTransaction(async (t) => {
        const statsDoc = await t.get(statsRef);
        if (statsDoc.exists) {
          t.update(statsRef, {
            totalAmount: admin.firestore.FieldValue.increment(donation.amount),
            totalDonors: admin.firestore.FieldValue.increment(1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
        } else {
          t.set(statsRef, {
            totalAmount: donation.amount,
            totalDonors: 1,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      });

      console.log(`✅ Donation saved: KES ${donation.amount} from ${donation.firstName} ${donation.lastName} [${docRef.id}]`);
      res.status(200).json({ success: true, id: docRef.id });
    } else {
      console.log('⚠️ Payment not completed, skipping save.');
      res.status(200).json({ success: false, message: 'Payment not completed' });
    }
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Get donation stats (used by website) ──
app.get('/stats', async (req, res) => {
  try {
    const statsDoc = await db.collection('stats').doc('donations').get();
    if (statsDoc.exists) {
      res.json(statsDoc.data());
    } else {
      res.json({ totalAmount: 0, totalDonors: 0 });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ BintiCare webhook server running on port ${PORT}`);
});
