const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'teammembers-binticare'
});

const db = admin.firestore();

app.get('/', (req, res) => {
  res.json({ status: 'BintiCare webhook server running ✅' });
});

app.post('/webhook/paynecta', async (req, res) => {
  try {
    const payload = req.body;
    console.log('PayNecta webhook received:', JSON.stringify(payload));

    // PayNecta wraps data inside a "data" object
    const d = payload.data || payload;
    const transaction = d.transaction || {};
    const customer = d.customer || {};
    const link = d.link || {};
    const paymentMethod = d.payment_method || {};

    const donation = {
      firstName:   customer.first_name  || d.first_name  || '',
      lastName:    customer.last_name   || d.last_name   || '',
      phone:       customer.mobile_number || transaction.mobile_number || d.PhoneNumber || '',
      amount:      Number(transaction.amount || d.Amount || d.amount || 0),
      currency:    transaction.currency || 'KES',
      reference:   d.MpesaReceiptNumber || transaction.reference || transaction.MpesaReceiptNumber || '',
      status:      transaction.status   || d.status || 'completed',
      paymentLink: link.name || link.slug || 'binticare',
      channel:     paymentMethod.name   || 'M-Pesa',
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      rawPayload:  payload
    };

    console.log('Parsed donation:', JSON.stringify(donation));

    if (
      donation.amount > 0 &&
      (donation.status === 'completed' || donation.status === 'success' || payload.event_type === 'payment.completed')
    ) {
      const docRef = await db.collection('donations').add(donation);

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
      console.log(`⚠️ Skipped. Amount: ${donation.amount}, Status: ${donation.status}, Event: ${payload.event_type}`);
      res.status(200).json({ success: false, message: 'Payment not completed' });
    }
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

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
