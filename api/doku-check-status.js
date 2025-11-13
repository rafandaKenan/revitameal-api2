const crypto = require('crypto');

/**
 * DOKU Check Status API
 * Endpoint: /api/doku-check-status
 * Method: POST
 * 
 * Fungsi: Cek status transaksi di DOKU berdasarkan order_id
 * Berguna untuk fallback jika webhook gagal atau untuk manual check
 * 
 * Environment Variables Required:
 * - DOKU_CLIENT_ID
 * - DOKU_SECRET_KEY
 * - DOKU_BASE_URL
 */

// === HELPER FUNCTIONS ===

/**
 * Generate Request-Id yang unik
 */
function generateRequestId() {
  return crypto.randomUUID();
}

/**
 * Generate timestamp dalam format ISO8601 UTC
 */
function generateTimestamp() {
  return new Date().toISOString().split('.')[0] + 'Z';
}

/**
 * Generate Signature untuk GET request (tanpa Digest)
 */
function generateSignature(clientId, requestId, requestTimestamp, requestTarget, secretKey) {
  // Untuk GET request, tidak ada Digest
  let componentSignature = `Client-Id:${clientId}`;
  componentSignature += '\n';
  componentSignature += `Request-Id:${requestId}`;
  componentSignature += '\n';
  componentSignature += `Request-Timestamp:${requestTimestamp}`;
  componentSignature += '\n';
  componentSignature += `Request-Target:${requestTarget}`;

  // Generate HMAC-SHA256
  const hmac = crypto.createHmac('sha256', secretKey)
    .update(componentSignature)
    .digest();
  
  const signature = Buffer.from(hmac).toString('base64');
  
  return `HMACSHA256=${signature}`;
}

// === MAIN HANDLER ===

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Accept both POST and GET
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      message: 'Method Not Allowed. Use POST or GET.' 
    });
  }

  try {
    // === EXTRACT ORDER ID ===
    const orderId = req.method === 'POST' 
      ? req.body.order_id 
      : req.query.order_id;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'order_id is required'
      });
    }

    console.log('=== Checking DOKU Status ===');
    console.log('Order ID:', orderId);

    // === ENVIRONMENT VARIABLES ===
    const clientId = process.env.DOKU_CLIENT_ID;
    const secretKey = process.env.DOKU_SECRET_KEY;
    const baseUrl = process.env.DOKU_BASE_URL || 'https://api-sandbox.doku.com';

    if (!clientId || !secretKey) {
      throw new Error('DOKU credentials not configured');
    }

    // === PREPARE REQUEST ===
    // DOKU Check Status API Endpoint
    // Format: GET /orders/v1/status/{invoice_number}
    const endpoint = `/orders/v1/status/${orderId}`;
    const apiUrl = `${baseUrl}${endpoint}`;

    // Generate request components
    const requestId = generateRequestId();
    const requestTimestamp = generateTimestamp();
    
    // Generate signature (untuk GET tidak ada Digest)
    const signature = generateSignature(
      clientId,
      requestId,
      requestTimestamp,
      endpoint,
      secretKey
    );

    // Construct headers
    const headers = {
      'Client-Id': clientId,
      'Request-Id': requestId,
      'Request-Timestamp': requestTimestamp,
      'Signature': signature
    };

    console.log('API URL:', apiUrl);
    console.log('Headers:', headers);

    // === CALL DOKU API ===
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: headers
    });

    const responseData = await response.json();

    console.log('=== DOKU Status Response ===');
    console.log('Status Code:', response.status);
    console.log('Response:', JSON.stringify(responseData, null, 2));

    // === HANDLE RESPONSE ===
    
    if (!response.ok) {
      // Handle error response
      return res.status(response.status).json({
        success: false,
        message: 'Failed to get transaction status',
        error: responseData
      });
    }

    // Parse response
    const transactionStatus = responseData.transaction?.status;
    const orderInfo = responseData.order;
    const paymentInfo = responseData.payment;

    // Return normalized response
    return res.status(200).json({
      success: true,
      message: 'Status retrieved successfully',
      data: {
        orderId: orderId,
        status: transactionStatus, // SUCCESS, PENDING, FAILED, EXPIRED, dll
        amount: orderInfo?.amount,
        currency: orderInfo?.currency || 'IDR',
        paymentMethod: paymentInfo?.payment_method_types?.[0] || 'N/A',
        transactionDate: responseData.transaction?.date,
        // Include full response untuk reference
        fullResponse: responseData
      }
    });

  } catch (error) {
    console.error('=== Error Checking Status ===');
    console.error('Error:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to check transaction status',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * CARA PENGGUNAAN:
 * 
 * 1. Dari Frontend (JavaScript):
 * 
 * const response = await fetch('/api/doku-check-status', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ 
 *     order_id: 'REVITAMEAL-1234567890-abc123' 
 *   })
 * });
 * 
 * const data = await response.json();
 * console.log('Status:', data.data.status); // SUCCESS, PENDING, FAILED, etc.
 * 
 * 
 * 2. Dari URL (GET):
 * 
 * https://revitameal-api2.vercel.app/api/doku-check-status?order_id=REVITAMEAL-xxx
 * 
 * 
 * 3. Response Format:
 * 
 * {
 *   "success": true,
 *   "message": "Status retrieved successfully",
 *   "data": {
 *     "orderId": "REVITAMEAL-1234567890",
 *     "status": "SUCCESS",
 *     "amount": 150000,
 *     "currency": "IDR",
 *     "paymentMethod": "VIRTUAL_ACCOUNT_BCA",
 *     "transactionDate": "2025-01-15T10:30:00Z"
 *   }
 * }
 */
