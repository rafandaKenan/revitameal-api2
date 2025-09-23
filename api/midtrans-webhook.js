const midtransClient = require('midtrans-client');
const admin = require('firebase-admin');

// --- Inisialisasi Midtrans ---
const coreApi = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// --- Inisialisasi Firebase Admin (METODE BARU YANG LEBIH AMAN) ---
// Membaca seluruh service account dari satu environment variable
if (!admin.apps.length) {
  try {
    // Pastikan environment variable ada
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      throw new Error("Environment variable FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
    }
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase Admin SDK initialized successfully.");
  } catch (e) {
    console.error('!!! Firebase Admin Initialization Error:', e.message);
  }
}
const db = admin.firestore();


// --- Helper Functions (Fungsi Bantuan) ---
// Fungsi ini dipanggil jika pembayaran sukses
async function handlePaymentSuccess(orderRef, statusResponse) {
  console.log(`✅ Payment SUCCESS for order: ${orderRef.id}`);
  try {
    await orderRef.update({
      status: 'paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentConfirmed: true,
    });
  } catch (error) {
    console.error(`Error in handlePaymentSuccess for order ${orderRef.id}:`, error);
  }
}

// Fungsi ini dipanggil jika pembayaran pending
async function handlePaymentPending(orderRef, statusResponse) {
  console.log(`⏳ Payment PENDING for order: ${orderRef.id}`);
  try {
    await orderRef.update({
      status: 'pending_payment',
      // FIX: Memberikan objek kosong {} sebagai fallback jika tidak ada instruksi pembayaran (misal: untuk QRIS)
      paymentInstructions: statusResponse.va_numbers || statusResponse.permata_va_number || statusResponse.bca_va_number || {},
      pendingAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error(`Error in handlePaymentPending for order ${orderRef.id}:`, error);
  }
}

// Fungsi ini dipanggil jika pembayaran dibatalkan
async function handlePaymentCancelled(orderRef, statusResponse) {
  console.log(`❌ Payment CANCELLED for order: ${orderRef.id}`);
  try {
    await orderRef.update({
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancellationReason: 'Payment cancelled by user or system',
    });
  } catch (error) {
    console.error(`Error in handlePaymentCancelled for order ${orderRef.id}:`, error);
  }
}

// Fungsi ini dipanggil jika pembayaran kedaluwarsa
async function handlePaymentExpired(orderRef, statusResponse) {
    console.log(`⏰ Payment EXPIRED for order: ${orderRef.id}`);
    try {
        await orderRef.update({
            status: 'expired',
            expiredAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (error) {
        console.error(`Error in handlePaymentExpired for order ${orderRef.id}:`, error);
    }
}

// Fungsi ini dipanggil jika pembayaran ditolak
async function handlePaymentDenied(orderRef, statusResponse) {
    console.log(`🚫 Payment DENIED for order: ${orderRef.id}`);
    try {
        await orderRef.update({
            status: 'denied',
            deniedAt: admin.firestore.FieldValue.serverTimestamp(),
            denialReason: statusResponse.status_message || 'Payment denied by payment processor',
        });
    } catch (error) {
        console.error(`Error in handlePaymentDenied for order ${orderRef.id}:`, error);
    }
}


// --- MAIN WEBHOOK HANDLER ---
module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Hanya izinkan method POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  console.log('=== MIDTRANS WEBHOOK RECEIVED ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  try {
    // Pastikan Firebase sudah terinisialisasi sebelum melanjutkan
    if (!admin.apps.length) {
      console.error("Firebase Admin SDK failed to initialize. Check logs above.");
      throw new Error("Firebase Admin SDK is not initialized.");
    }

    const notification = req.body;

    // Validasi payload dasar
    if (!notification || !notification.order_id || !notification.transaction_status) {
      console.error('Invalid webhook payload:', notification);
      return res.status(400).json({ error: 'Invalid notification payload' });
    }
    
    // Verifikasi notifikasi dengan Midtrans
    console.log('Verifying transaction with Midtrans...');
    const statusResponse = await coreApi.transaction.notification(notification);
    console.log('Midtrans verification response:', statusResponse);

    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;

    // Cari order di Firestore berdasarkan midtransOrderId
    console.log(`Searching for order with midtransOrderId: ${orderId}`);
    const ordersRef = db.collection('orders');
    const snapshot = await ordersRef.where('midtransOrderId', '==', orderId).limit(1).get();

    // Jika order tidak ditemukan
    if (snapshot.empty) {
        console.error('Order not found in database with midtransOrderId:', orderId);
        // Tetap kirim 200 agar Midtrans berhenti mengirim notifikasi
        return res.status(200).json({ message: 'Order not found, but webhook acknowledged.' });
    }
    
    const orderDoc = snapshot.docs[0];
    const orderRef = orderDoc.ref;
    const oldStatus = orderDoc.data()?.status;
    console.log(`Order found: ${orderDoc.id}, current status: ${oldStatus}`);

    // Logika untuk menangani berbagai status transaksi
    let newOrderStatus;
    switch (transactionStatus) {
      case 'capture':
        if (fraudStatus === 'accept') {
          newOrderStatus = 'paid';
          await handlePaymentSuccess(orderRef, statusResponse);
        } else {
          newOrderStatus = 'denied';
          await handlePaymentDenied(orderRef, statusResponse);
        }
        break;
      case 'settlement':
        newOrderStatus = 'paid';
        await handlePaymentSuccess(orderRef, statusResponse);
        break;
      case 'pending':
        newOrderStatus = 'pending_payment';
        await handlePaymentPending(orderRef, statusResponse);
        break;
      case 'cancel':
        newOrderStatus = 'cancelled';
        await handlePaymentCancelled(orderRef, statusResponse);
        break;
      case 'expire':
          newOrderStatus = 'expired';
          await handlePaymentExpired(orderRef, statusResponse);
          break;
      case 'deny':
          newOrderStatus = 'denied';
          await handlePaymentDenied(orderRef, statusResponse);
          break;
      default:
        console.warn('Unknown transaction status:', transactionStatus);
        newOrderStatus = 'unknown';
    }

    // Update data lengkap di dokumen order
    await orderRef.update({
        transactionId: statusResponse.transaction_id,
        paymentType: statusResponse.payment_type,
        transactionStatus: transactionStatus,
        fraudStatus: fraudStatus,
        grossAmount: statusResponse.gross_amount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastWebhookAt: admin.firestore.FieldValue.serverTimestamp(),
        midtransResponse: statusResponse // Simpan semua response untuk debug
    });

    console.log(`Order ${orderDoc.id} processed successfully. Status changed from '${oldStatus}' to '${newOrderStatus}'.`);
    
    // Selalu kirim status 200 OK ke Midtrans
    return res.status(200).json({ message: 'Webhook processed successfully' });

  } catch (error) {
    console.error('!!! Webhook processing error:', {
      message: error.message,
      stack: error.stack,
      requestBody: req.body,
    });
    // Penting: Tetap kirim 200 agar Midtrans tidak retry, log error untuk investigasi manual
    return res.status(200).json({ message: 'Webhook received but an internal error occurred.' });
  }
};

