// api/create-transaction.js
const midtransClient = require('midtrans-client');

// Initialize Midtrans Snap
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST method
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    return res.status(405).json({ 
      success: false,
      error: 'Method Not Allowed',
      message: `Method ${req.method} is not allowed. Use POST.`
    });
  }

  try {
    console.log('Request received:', {
      method: req.method,
      body: req.body,
      bodyType: typeof req.body
    });

    // Parse body if needed
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        return res.status(400).json({
          success: false,
          error: 'Invalid JSON',
          message: 'Request body must be valid JSON'
        });
      }
    }

    // Validate required fields
    if (!body || !body.transaction_details || !body.transaction_details.gross_amount) {
      console.error('Missing required fields in body:', body);
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'transaction_details.gross_amount is required'
      });
    }

    // Create unique order ID
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substr(2, 5);
    const uniqueOrderId = `ORDER-${timestamp}-${randomString}`;

    // Create parameter object
    const parameter = {
      transaction_details: {
        order_id: uniqueOrderId,
        gross_amount: body.transaction_details.gross_amount
      },
      credit_card: {
        secure: true
      },
      // Include optional fields if provided
      ...(body.customer_details && { customer_details: body.customer_details }),
      ...(body.item_details && { item_details: body.item_details }),
      ...(body.callbacks && { callbacks: body.callbacks })
    };

    console.log('Creating transaction with parameter:', JSON.stringify(parameter, null, 2));

    // Create transaction with Midtrans
    const transaction = await snap.createTransaction(parameter);
    
    console.log('Transaction created successfully:', {
      hasToken: !!transaction.token,
      hasRedirectUrl: !!transaction.redirect_url,
      orderId: uniqueOrderId
    });

    // Send successful response
    return res.status(200).json({
      success: true,
      message: 'Transaction created successfully',
      data: {
        snapToken: transaction.token,
        redirect_url: transaction.redirect_url,
        order_id: uniqueOrderId
      }
    });

  } catch (error) {
    console.error("Error creating transaction:", {
      message: error.message,
      httpStatusCode: error.httpStatusCode,
      ApiResponse: error.ApiResponse
    });

    // Handle Midtrans API errors
    if (error.httpStatusCode) {
      const statusCode = parseInt(error.httpStatusCode, 10);
      let errorMessages = ['Payment gateway error'];
      
      if (error.ApiResponse?.error_messages) {
        errorMessages = error.ApiResponse.error_messages;
      } else if (error.message) {
        errorMessages = [error.message];
      }
      
      return res.status(statusCode).json({
        success: false,
        error: "Midtrans API Error",
        message: errorMessages[0],
        error_details: errorMessages,
        midtrans_status_code: statusCode
      });
    }

    // Handle other errors
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: error.message || "An unexpected error occurred"
    });
  }
};
