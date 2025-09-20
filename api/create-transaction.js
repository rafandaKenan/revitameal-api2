// api/create-transaction.js
const midtransClient = require('midtrans-client');
const cors = require('cors');

// CORS middleware configuration
const corsMiddleware = cors({
  origin: '*',
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
});

// Helper function to run middleware
function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}

// Initialize Midtrans Snap
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

module.exports = async (req, res) => {
  try {
    // Handle CORS
    await runMiddleware(req, res, corsMiddleware);
    
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    // Only allow POST method
    if (req.method !== 'POST') {
      return res.status(405).json({ 
        error: 'Method Not Allowed',
        message: 'Only POST method is allowed' 
      });
    }

    // Check if request body exists
    if (!req.body) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Request body is required'
      });
    }

    // Validate required fields
    const { transaction_details, customer_details, item_details } = req.body;
    
    if (!transaction_details || !transaction_details.gross_amount) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'transaction_details with gross_amount is required'
      });
    }

    // Create parameter object
    const parameter = {
      ...req.body,
      transaction_details: {
        ...transaction_details,
        // FIX: Proper template literal syntax
        order_id: `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
      },
      credit_card: {
        secure: true
      }
    };

    console.log('Creating transaction with parameter:', JSON.stringify(parameter, null, 2));

    // Create transaction with Midtrans
    const transaction = await snap.createTransaction(parameter);
    
    console.log('Transaction created successfully:', transaction);

    // Send successful response
    return res.status(200).json({
      success: true,
      snapToken: transaction.token,
      redirect_url: transaction.redirect_url
    });

  } catch (error) {
    console.error("Error creating Midtrans transaction:", error);

    // Handle Midtrans API errors
    if (error.httpStatusCode) {
      const statusCode = parseInt(error.httpStatusCode, 10);
      const errorMessages = error.ApiResponse?.error_messages || [error.message || "Payment gateway error"];
      
      return res.status(statusCode).json({
        success: false,
        error: "Midtrans API Error",
        message: errorMessages[0],
        error_details: errorMessages,
        midtrans_status_code: statusCode
      });
    }

    // Handle other errors (network, validation, etc.)
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: error.message || "An unexpected error occurred"
    });
  }
};
