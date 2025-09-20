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
    console.log('Raw request body:', req.body);
    console.log('Request headers:', req.headers);
    
    // Parse body if it's string (sometimes Vercel sends it as string)
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

    // Check if request body exists and has required fields
    if (!body || typeof body !== 'object') {
      console.error('Invalid or missing body:', body);
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Request body is required and must be JSON object'
      });
    }

    // Validate required fields
    const { transaction_details } = body;
    
    if (!transaction_details) {
      console.error('Missing transaction_details in body:', body);
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'transaction_details is required'
      });
    }

    if (!transaction_details.gross_amount) {
      console.error('Missing gross_amount in transaction_details:', transaction_details);
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

    // Create parameter object with all required fields
    const parameter = {
      transaction_details: {
        order_id: uniqueOrderId,
        gross_amount: transaction_details.gross_amount
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
      token: transaction.token ? 'Generated' : 'Missing',
      redirect_url: transaction.redirect_url ? 'Generated' : 'Missing'
    });

    // Send successful response
    return res.status(200).json({
      success: true,
      data: {
        snapToken: transaction.token,
        redirect_url: transaction.redirect_url,
        order_id: uniqueOrderId
      }
    });

  } catch (error) {
    console.error("Detailed error:", {
      message: error.message,
      stack: error.stack,
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
      message: error.message || "An unexpected error occurred",
      error_details: error.stack
    });
  }
};
