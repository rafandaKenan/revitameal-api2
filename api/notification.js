import admin from 'firebase-admin';
import Midtrans from 'midtrans-client';

// Inisialisasi Firebase Admin SDK jika belum diinisialisasi
if (!admin.apps.length) {
  // Pastikan FIREBASE_SERVICE_ACCOUNT diatur di Vercel Environment Variables
  // Ini adalah JSON yang di-base64-encode dari serviceAccountKey.json
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8')
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // Inisialisasi Midtrans Notification Handler
  const apiClient = new Midtrans.CoreApi();
  apiClient.apiConfig.isProduction = false; // Sesuaikan dengan mode produksi
  apiClient.apiConfig.serverKey = process.env.MIDTRANS_SERVER_KEY;

  try {
    const notification = new apiClient.Notification(req.body);

    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;
    const orderId = notification.order_id;

    console.log(`Received notification for Order ID: ${orderId}, Status: ${transactionStatus}`);

    const orderRef = db.collection('orders').doc(orderId);
    let newStatus;

    if (transactionStatus === 'capture') {
      if (fraudStatus === 'challenge') {
        newStatus = 'challenge';
      } else if (fraudStatus === 'accept') {
        newStatus = 'paid';
      }
    } else if (transactionStatus === 'settlement') {
      newStatus = 'paid';
    } else if (transactionStatus === 'cancel' || transactionStatus === 'deny' || transactionStatus === 'expire') {
      newStatus = 'failed';
    } else if (transactionStatus === 'pending') {
      newStatus = 'pending';
    }

    // Perbarui status pesanan di Firestore
    if (newStatus) {
      await orderRef.update({
        status: newStatus,
        paymentDetails: req.body,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`Order ${orderId} status updated to ${newStatus}`);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling notification:', error);
    res.status(500).send('Error');
  }
}
