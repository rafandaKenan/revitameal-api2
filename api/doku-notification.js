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
  } catch (error) {
    console.error('❌ Error sending email:', error);
  }
}

// ✅ Generate signature sesuai dokumentasi DOKU
function generateSignature(clientId, clientSecret, requestId, requestTimestamp, requestTarget, body) {
  // 1. Generate Digest dari body
  const digest = crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64');
  
  // 2. Buat signature base (HARUS SESUAI URUTAN INI!)
  const signatureBase = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${requestTimestamp}\nRequest-Target:${requestTarget}\nDigest:${digest}`;
  
  console.log('🔐 [SIGNATURE DEBUG]');
  console.log('Signature Base:', signatureBase);
  console.log('Digest:', digest);
  
  // 3. Generate HMAC SHA256
  const hmac = crypto.createHmac('sha256', clientSecret).update(signatureBase).digest('base64');
  
  // 4. Return dengan format HMACSHA256=
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
    
    log('📨 DOKU Notification Received');
    log('📋 Body:', JSON.stringify(body, null, 2));

    // ✅ Extract headers dengan berbagai format
    const clientId = headers['client-id'] || headers['Client-Id'];
    const requestId = headers['request-id'] || headers['Request-Id'];
    const requestTimestamp = headers['request-timestamp'] || headers['Request-Timestamp'];
    const signature = headers['signature'] || headers['Signature'] || '';
    
    // ⚠️ CRITICAL: Request-Target HARUS EXACT MATCH dengan URL di DOKU Dashboard
    // Contoh: 
    // - Jika URL di dashboard: https://yourdomain.com/api/doku-notification
    // - Maka requestTarget = '/api/doku-notification' (dengan leading slash, tanpa trailing slash)
    const requestTarget = '/api/doku-notification';

    console.log('🔍 Extracted Headers:', { 
      clientId: clientId ? `${clientId.substring(0, 10)}...` : 'MISSING',
      requestId, 
      requestTimestamp, 
      hasSignature: !!signature,
      requestTarget
    });

    // ✅ Validasi environment variables
    if (!process.env.DOKU_CLIENT_ID || !process.env.DOKU_CLIENT_SECRET) {
      console.error('❌ DOKU credentials not configured');
      return res.status(500).json({ 
        error: 'Server configuration error',
        details: 'DOKU credentials missing'
      });
    }

    // ⚠️ TEMPORARY: Skip signature validation untuk debugging
    const SKIP_SIGNATURE = process.env.SKIP_SIGNATURE_VALIDATION === 'true';

    if (!SKIP_SIGNATURE) {
      // Cek headers required
      if (!clientId || !requestId || !requestTimestamp || !signature) {
        console.error('❌ Missing headers:', { 
          clientId: !!clientId,
          requestId: !!requestId,
          requestTimestamp: !!requestTimestamp,
          signature: !!signature
        });
        return res.status(400).json({ 
          error: 'Missing required headers',
          required: ['Client-Id', 'Request-Id', 'Request-Timestamp', 'Signature']
        });
      }

      // Generate expected signature
      const expectedSignature = generateSignature(
        process.env.DOKU_CLIENT_ID,
        process.env.DOKU_SECRET_KEY,
        requestId,
        requestTimestamp,
        requestTarget,
        body
      );

      console.log('🔐 Signature Comparison:');
      console.log('Expected:', expectedSignature);
      console.log('Received:', signature);
      console.log('Match:', signature === expectedSignature);

      // Verify signature
      if (signature !== expectedSignature) {
        console.error('❌ Invalid Signature!');
        console.error('Expected:', expectedSignature);
        console.error('Received:', signature);
        
        // Debug info
        console.error('Debug Info:', {
          clientIdMatch: clientId === process.env.DOKU_CLIENT_ID,
          requestTarget,
          bodyLength: JSON.stringify(body).length
        });
        
        return res.status(401).json({ 
          error: 'Invalid Signature',
          hint: 'Check Request-Target path and ensure it matches DOKU Dashboard configuration'
        });
      }

      console.log('✅ Signature validated successfully');
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
      // Order tidak ditemukan, tapi tetap return 200 agar DOKU tidak retry
      console.warn(`⚠️ Order ${orderId} not found, but returning 200 to prevent retries`);
      return res.status(200).json({ 
        message: 'Notification received but order not found',
        orderId,
        status: paymentStatus
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
    
    // Return 200 even on error to prevent DOKU retries for non-recoverable errors
    return res.status(200).json({ 
      message: 'Notification received with errors',
      error: error.message 
    });
  }
}
