const crypto = require('crypto');

/**
 * DOKU Hosted Payment Page (HPP) Integration
 * Serverless Function for Vercel
 * 
 * Environment Variables Required:
 * - DOKU_CLIENT_ID: Client ID dari DOKU Back Office
 * - DOKU_SECRET_KEY: Secret Key dari DOKU Back Office
 * - DOKU_BASE_URL: Base URL API (sandbox/production)
 * - DOKU_CALLBACK_URL: URL untuk menerima notifikasi pembayaran
 */

// === HELPER FUNCTIONS ===

/**
 * Generate Digest dari request body
 * Digest = Base64(SHA256(JSON body))
 */
function generateDigest(jsonBody) {
  const jsonString = JSON.stringify(jsonBody);
  const hash = crypto.createHash('sha256').update(jsonString, 'utf-8').digest();
  return Buffer.from(hash).toString('base64');
}

/**
 * Generate Signature untuk authentication DOKU API
 * Format: HMACSHA256=<base64_encoded_signature>
 */
function generateSignature(clientId, requestId, requestTimestamp, requestTarget, digest, secretKey) {
  // Susun komponen signature
  let componentSignature = `Client-Id:${clientId}`;
  componentSignature += '\n';
  componentSignature += `Request-Id:${requestId}`;
  componentSignature += '\n';
  componentSignature += `Request-Timestamp:${requestTimestamp}`;
  componentSignature += '\n';
  componentSignature += `Request-Target:${requestTarget}`;
  
  // Tambahkan Digest hanya untuk POST request dengan body
  if (digest) {
    componentSignature += '\n';
    componentSignature += `Digest:${digest}`;
  }

  // Generate HMAC-SHA256
  const hmac = crypto.createHmac('sha256', secretKey)
    .update(componentSignature)
    .digest();
  
  const signature = Buffer.from(hmac).toString('base64');
  
  return `HMACSHA256=${signature}`;
}

/**
 * Generate Request-Id yang unik
 * Format: UUID v4
 */
function generateRequestId() {
  return crypto.randomUUID();
}

/**
 * Generate timestamp dalam format ISO8601 UTC
 * Format: YYYY-MM-DDTHH:mm:ssZ
 */
function generateTimestamp() {
  return new Date().toISOString().split('.')[0] + 'Z';
}

// === MAIN HANDLER ===

module.exports = async (req, res) => {
  // Set CORS headers - sama seperti implementasi Midtrans sebelumnya
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST method
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      message: 'Method Not Allowed' 
    });
  }

  try {
    // === EXTRACT & VALIDATE REQUEST DATA ===
    const {
      gross_amount,
      item_details,
      customer_details,
      payment_method_types, // Optional: array of payment methods
      payment_due_date = 60, // Default 60 menit
    } = req.body;

    // Validasi field required
    if (!gross_amount || !item_details || !customer_details) {
      return res.status(400).json({
        success: false,
        message: 'gross_amount, item_details, and customer_details are required',
      });
    }

    // Validasi customer details
    if (!customer_details.first_name || !customer_details.email) {
      return res.status(400).json({
        success: false,
        message: 'Customer details (first_name, email) are required',
      });
    }

    // Validasi item details
    if (!Array.isArray(item_details) || item_details.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Item details must be a non-empty array',
      });
    }

    // Validasi total amount untuk keamanan (server-side calculation)
    const calculatedTotal = item_details.reduce((sum, item) => {
      return sum + (Number(item.price) * Number(item.quantity));
    }, 0);

    if (calculatedTotal !== Number(gross_amount)) {
      return res.status(400).json({
        success: false,
        message: `Total amount mismatch. Server calculated: ${calculatedTotal}, Client sent: ${gross_amount}`,
      });
    }

    // === GENERATE UNIQUE ORDER ID ===
    // Format: REVITAMEAL-{timestamp}-{random}
    const uniqueOrderId = `REVITAMEAL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // === PREPARE DOKU REQUEST BODY ===
    
    // Transform item_details ke format DOKU line_items
    const lineItems = item_details.map((item, index) => ({
      id: item.id || `ITEM-${index + 1}`,
      name: item.name,
      price: Number(item.price),
      quantity: Number(item.quantity),
      sku: item.sku || item.id || `SKU-${index + 1}`,
      category: item.category || 'general',
      url: item.url || process.env.NEXT_PUBLIC_BASE_URL || '',
      image_url: item.image_url || '',
      type: item.type || 'PRODUCT'
    }));

    // Construct DOKU request body
    const dokuRequestBody = {
      order: {
        amount: Number(gross_amount),
        invoice_number: uniqueOrderId,
        currency: 'IDR',
        callback_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://revitameal-82d2e.web.app'}/payment/success`,
        callback_url_cancel: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://revitameal-82d2e.web.app'}/payment/cancel`,
        language: 'ID',
        auto_redirect: true, // Auto redirect ke callback_url setelah pembayaran
        line_items: lineItems
      },
      payment: {
        payment_due_date: Number(payment_due_date), // dalam menit
      },
      customer: {
        id: customer_details.customer_id || `CUST-${Date.now()}`,
        name: customer_details.first_name,
        last_name: customer_details.last_name || '',
        email: customer_details.email,
        phone: customer_details.phone || '',
        address: customer_details.address || '',
        city: customer_details.city || '',
        country: 'ID'
      }
    };

    // Tambahkan payment_method_types jika disediakan
    if (payment_method_types && Array.isArray(payment_method_types) && payment_method_types.length > 0) {
      dokuRequestBody.payment.payment_method_types = payment_method_types;
    }

    // === PREPARE DOKU API REQUEST ===
    
    // Environment variables
    const clientId = process.env.DOKU_CLIENT_ID;
    const secretKey = process.env.DOKU_SECRET_KEY;
    const baseUrl = process.env.DOKU_BASE_URL || 'https://api-sandbox.doku.com';
    
    // Validasi environment variables
    if (!clientId || !secretKey) {
      throw new Error('DOKU_CLIENT_ID and DOKU_SECRET_KEY must be configured in environment variables');
    }

    // API endpoint
    const endpoint = '/checkout/v1/payment';
    const apiUrl = `${baseUrl}${endpoint}`;

    // Generate request headers components
    const requestId = generateRequestId();
    const requestTimestamp = generateTimestamp();
    const digest = generateDigest(dokuRequestBody);
    const signature = generateSignature(
      clientId,
      requestId,
      requestTimestamp,
      endpoint,
      digest,
      secretKey
    );

    // Construct headers
    const headers = {
      'Content-Type': 'application/json',
      'Client-Id': clientId,
      'Request-Id': requestId,
      'Request-Timestamp': requestTimestamp,
      'Signature': signature
    };

    console.log('=== DOKU API Request ===');
    console.log('URL:', apiUrl);
    console.log('Headers:', JSON.stringify(headers, null, 2));
    console.log('Body:', JSON.stringify(dokuRequestBody, null, 2));

    // === CALL DOKU API ===
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(dokuRequestBody)
    });

    const responseData = await response.json();

    console.log('=== DOKU API Response ===');
    console.log('Status:', response.status);
    console.log('Body:', JSON.stringify(responseData, null, 2));

    // === HANDLE RESPONSE ===
    
    if (!response.ok) {
      // Handle error response dari DOKU
      return res.status(response.status).json({
        success: false,
        message: responseData.message || 'Failed to create transaction',
        error: responseData
      });
    }

    // Success response
    const checkoutUrl = responseData.response?.payment?.url;
    const tokenId = responseData.response?.payment?.token_id;
    const expiredDate = responseData.response?.payment?.expired_date;

    if (!checkoutUrl) {
      throw new Error('No checkout URL received from DOKU');
    }

    // Return success response ke frontend (format mirip dengan Midtrans untuk kemudahan integrasi)
    return res.status(200).json({
      success: true,
      message: 'Transaction created successfully',
      orderId: uniqueOrderId,
      checkoutUrl: checkoutUrl, // URL untuk redirect customer ke halaman pembayaran DOKU
      redirectUrl: checkoutUrl, // Alias untuk backward compatibility
      tokenId: tokenId,
      expiredDate: expiredDate,
      dokuResponse: responseData.response // Full response dari DOKU untuk reference
    });

  } catch (error) {
    console.error('=== Error creating DOKU transaction ===');
    console.error('Error:', error);

    // Return error response
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Internal Server Error',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
