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
 * Generate signature untuk format BARU (Signature, Request-Timestamp)
 */
function generateSignatureNew(clientId, secretKey, requestId, requestTimestamp, requestTarget, body) {
  const bodyString = JSON.stringify(body);
  const digest = crypto.createHash('sha256').update(bodyString).digest('base64');
  const signatureBase = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${requestTimestamp}\nRequest-Target:${requestTarget}\nDigest:${digest}`;
  
  console.log('🔐 [NEW FORMAT DEBUG]');
  console.log('Client-Id:', clientId);
  console.log('Request-Id:', requestId);
  console.log('Request-Timestamp:', requestTimestamp);
  console.log('Request-Target:', requestTarget);
  console.log('Digest:', digest);
  console.log('Signature Base:', signatureBase);
  
  const hmac = crypto.createHmac('sha256', secretKey).update(signatureBase).digest('base64');
  const fullSignature = `HMACSHA256=${hmac}`;
  
  console.log('Generated Signature:', fullSignature);
  
  return fullSignature;
}

/**
 * Generate signature untuk format LAMA (X-SIGNATURE, X-TIMESTAMP)
 */
function generateSignatureOld(secretKey, requestId, timestamp, requestTarget, body) {
  const bodyString = JSON.stringify(body);
  const digest = crypto.createHash('sha256').update(bodyString).digest('base64');
  const signatureBase = `Client-Id:${process.env.DOKU_CLIENT_ID}\nRequest-Id:${requestId}\nRequest-Timestamp:${timestamp}\nRequest-Target:${requestTarget}\nDigest:${digest}`;
  
  console.log('🔐 [OLD FORMAT DEBUG]');
  console.log('Client-Id:', process.env.DOKU_CLIENT_ID);
  console.log('Request-Id:', requestId);
  console.log('Request-Timestamp:', timestamp);
  console.log('Request-Target:', requestTarget);
  console.log('Body Length:', bodyString.length);
  console.log('Digest:', digest);
  console.log('Signature Base:', signatureBase);
  
  const hmac = crypto.createHmac('sha256', secretKey).update(signatureBase).digest('base64');
  const fullSignature = `HMACSHA256=${hmac}`;
  
  console.log('Generated Signature:', fullSignature);
  
  return fullSignature;
}

/**
 * Simpan log notifikasi ke Firestore
 */
async function saveNotificationLog(orderId, data, headers) {
  try {
    console.log(`📦 [LOG] Saving notification log for Order ID ${orderId}`);
    
    await db.collection('webhook_logs').add({
      orderId,
      data,
      headers: {
        requestId: headers.requestId,
        timestamp: headers.timestamp,
        signatureFormat: headers.format
      },
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
async function updateOrderStatus(orderId, paymentStatus, transactionData) {
  try {
    console.log(`🔄 [DB] Updating order ${orderId} status → ${paymentStatus}`);
    
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

/**
 * Kirim email / webhook setelah pembayaran sukses
 */
async function sendPaymentSuccessEmail(orderId, email) {
  try {
    console.log(`📧 [EMAIL] Payment success for ${orderId} — sending email to ${email}`);
    // TODO: Integrasikan ke mail service
  } catch (error) {
    console.error('❌ Error sending email:', error);
  }
}

// ======== Main Handler ======== //
export default async function handler(req, res) {
  // Log semua request yang masuk (untuk debugging)
  console.log('🚨 [INCOMING REQUEST]', {
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString()
  });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const log = process.env.NODE_ENV !== 'production' ? console.log : () => {};

  try {
    const body = req.body;
    const headers = req.headers;
    
    log('📨 DOKU Notification Received');
    log('📋 Body:', JSON.stringify(body, null, 2));
    log('📋 All Headers:', Object.keys(headers));

    // ✅ DOKU mengirim 2 format header sekaligus untuk backward compatibility
    // Format BARU: Client-Id, Request-Id, Request-Timestamp, Signature
    // Format LAMA: X-TIMESTAMP, X-SIGNATURE (dengan Request-Id yang sama)
    
    // Cek format mana yang ada
    const hasNewFormat = headers['signature'] || headers['Signature'];
    const hasOldFormat = headers['x-signature'] || headers['X-SIGNATURE'];
    
    let requestId, timestamp, signature, format, clientId;
    
    if (hasOldFormat) {
      // Gunakan format LAMA (X-SIGNATURE, X-TIMESTAMP)
      format = 'OLD';
      requestId = headers['request-id'] || headers['Request-Id'];
      timestamp = headers['x-timestamp'] || headers['X-TIMESTAMP'];
      signature = headers['x-signature'] || headers['X-SIGNATURE'] || '';
      
      console.log('🔄 Using OLD signature format (X-SIGNATURE)');
    } else if (hasNewFormat) {
      // Gunakan format BARU (Signature, Request-Timestamp)
      format = 'NEW';
      clientId = headers['client-id'] || headers['Client-Id'];
      requestId = headers['request-id'] || headers['Request-Id'];
      timestamp = headers['request-timestamp'] || headers['Request-Timestamp'];
      signature = headers['signature'] || headers['Signature'] || '';
      
      console.log('🔄 Using NEW signature format (Signature)');
    } else {
      console.error('❌ No signature header found');
      console.error('Available headers:', Object.keys(headers));
      return res.status(400).json({ 
        error: 'Missing signature header',
        availableHeaders: Object.keys(headers)
      });
    }
    
    // ⚠️ CRITICAL: Request-Target HARUS EXACT MATCH dengan URL di DOKU Dashboard
    // URL di DOKU: https://revitameal-api2.vercel.app/api/doku-notification
    // Maka requestTarget = /api/doku-notification
    const requestTarget = '/api/doku-notification';

    console.log('🔍 Extracted Headers:', { 
      format,
      clientId: clientId ? `${clientId.substring(0, 10)}...` : 'N/A',
      requestId: requestId || 'MISSING', 
      timestamp: timestamp || 'MISSING',
      hasSignature: !!signature,
      requestTarget
    });

    // ✅ Validasi environment variables
    if (!process.env.DOKU_CLIENT_ID || !process.env.DOKU_SECRET_KEY) {
      console.error('❌ DOKU credentials not configured');
      console.error('Available env vars:', {
        hasDokuClientId: !!process.env.DOKU_CLIENT_ID,
        hasDokuSecretKey: !!process.env.DOKU_SECRET_KEY
      });
      return res.status(500).json({ 
        error: 'Server configuration error',
        details: 'DOKU credentials missing'
      });
    }

    // ⚠️ TEMPORARY: Skip signature validation untuk debugging
    const SKIP_SIGNATURE = process.env.SKIP_SIGNATURE_VALIDATION === 'true';

    if (!SKIP_SIGNATURE) {
      // Cek headers required
      if (!requestId || !timestamp || !signature) {
        console.error('❌ Missing required headers:', { 
          requestId: !!requestId,
          timestamp: !!timestamp,
          signature: !!signature
        });
        return res.status(400).json({ 
          error: 'Missing required headers',
          received: {
            requestId: !!requestId,
            timestamp: !!timestamp,
            signature: !!signature
          }
        });
      }

      // Generate expected signature berdasarkan format
      let expectedSignature;
      
      if (format === 'OLD') {
        expectedSignature = generateSignatureOld(
          process.env.DOKU_SECRET_KEY,
          requestId,
          timestamp,
          requestTarget,
          body
        );
      } else {
        expectedSignature = generateSignatureNew(
          clientId,
          process.env.DOKU_SECRET_KEY,
          requestId,
          timestamp,
          requestTarget,
          body
        );
      }

      console.log('🔐 Signature Validation:');
      console.log('Format:', format);
      console.log('Expected:', expectedSignature);
      console.log('Received:', signature);
      console.log('Match:', signature === expectedSignature);

      if (signature !== expectedSignature) {
        console.error('❌ Invalid Signature!');
        console.error('Debug Info:', {
          format,
          requestTarget,
          bodyLength: JSON.stringify(body).length,
          timestamp,
          clientIdMatch: format === 'OLD' ? 'N/A' : (clientId === process.env.DOKU_CLIENT_ID)
        });
        
        return res.status(401).json({ 
          error: 'Invalid Signature',
          format,
          hint: 'Check: 1) DOKU_SECRET_KEY is correct, 2) Request-Target matches, 3) Client-Id matches'
        });
      }

      console.log('✅ Signature validated successfully');
    } else {
      console.log('⚠️ SIGNATURE VALIDATION SKIPPED (DEBUG MODE)');
      console.log('⚠️ Remember to disable SKIP_SIGNATURE_VALIDATION in production!');
    }

    // Extract data dari webhook
    const orderId = body.order?.invoice_number || body.order_id || 'UNKNOWN';
    const paymentStatus = body.transaction?.status?.toUpperCase() || 'UNKNOWN';
    const transactionData = body.transaction || {};
    const email = body.customer?.email || 'no-email';

    console.log(`✅ Notification verified for Order ID ${orderId} → Status: ${paymentStatus}`);

    // Save log & update DB
    await saveNotificationLog(orderId, body, { requestId, timestamp, format });
    
    const updated = await updateOrderStatus(orderId, paymentStatus, transactionData);

    if (!updated) {
      console.warn(`⚠️ Order ${orderId} not found in database`);
      // Tetap return 200 agar DOKU tidak retry
    }

    // Kirim email jika sukses
    if (paymentStatus === 'SUCCESS') {
      await sendPaymentSuccessEmail(orderId, email);
    }

    // ✅ PENTING: Selalu return 200 untuk prevent DOKU retry
    return res.status(200).json({ 
      message: 'Notification processed successfully',
      orderId,
      status: paymentStatus,
      signatureFormat: format,
      orderUpdated: updated
    });

  } catch (error) {
    console.error('💥 Error processing DOKU notification:', error);
    console.error('Error stack:', error.stack);
    
    // Return 200 even on error to prevent DOKU retries untuk non-recoverable errors
    return res.status(200).json({ 
      message: 'Notification received with errors',
      error: error.message 
    });
  }
}
