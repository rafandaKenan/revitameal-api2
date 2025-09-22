const midtransClient = require('midtrans-client');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// --- PENTING: Konfigurasi Firebase Admin SDK ---
// Pastikan variabel environment ini sudah di-set di Vercel Anda.
try {
  const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount)
    });
  }
} catch (e) {
  console.error('Firebase Admin initialization error:', e.message);
}

const db = getFirestore();
// --- Akhir Konfigurasi ---

// Initialize Core API client
const coreApi = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  console.log('=== MIDTRANS WEBHOOK RECEIVED ===');

  try {
    const notification = req.body;
    if (!notification || !notification.order_id || !notification.transaction_status) {
      return res.status(400).json({ error: 'Invalid notification payload' });
    }

    // 1. Verifikasi notifikasi dengan Midtrans (Best Practice)
    const statusResponse = await coreApi.transaction.notification(notification);
    
    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;
    
    // 2. Tentukan status baru untuk database Anda
    let newOrderStatus = 'pending';
    switch (transactionStatus) {
      case 'capture':
        if (fraudStatus === 'accept') newOrderStatus = 'paid';
        break;
      case 'settlement':
        newOrderStatus = 'paid';
        break;
      case 'cancel':
      case 'deny':
      case 'expire':
        newOrderStatus = 'cancelled'; // Menggunakan 'cancelled' agar konsisten dengan frontend
        break;
      case 'pending':
        newOrderStatus = 'pending';
        break;
      default:
        newOrderStatus = transactionStatus; // Simpan status lain jika ada
    }

    console.log(`Updating order ${orderId} to status: ${newOrderStatus}`);

    // 3. Update Dokumen di Firestore
    const orderRef = db.collection('orders').doc(orderId);
    
    await orderRef.update({
        status: newOrderStatus,
        paymentDetails: statusResponse, // Simpan seluruh detail dari Midtrans
        updatedAt: FieldValue.serverTimestamp()
    });

    console.log(`Order ${orderId} successfully updated in Firestore.`);

    // 4. Selalu kirim response 200 OK ke Midtrans
    return res.status(200).json({ message: 'Webhook processed successfully' });

  } catch (error) {
    console.error('Webhook processing error:', error.message);
    // Tetap kirim 200 OK agar Midtrans tidak mengirim ulang notifikasi yang sama
    return res.status(200).json({ message: 'Webhook received, but an error occurred during processing.' });
  }
};

