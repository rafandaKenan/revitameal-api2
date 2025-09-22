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
    return res.status(405).json({
      success: false,
      error: 'Method Not Allowed',
    });
  }

  try {
    const body = req.body;

    // Validate required fields
    if (!body || !body.transaction_details || !body.transaction_details.order_id) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'transaction_details.order_id is required from the frontend'
      });
    }

    // --- PERUBAHAN UTAMA DI SINI ---
    // Gunakan order_id dari frontend, jangan buat yang baru.
    // Tambahkan customer_details dan shipping_address dari body.
    const parameter = {
      transaction_details: {
        order_id: body.transaction_details.order_id,
        gross_amount: body.transaction_details.gross_amount
      },
      credit_card: {
        secure: true
      },
      customer_details: body.customer_details,
      item_details: body.item_details,
      // Memastikan shipping_address ditambahkan jika ada
      ...(body.shipping_address && { shipping_address: body.shipping_address })
    };

    console.log('Creating transaction with parameter:', JSON.stringify(parameter, null, 2));

    // Create transaction with Midtrans
    const transaction = await snap.createTransaction(parameter);
    
    // Send successful response
    return res.status(200).json({
      success: true,
      message: 'Transaction created successfully',
      data: {
        snapToken: transaction.token,
        redirect_url: transaction.redirect_url,
        // Kembalikan order_id yang sama untuk konsistensi
        order_id: body.transaction_details.order_id
      }
    });

  } catch (error) {
    console.error("Error creating transaction:", error);
    
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: error.message || "An unexpected error occurred",
      ...(error.ApiResponse && { details: error.ApiResponse })
    });
  }
};
