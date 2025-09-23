// api/create-transaction.js (Vercel)

import midtransClient from 'midtrans-client';

const snap = new midtransClient.Snap({
  isProduction: process.env.NODE_ENV === 'production',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

export default async function handler(req, res) {
  // IMPORTANT: Set CORS headers FIRST before any other logic
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST method for actual transaction
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed. Use POST.',
    });
  }

  try {
    const {
      transaction_details,
      customer_details,
      shipping_address,
      item_details,
      expiry,
      callbacks
    } = req.body;

    // Validasi input
    if (!transaction_details?.order_id || !transaction_details?.gross_amount) {
      return res.status(400).json({
        success: false,
        message: 'Transaction details (order_id, gross_amount) are required',
      });
    }

    if (!customer_details?.first_name || !customer_details?.email) {
      return res.status(400).json({
        success: false,
        message: 'Customer details (first_name, email) are required',
      });
    }

    if (!item_details || !Array.isArray(item_details) || item_details.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Item details are required and must be an array',
      });
    }

    // Validasi total
    const calculatedTotal = item_details.reduce((sum, item) => {
      return sum + (Number(item.price) * Number(item.quantity));
    }, 0);

    if (calculatedTotal !== Number(transaction_details.gross_amount)) {
      return res.status(400).json({
        success: false,
        message: `Total amount mismatch. Expected: ${calculatedTotal}, Received: ${transaction_details.gross_amount}`,
      });
    }

    // Parameter Midtrans
    const parameter = {
      transaction_details: {
        order_id: String(transaction_details.order_id),
        gross_amount: Number(transaction_details.gross_amount),
      },
      credit_card: {
        secure: true,
      },
      customer_details: {
        first_name: String(customer_details.first_name),
        last_name: String(customer_details.last_name || ''),
        email: String(customer_details.email),
        phone: String(customer_details.phone || ''),
      },
      item_details: item_details.map(item => ({
        id: String(item.id || 'item'),
        price: Number(item.price),
        quantity: Number(item.quantity),
        name: String(item.name),
        category: String(item.category || 'general'),
      })),
    };

    // Add optional fields
    if (shipping_address) {
      parameter.shipping_address = {
        first_name: String(shipping_address.first_name || ''),
        last_name: String(shipping_address.last_name || ''),
        phone: String(shipping_address.phone || ''),
        address: String(shipping_address.address || ''),
      };
    }

    if (expiry) {
      parameter.expiry = {
        start_time: expiry.start_time || new Date().toISOString().slice(0, 19) + ' +0700',
        unit: expiry.unit || 'minutes',
        duration: Number(expiry.duration) || 30,
      };
    }

    console.log('Creating transaction with parameter:', JSON.stringify(parameter, null, 2));

    // Create transaction
    const transaction = await snap.createTransaction(parameter);

    return res.status(200).json({
      success: true,
      message: 'Transaction created successfully',
      data: {
        snapToken: transaction.token,
        redirectUrl: transaction.redirect_url,
        orderId: transaction_details.order_id,
      },
    });

  } catch (error) {
    console.error('Transaction creation error:', error);

    if (error.httpStatusCode) {
      return res.status(error.httpStatusCode).json({
        success: false,
        message: `Midtrans Error: ${error.message}`,
        details: error.ApiResponse || null,
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    });
  }
}
