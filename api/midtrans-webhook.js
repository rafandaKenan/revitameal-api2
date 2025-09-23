const midtransClient = require('midtrans-client');

// Initialize Core API client for transaction verification
const coreApi = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// Firebase Admin SDK setup
const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore();

// Helper functions (tidak ada perubahan di sini)
async function handlePaymentSuccess(orderRef, statusResponse) {
  console.log(`✅ Payment SUCCESS for order: ${orderRef.id}`);
  try {
    await orderRef.update({
      status: 'paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentConfirmed: true,
    });
  } catch (error) {
    console.error('Error in handlePaymentSuccess:', error);
  }
}

async function handlePaymentPending(orderRef, statusResponse) {
  console.log(`⏳ Payment PENDING for order: ${orderRef.id}`);
  try {
    await orderRef.update({
      status: 'pending_payment', // Samakan dengan status di frontend
      paymentInstructions: statusResponse.va_numbers || statusResponse.permata_va_number || statusResponse.bca_va_number,
      pendingAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('Error in handlePaymentPending:', error);
  }
}

async function handlePaymentCancelled(orderRef, statusResponse) {
  console.log(`❌ Payment CANCELLED for order: ${orderRef.id}`);
  try {
    await orderRef.update({
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancellationReason: 'Payment cancelled by user or system',
    });
  } catch (error) {
    console.error('Error in handlePaymentCancelled:', error);
  }
}

async function handlePaymentExpired(orderRef, statusResponse) {
    console.log(`⏰ Payment EXPIRED for order: ${orderRef.id}`);
    try {
        await orderRef.update({
            status: 'expired',
            expiredAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (error) {
        console.error('Error in handlePaymentExpired:', error);
    }
}

async function handlePaymentDenied(orderRef, statusResponse) {
    console.log(`🚫 Payment DENIED for order: ${orderRef.id}`);
    try {
        await orderRef.update({
            status: 'denied',
            deniedAt: admin.firestore.FieldValue.serverTimestamp(),
            denialReason: statusResponse.status_message || 'Payment denied by payment processor',
        });
    } catch (error) {
        console.error('Error in handlePaymentDenied:', error);
    }
}

// Fungsi handle lainnya bisa ditambahkan jika perlu (refund, challenge, dll)

// --- MAIN WEBHOOK HANDLER ---
module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  console.log('=== MIDTRANS WEBHOOK RECEIVED ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  try {
    const notification = req.body;

    if (!notification || !notification.order_id || !notification.transaction_status) {
      console.error('Invalid webhook payload:', notification);
      return res.status(400).json({ error: 'Invalid notification payload' });
    }

    console.log('Verifying transaction with Midtrans...');
    const statusResponse = await coreApi.transaction.notification(notification);
    console.log('Midtrans verification response:', statusResponse);

    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;

    // --- PERUBAHAN UTAMA: MENCARI ORDER BERDASARKAN midtransOrderId ---
    console.log(`Searching for order with midtransOrderId: ${orderId}`);
    const ordersRef = db.collection('orders');
    const snapshot = await ordersRef.where('midtransOrderId', '==', orderId).limit(1).get();

    if (snapshot.empty) {
        console.error('Order not found in database with midtransOrderId:', orderId);
        // Tetap kirim 200 OK agar Midtrans tidak retry
        return res.status(200).json({ message: 'Order not found, but webhook acknowledged.' });
    }
    
    // Ambil referensi dokumen yang ditemukan
    const orderDoc = snapshot.docs[0];
    const orderRef = orderDoc.ref;
    const oldStatus = orderDoc.data()?.status;
    console.log(`Order found: ${orderDoc.id}, current status: ${oldStatus}`);


    // --- Logika penanganan status ---
    let newOrderStatus;
    switch (transactionStatus) {
      case 'capture':
        if (fraudStatus === 'accept') {
          newOrderStatus = 'paid';
          await handlePaymentSuccess(orderRef, statusResponse);
        } else { // challenge or deny
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

    // Update final data dan log
    await orderRef.update({
        transactionId: statusResponse.transaction_id,
        paymentType: statusResponse.payment_type,
        transactionStatus: transactionStatus,
        fraudStatus: fraudStatus,
        grossAmount: statusResponse.gross_amount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastWebhookAt: admin.firestore.FieldValue.serverTimestamp(),
        midtransResponse: statusResponse // Simpan response lengkap untuk debug
    });

    console.log(`Order ${orderDoc.id} processed successfully. Status changed from '${oldStatus}' to '${newOrderStatus}'.`);
    
    return res.status(200).json({ message: 'Webhook processed successfully' });

  } catch (error) {
    console.error('!!! Webhook processing error:', {
      message: error.message,
      stack: error.stack,
      requestBody: req.body,
    });
    // Tetap kirim 200 agar Midtrans tidak terus-menerus mencoba ulang.
    // Error sudah tercatat di log Vercel untuk diperbaiki manual.
    return res.status(200).json({ message: 'Webhook received but an internal error occurred.' });
  }
};

