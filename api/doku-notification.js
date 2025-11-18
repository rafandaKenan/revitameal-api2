import crypto from 'crypto';
import admin from 'firebase-admin';

// ✅ Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      })
    });
    console.log('✅ Firebase Admin initialized');
  } catch (error) {
    console.error('❌ Firebase Admin init error:', error);
  }
}

const db = admin.firestore();

// ======== Helper Functions ======== //

/**
 * Hitung signature untuk verifikasi dari DOKU
 */
function generateSignature(clientSecret, requestId, requestTimestamp, requestTarget, body) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64');
  const signatureBase = `Client-Id:${process.env.DOKU_CLIENT_ID}\nRequest-Id:${requestId}\nRequest-Timestamp:${requestTimestamp}\nRequest-Target:${requestTarget}\nDigest:${digest}`;
  const hmac = crypto.createHmac('sha256', clientSecret).update(signatureBase).digest('base64');
  return `HMACSHA256=${hmac}`;
}

/**
 * Simpan log notifikasi ke Firestore
 */
async function saveNotificationLog(orderId, data) {
  try {
    console.log(`📦 [LOG] Saving notification log for Order ID ${orderId}`);
    
    await db.collection('webhook_logs').add({
      orderId,
      data,
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: data.transaction?.status || 'UNKNOWN'
    });
    
    console.log('✅ Webhook log saved');
  } catch (error) {
    console.error('❌ Error saving log:', error);
  }
}

/**
 * Update status pesanan di Firestore
 */
async function updateOrderStatus(orderId, status) {
  try {
    console.log(`🔄 [DB] Updating order ${orderId} status → ${status}`);
    
    // Query order by dokuOrderId
    const ordersRef = db.collection('orders');
    const q = ordersRef.where('dokuOrderId', '==', orderId);
    const snapshot = await q.get();

    if (snapshot.empty) {
      console.error(`❌ Order not found: ${orderId}`);
      return false;
    }

    const orderDoc = snapshot.docs[0];
    
    // Map DOKU status ke internal status
    let newStatus = 'pending_payment';
    
    if (status === 'SUCCESS' || status === 'PAID' || status === 'SETTLEMENT') {
      newStatus = 'paid';
    } else if (status === 'FAILED' || status === 'EXPIRED' || status === 'CANCELLED') {
      newStatus = 'cancelled';
    } else if (status === 'PENDING') {
      newStatus = 'pending_payment';
    }

    // Update Firestore
    await orderDoc.ref.update({
      status: newStatus,
      dokuPaymentStatus: status,
      webhookReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(newStatus === 'paid' ? { 
        paidAt: admin.firestore.FieldValue.serverTimestamp() 
      } : {})
    });

    console.log(`✅ Order ${orderId} updated to status: ${newStatus}`);
    return true;

  } catch (error) {
    console.error('❌ Error updating order:', error);
    return false;
  }
}

/**
 * Kirim email / webhook setelah pembayaran sukses
 */
async function sendPaymentSuccessEmail(orderId, email) {
  try {
    console.log(`📧 [EMAIL] Payment success for ${orderId} — sending email to ${email}`);
    // TODO: Integrasikan ke mail service
    // await sendEmail({ to: email, subject: "Payment Success", orderId });
  } catch (error) {
    console.error('❌ Error sending email:', error);
  }
}

// ======== Main Handler ======== //
export default async function handler(req, res) {
  // --- Hanya terima POST ---
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // --- Safe Logging: nonaktifkan di production ---
  const log = process.env.NODE_ENV !== 'production' ? console.log : () => {};

  try {
    const body = req.body;
    const headers = req.headers;
    
    log('📨 DOKU Notification Received:', JSON.stringify(body, null, 2));
    log('📋 Headers:', JSON.stringify(headers, null, 2));

    // --- Ambil header penting (PAKAI FORMAT LAMA dengan x- prefix) ---
    const requestId = headers['x-request-id'];
    const requestTimestamp = headers['x-request-timestamp'];
    const signature = headers['x-signature'] || '';
    
    // ✅ PENTING: Path harus EXACT MATCH dengan URL di DOKU Dashboard
    // Kalau URL di dashboard: https://revitameal-api2.vercel.app/api/doku-notification
    // Maka requestTarget = '/api/doku-notification'
    const requestTarget = '/api/doku-notification';

    log('🔍 Extracted Headers:', {
      requestId,
      requestTimestamp,
      hasSignature: !!signature
    });

    if (!requestId || !requestTimestamp || !signature) {
      console.error('❌ Missing required headers');
      return res.status(400).json({ error: 'Missing required headers' });
    }

    // --- Verifikasi signature ---
    const expectedSignature = generateSignature(
      process.env.DOKU_CLIENT_SECRET,
      requestId,
      requestTimestamp,
      requestTarget,
      body
    );

    if (signature !== expectedSignature) {
      console.error('❌ Invalid Signature!');
      console.error('Expected:', expectedSignature);
      console.error('Received:', signature);
      return res.status(401).json({ error: 'Invalid Signature' });
    }

    // --- Proses notifikasi ---
    const orderId = body.order?.invoice_number || body.order_id || 'UNKNOWN';
    const status = body.transaction?.status?.toUpperCase() || 'UNKNOWN';
    const email = body.customer?.email || 'no-email';

    log(`✅ Notification verified for Order ID ${orderId} → Status: ${status}`);

    // --- Simpan log & update DB ---
    await saveNotificationLog(orderId, body);

    if (status === 'SUCCESS') {
      await updateOrderStatus(orderId, 'SUCCESS');
      await sendPaymentSuccessEmail(orderId, email);
    } else if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(status)) {
      await updateOrderStatus(orderId, 'FAILED');
    } else if (status === 'PENDING') {
      await updateOrderStatus(orderId, 'PENDING');
    } else {
      log(`⚠️ Unrecognized status: ${status}`);
    }

    // --- Balasan ke DOKU ---
    return res.status(200).json({ 
      message: 'Notification processed successfully',
      orderId,
      status
    });

  } catch (error) {
    console.error('💥 Error processing DOKU notification:', error);
    return res.status(500).json({ 
      error: 'Internal Server Error', 
      details: error.message 
    });
  }
}
