// api/simple-transaction.js
module.exports = async (req, res) => {
  console.log('=== SIMPLE MIDTRANS TEST ===');
  
  // Set CORS headers
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
    // Step 1: Check environment variables
    console.log('Step 1: Checking environment variables...');
    if (!process.env.MIDTRANS_SERVER_KEY) {
      throw new Error('MIDTRANS_SERVER_KEY not found in environment variables');
    }
    if (!process.env.MIDTRANS_CLIENT_KEY) {
      throw new Error('MIDTRANS_CLIENT_KEY not found in environment variables');
    }
    console.log('✅ Environment variables OK');

    // Step 2: Try to import midtrans-client
    console.log('Step 2: Importing midtrans-client...');
    let midtransClient;
    try {
      midtransClient = require('midtrans-client');
      console.log('✅ midtrans-client imported successfully');
    } catch (importError) {
      console.error('❌ Failed to import midtrans-client:', importError.message);
      throw new Error(`Failed to import midtrans-client: ${importError.message}`);
    }

    // Step 3: Try to initialize Snap
    console.log('Step 3: Initializing Snap client...');
    let snap;
    try {
      snap = new midtransClient.Snap({
        isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
        serverKey: process.env.MIDTRANS_SERVER_KEY,
        clientKey: process.env.MIDTRANS_CLIENT_KEY,
      });
      console.log('✅ Snap client initialized successfully');
    } catch (snapError) {
      console.error('❌ Failed to initialize Snap client:', snapError.message);
      throw new Error(`Failed to initialize Snap client: ${snapError.message}`);
    }

    // Step 4: Validate request body
    console.log('Step 4: Validating request body...');
    console.log('Request body:', req.body);
    
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }

    if (!body || !body.transaction_details || !body.transaction_details.gross_amount) {
      throw new Error('Invalid request body. transaction_details.gross_amount is required');
    }
    console.log('✅ Request body validation OK');

    // Step 5: Create transaction parameter
    console.log('Step 5: Creating transaction parameter...');
    const parameter = {
      transaction_details: {
        order_id: `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        gross_amount: body.transaction_details.gross_amount
      },
      credit_card: {
        secure: true
      }
    };
    console.log('Transaction parameter:', JSON.stringify(parameter, null, 2));
    console.log('✅ Transaction parameter created');

    // Step 6: Call Midtrans API
    console.log('Step 6: Calling Midtrans createTransaction...');
    const transaction = await snap.createTransaction(parameter);
    console.log('✅ Midtrans transaction created successfully');
    console.log('Transaction response:', {
      hasToken: !!transaction.token,
      hasRedirectUrl: !!transaction.redirect_url
    });

    // Step 7: Send response
    return res.status(200).json({
      success: true,
      message: 'Transaction created successfully',
      data: {
        snapToken: transaction.token,
        redirect_url: transaction.redirect_url,
        order_id: parameter.transaction_details.order_id
      }
    });

  } catch (error) {
    console.error('❌ Error in simple-transaction:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      step: 'Error occurred during transaction creation',
      details: {
        stack: error.stack,
        httpStatusCode: error.httpStatusCode,
        ApiResponse: error.ApiResponse
      }
    });
  }
};
