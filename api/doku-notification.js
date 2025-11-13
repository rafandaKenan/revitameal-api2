import crypto from 'crypto';

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
 * Simpan log notifikasi (bisa dikoneksikan ke DB)
 */
async function saveNotificationLog(orderId, data) {
  console.log(`📦 [LOG] Saving notification log for Order ID ${orderId}`);
  // TODO: Simpan ke MongoDB / PostgreSQL
  // await db.notifications.insert({ orderId, ...data });
}

/**
 * Update status pesanan di database
 */
async function updateOrderStatus(orderId, status) {
  console.log(`🔄 [DB] Updating order ${orderId} status → ${status}`);
  // TODO: Update ke database
  // await db.orders.update({ orderId }, { status });
}

/**
 * Kirim email / webhook setelah pembayaran sukses
 */
async function sendPaymentSuccessEmail(orderId, email) {
  console.log(`📧 [EMAIL] Payment success for ${orderId} — sending email to ${email}`);
  // TODO: Integrasikan ke mail service
  // await sendEmail({ to: email, subject: "Payment Success", orderId });
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

    // --- Ambil header penting ---
    const requestId = headers['x-request-id'];
    const requestTimestamp = headers['x-request-timestamp'];
    const signature = headers['x-signature'] || '';
    const requestTarget = '/api/doku/notification'; // harus sesuai path endpoint kamu

    if (!requestId || !requestTimestamp || !signature) {
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
    return res.status(200).json({ message: 'Notification processed successfully' });

  } catch (error) {
    console.error('💥 Error processing DOKU notification:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
