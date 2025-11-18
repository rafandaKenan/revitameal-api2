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

// ✅ Simpan log notifikasi ke Firestore
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

// ✅ Update order status di Firestore
async function updateOrderStatus(orderId, paymentStatus, transactionData) {
  try {
    console.log(`🔄 [DB] Updating order ${orderId} status → ${paymentStatus}`);
    
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
    
    if (paymentStatus === 'SUCCESS' || paymentStatus === 'PAID' || paymentStatus === 'SETTLEMENT') {
      newStatus = 'paid';
    } else if (paymentStatus === 'FAILED' || paymentStatus === 'EXPIRED' || paymentStatus === 'CANCELLED') {
      newStatus = 'cancelled';
    } else if (paymentStatus === 'PENDING') {
      newStatus = 'pending_payment';
    }

    // Update Firestore
    await orderDoc.ref.update({
      status: newStatus,
      dokuPaymentStatus: paymentStatus,
      dokuTransactionId: transactionData?.id || null,
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

// ✅ (Optional) Kirim email sukses
async function sendPaymentSuccessEmail(orderId, email) {
  try {
    console.log(`📧 [EMAIL] Payment success for ${orderId} — email: ${email}`);
    // TODO: Integrate dengan email service (SendGrid, Nodemailer, etc)
    // await sendEmail({ to: email, subject: "Payment Success", orderId });
  } catch (error) {
    console.error('❌ Error sending email:', error);
  }
}

function generateSignature(clientSecret, requestId, requestTimestamp, requestTarget, body) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64');
  const signatureBase = `Client-Id:${process.env.DOKU_CLIENT_ID}\nRequest-Id:${requestId}\nRequest-Timestamp:${requestTimestamp}\nRequest-Target:${requestTarget}\nDigest:${digest}`;
  const hmac = crypto.createHmac('sha256', clientSecret).update(signatureBase).digest('base64');
  return `HMACSHA256=${hmac}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const log = process.env.NODE_ENV !== 'production' ? console.log : () => {};

  try {
    const body = req.body;
    const headers = req.headers;
    
    log('📨 DOKU Notification Received:', JSON.stringify(body, null, 2));
    log('📋 Headers:', JSON.stringify(headers, null, 2));

    // ✅ DOKU menggunakan format ini (tanpa prefix x-)
    const requestId = headers['request-id'] || headers['Request-Id'];
    const requestTimestamp = headers['request-timestamp'] || headers['Request-Timestamp'];
    const signature = headers['signature'] || headers['Signature'] || '';
    const requestTarget = '/api/doku/notification';

    // Debug: Log semua headers untuk debugging
    console.log('🔍 All Headers:', Object.keys(headers));
    console.log('📋 Raw Headers:', JSON.stringify(headers, null, 2));
    console.log('📋 Extracted:', { 
      requestId, 
      requestTimestamp, 
      signature: signature ? 'EXISTS' : 'MISSING' 
    });

    // ⚠️ TEMPORARY: Skip signature validation untuk debugging
    const SKIP_SIGNATURE = process.env.SKIP_SIGNATURE_VALIDATION === 'true';

    if (!SKIP_SIGNATURE) {
      if (!requestId || !requestTimestamp || !signature) {
        console.error('❌ Missing headers:', { 
          requestId, 
          requestTimestamp, 
          signature: !!signature,
          availableHeaders: Object.keys(headers)
        });
        return res.status(400).json({ 
          error: 'Missing required headers',
          availableHeaders: Object.keys(headers)
        });
      }

      // Verify signature
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
    } else {
      console.log('⚠️ SIGNATURE VALIDATION SKIPPED (DEBUG MODE)');
    }

    // Extract data dari webhook
    const orderId = body.order?.invoice_number || body.order_id || 'UNKNOWN';
    const paymentStatus = body.transaction?.status?.toUpperCase() || 'UNKNOWN';
    const transactionData = body.transaction || {};
    const email = body.customer?.email || 'no-email';

    log(`✅ Notification verified for Order ID ${orderId} → Status: ${paymentStatus}`);

    // ✅ Save log ke Firestore
    await saveNotificationLog(orderId, body);
    
    // ✅ Update order status
    const updated = await updateOrderStatus(orderId, paymentStatus, transactionData);

    if (!updated) {
      return res.status(404).json({ 
        error: 'Order not found',
        orderId 
      });
    }

    // ✅ Kirim email jika sukses
    if (paymentStatus === 'SUCCESS') {
      await sendPaymentSuccessEmail(orderId, email);
    }

    return res.status(200).json({ 
      message: 'Notification processed successfully',
      orderId,
      status: paymentStatus
    });

  } catch (error) {
    console.error('💥 Error processing DOKU notification:', error);
    return res.status(500).json({ 
      error: 'Internal Server Error', 
      details: error.message 
    });
  }
}
