// ======== Main Handler ======== //
export default async function handler(req, res) {
  console.log('🚨 [INCOMING REQUEST]', {
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString()
  });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body;
    const headers = req.headers;
    
    console.log('📨 DOKU Notification Received');
    console.log('📋 Full Request Body:', JSON.stringify(body, null, 2));
    console.log('📋 All Headers:', JSON.stringify(headers, null, 2));

    // Cek format header
    const hasNewFormat = headers['signature'] || headers['Signature'];
    const hasOldFormat = headers['x-signature'] || headers['X-SIGNATURE'];
    
    let requestId, timestamp, signature, format, clientId;
    
    if (hasOldFormat) {
      format = 'OLD';
      requestId = headers['request-id'] || headers['Request-Id'];
      timestamp = headers['x-timestamp'] || headers['X-TIMESTAMP'];
      signature = headers['x-signature'] || headers['X-SIGNATURE'] || '';
      console.log('🔄 Using OLD signature format (X-SIGNATURE)');
    } else if (hasNewFormat) {
      format = 'NEW';
      clientId = headers['client-id'] || headers['Client-Id'];
      requestId = headers['request-id'] || headers['Request-Id'];
      timestamp = headers['request-timestamp'] || headers['Request-Timestamp'];
      signature = headers['signature'] || headers['Signature'] || '';
      console.log('🔄 Using NEW signature format (Signature)');
    } else {
      console.error('❌ No signature header found');
      return res.status(400).json({ error: 'Missing signature header' });
    }
    
    const requestTarget = '/api/doku-notification';

    console.log('🔍 Extracted Headers:', { 
      format,
      clientId: clientId || 'N/A',
      requestId,
      timestamp,
      hasSignature: !!signature
    });

    // ✅ Validasi environment variables
    if (!process.env.DOKU_CLIENT_ID || !process.env.DOKU_SECRET_KEY) {
      console.error('❌ DOKU credentials not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // 🔍 CRITICAL: Tentukan apakah skip atau validate
    const SKIP_SIGNATURE = process.env.SKIP_SIGNATURE_VALIDATION === 'true';
    console.log('🔐 SKIP_SIGNATURE_VALIDATION:', SKIP_SIGNATURE);

    if (!SKIP_SIGNATURE) {
      if (!requestId || !timestamp || !signature) {
        console.error('❌ Missing required headers');
        return res.status(400).json({ error: 'Missing required headers' });
      }

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
      console.log('Expected:', expectedSignature);
      console.log('Received:', signature);
      console.log('Match:', signature === expectedSignature);

      if (signature !== expectedSignature) {
        console.error('❌ Invalid Signature! WEBHOOK REJECTED');
        return res.status(401).json({ error: 'Invalid Signature' });
      }
      console.log('✅ Signature validated successfully');
    } else {
      console.log('⚠️  SIGNATURE VALIDATION SKIPPED (DEBUG MODE)');
    }

    // 🔍 DEBUG: Extract order data dengan detail
    console.log('\n🔍 [EXTRACTING ORDER DATA]');
    console.log('body.order:', body.order);
    console.log('body.order?.invoice_number:', body.order?.invoice_number);
    console.log('body.order_id:', body.order_id);
    console.log('body.transaction:', body.transaction);
    console.log('body.transaction?.status:', body.transaction?.status);

    const orderId = body.order?.invoice_number || body.order_id || 'UNKNOWN';
    const paymentStatus = body.transaction?.status?.toUpperCase() || 'UNKNOWN';
    const transactionData = body.transaction || {};
    const email = body.customer?.email || 'no-email';

    console.log('\n✅ Extracted Values:');
    console.log('orderId:', orderId);
    console.log('paymentStatus:', paymentStatus);
    console.log('email:', email);

    // Save log & update DB
    console.log('\n📦 [SAVING LOGS]');
    await saveNotificationLog(orderId, body, { requestId, timestamp, format });
    
    console.log('\n🔄 [UPDATING DATABASE]');
    const updated = await updateOrderStatus(orderId, paymentStatus, transactionData);

    if (!updated) {
      console.warn(`⚠️ Order ${orderId} not found in database`);
    }

    // Kirim email jika sukses
    if (paymentStatus === 'SUCCESS') {
      console.log('\n📧 [SENDING EMAIL]');
      await sendPaymentSuccessEmail(orderId, email);
    }

    console.log('\n✅ [SUCCESS] Webhook processed completely\n');

    return res.status(200).json({ 
      message: 'Notification processed successfully',
      orderId,
      status: paymentStatus,
      orderUpdated: updated
    });

  } catch (error) {
    console.error('💥 Error processing DOKU notification:', error);
    console.error('Error stack:', error.stack);
    
    return res.status(200).json({ 
      message: 'Notification received with errors',
      error: error.message 
    });
  }
}
