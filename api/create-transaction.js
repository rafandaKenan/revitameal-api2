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
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const {
      gross_amount,
      item_details,
      customer_details,
      // order_id dari client kita abaikan untuk keamanan
    } = req.body;

    // --- VALIDASI DARI KODE PERTAMA (YANG BAGUS) ---
    if (!gross_amount || !item_details || !customer_details) {
      return res.status(400).json({
        success: false,
        message: 'gross_amount, item_details, and customer_details are required',
      });
    }

    if (!customer_details.first_name || !customer_details.email) {
      return res.status(400).json({
        success: false,
        message: 'Customer details (first_name, email) are required',
      });
    }
    
    if (!Array.isArray(item_details) || item_details.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Item details must be a non-empty array',
        });
    }

    // Validasi total untuk keamanan
    const calculatedTotal = item_details.reduce((sum, item) => {
      return sum + (Number(item.price) * Number(item.quantity));
    }, 0);

    if (calculatedTotal !== Number(gross_amount)) {
      return res.status(400).json({
        success: false,
        message: `Total amount mismatch. Server calculated: ${calculatedTotal}, Client sent: ${gross_amount}`,
      });
    }

    // --- MEMBUAT ORDER ID DI SERVER DARI KODE KEDUA (BEST PRACTICE) ---
    const uniqueOrderId = `REVITAMEAL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const parameter = {
      transaction_details: {
        order_id: uniqueOrderId,
        gross_amount: Number(gross_amount),
      },
      item_details: item_details,
      customer_details: customer_details,
      credit_card: {
        secure: true,
      },
      callbacks: {
        finish: `${process.env.NEXT_PUBLIC_BASE_URL}/finish` // Contoh URL callback
      }
    };

    console.log('Creating transaction with parameter:', JSON.stringify(parameter, null, 2));

    const transaction = await snap.createTransaction(parameter);

    return res.status(200).json({
      success: true,
      message: 'Transaction created successfully',
      snapToken: transaction.token,
      redirectUrl: transaction.redirect_url,
      orderId: uniqueOrderId, // Kirim balik order_id yang dibuat server
    });

  } catch (error) {
    console.error("Error creating transaction:", error);
    const statusCode = error.httpStatusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Internal Server Error',
    });
  }
};
