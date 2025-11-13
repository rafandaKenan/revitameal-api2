// api/doku-create-payment.js
const crypto = require('crypto');

// ✅ FIX 1: Hardcode frontend URL (bukan env var yang undefined)
const FRONTEND_URL = 'https://revitameal-82d2e.web.app';

// ✅ FIX 2: Environment variables yang benar
const DOKU_CLIENT_ID = process.env.DOKU_CLIENT_ID;
const DOKU_SECRET_KEY = process.env.DOKU_SECRET_KEY;
const DOKU_BASE_URL = 'https://api-sandbox.doku.com';

// ✅ FIX 3: Callback URL untuk webhook
const CALLBACK_URL = 'https://revitameal-api2.vercel.app/api/doku-notification';

// Helper: Generate HMAC-SHA256 signature
function generateSignature(clientId, requestId, timestamp, requestTarget, digestValue, secretKey) {
  const componentSignature = 
    `Client-Id:${clientId}\n` +
    `Request-Id:${requestId}\n` +
    `Request-Timestamp:${timestamp}\n` +
    `Request-Target:${requestTarget}`;
  
  const stringToSign = digestValue 
    ? `${componentSignature}\nDigest:${digestValue}`
    : componentSignature;

  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(stringToSign);
  return `HMACSHA256=${hmac.digest('base64')}`;
}

// Helper: Generate SHA-256 digest
function generateDigest(body) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(body));
  return `SHA-256=${hash.digest('base64')}`;
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      gross_amount, 
      order_id, 
      item_details, 
      customer_details,
      // ❌ JANGAN TERIMA callback_url dari frontend (security risk!)
    } = req.body;

    // Validation
    if (!gross_amount || !order_id || !item_details || !customer_details) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields' 
      });
    }

    // ✅ FIX 4: Generate unique invoice number (DOKU format)
    const invoiceNumber = `RM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // ✅ FIX 5: Payload sesuai DOKU API spec
    const payload = {
      order: {
        amount: Math.round(gross_amount), // Must be integer
        invoice_number: invoiceNumber,
        currency: "IDR",
        
        // ✅ Webhook callback (server-to-server)
        callback_url: CALLBACK_URL,
        
        // ✅ User redirect URLs (hardcoded, not from env)
        success_redirect_url: `${FRONTEND_URL}/payment/success`,
        failed_redirect_url: `${FRONTEND_URL}/payment/cancel`,
        
        language: "ID",
        auto_redirect: true, // ✅ Important!
        
        line_items: item_details.map(item => ({
          id: item.id || item.sku,
          name: item.name,
          price: Math.round(item.price), // Integer
          quantity: item.quantity,
          sku: item.sku || item.id,
          category: item.category || "food",
          url: "", // Optional
          image_url: "", // Optional
          type: "PRODUCT"
        }))
      },
      payment: {
        payment_due_date: 60 // Minutes
      },
      customer: {
        id: `CUST-${Date.now()}`,
        name: customer_details.first_name || customer_details.name || "Customer",
        last_name: customer_details.last_name || "",
        email: customer_details.email,
        phone: customer_details.phone,
        address: customer_details.address || "",
        city: customer_details.city || "",
        country: "ID"
      }
    };

    // ✅ FIX 6: Proper request headers
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/\.\d{3}/, ''); // Remove milliseconds
    const requestTarget = '/checkout/v1/payment';
    const digest = generateDigest(payload);
    
    const signature = generateSignature(
      DOKU_CLIENT_ID,
      requestId,
      timestamp,
      requestTarget,
      digest,
      DOKU_SECRET_KEY
    );

    console.log('=== DOKU API Request ===');
    console.log('URL:', `${DOKU_BASE_URL}${requestTarget}`);
    console.log('Invoice:', invoiceNumber);
    console.log('Amount:', gross_amount);

    // ✅ FIX 7: Call DOKU API
    const response = await fetch(`${DOKU_BASE_URL}${requestTarget}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': DOKU_CLIENT_ID,
        'Request-Id': requestId,
        'Request-Timestamp': timestamp,
        'Signature': signature,
        'Digest': digest
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    console.log('=== DOKU API Response ===');
    console.log('Status:', response.status);
    console.log('Body:', JSON.stringify(data, null, 2));

    // ✅ FIX 8: Proper error handling
    if (!response.ok) {
      console.error('❌ DOKU API Error:', data);
      return res.status(response.status).json({
        success: false,
        error: data.error?.message || 'DOKU API error',
        details: data
      });
    }

    // ✅ FIX 9: Check if response has required fields
    if (!data.response?.payment?.url) {
      console.error('❌ Invalid DOKU response - missing payment URL');
      return res.status(500).json({
        success: false,
        error: 'Invalid response from DOKU',
        details: data
      });
    }

    // ✅ Success response
    return res.status(200).json({
      success: true,
      checkoutUrl: data.response.payment.url,
      orderId: invoiceNumber,
      tokenId: data.response.payment.token_id,
      expiredDate: data.response.payment.expired_date,
      expiredDatetime: data.response.payment.expired_datetime
    });

  } catch (error) {
    console.error('❌ Payment creation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
