// api/create-transaction.js (untuk Vercel)
// atau bisa juga untuk Express.js

import midtransClient from 'midtrans-client';

// Konfigurasi Midtrans
const snap = new midtransClient.Snap({
  isProduction: process.env.NODE_ENV === 'production', // true untuk production
  serverKey: process.env.MIDTRANS_SERVER_KEY, // Server Key dari Midtrans Dashboard
  clientKey: process.env.MIDTRANS_CLIENT_KEY, // Client Key dari Midtrans Dashboard
});

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Atau domain specific: 'https://yourdomain.com'
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  // Handle preflight CORS request
  if (req.method === 'OPTIONS') {
    return res.status(200).setHeader(corsHeaders).end();
  }

  // Set CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

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

    // Validasi input yang diperlukan
    if (!transaction_details || !transaction_details.order_id || !transaction_details.gross_amount) {
      return res.status(400).json({
        success: false,
        message: 'Transaction details (order_id, gross_amount) are required',
      });
    }

    if (!customer_details || !customer_details.first_name || !customer_details.email) {
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

    // Validasi gross_amount dengan total item_details
    const calculatedTotal = item_details.reduce((sum, item) => {
      return sum + (item.price * item.quantity);
    }, 0);

    if (calculatedTotal !== transaction_details.gross_amount) {
      return res.status(400).json({
        success: false,
        message: `Gross amount mismatch. Expected: ${calculatedTotal}, Received: ${transaction_details.gross_amount}`,
      });
    }

    // Buat parameter Midtrans dengan format yang benar
    const parameter = {
      transaction_details: {
        order_id: transaction_details.order_id,
        gross_amount: transaction_details.gross_amount,
      },
      credit_card: {
        secure: true, // Untuk 3DS
      },
      customer_details: {
        first_name: customer_details.first_name,
        last_name: customer_details.last_name || '',
        email: customer_details.email,
        phone: customer_details.phone || '',
      },
      item_details: item_details.map(item => ({
        id: item.id || 'item',
        price: item.price,
        quantity: item.quantity,
        name: item.name,
        category: item.category || 'general',
      })),
      // Optional: Shipping address
      ...(shipping_address && {
        shipping_address: {
          first_name: shipping_address.first_name,
          last_name: shipping_address.last_name || '',
          phone: shipping_address.phone || '',
          address: shipping_address.address,
        }
      }),
      // Optional: Expiry
      ...(expiry && {
        expiry: {
          start_time: expiry.start_time || new Date().toISOString().slice(0, 19) + ' +0700',
          unit: expiry.unit || 'minutes',
          duration: expiry.duration || 30,
        }
      }),
      // Optional: Callbacks
      ...(callbacks && {
        callbacks: {
          finish: callbacks.finish,
          unfinish: callbacks.unfinish,
          error: callbacks.error,
        }
      }),
    };

    console.log('Creating Midtrans transaction with parameter:', JSON.stringify(parameter, null, 2));

    // Buat transaksi ke Midtrans
    const transaction = await snap.createTransaction(parameter);

    console.log('Midtrans response:', transaction);

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
    console.error('Midtrans transaction creation error:', error);

    // Handle specific Midtrans errors
    if (error.httpStatusCode) {
      return res.status(error.httpStatusCode).json({
        success: false,
        message: `Midtrans Error: ${error.message}`,
        details: error.ApiResponse || error.rawHttpClientData,
      });
    }

    // Handle general errors
    return res.status(500).json({
      success: false,
      message: 'Internal server error while creating transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    });
  }
}

// Untuk Express.js alternative:
/*
const express = require('express');
const midtransClient = require('midtrans-client');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Konfigurasi Midtrans
const snap = new midtransClient.Snap({
  isProduction: process.env.NODE_ENV === 'production',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

app.post('/api/create-transaction', async (req, res) => {
  // Sama seperti kode di atas, tapi dengan syntax Express
  try {
    // ... sama seperti handler di atas
  } catch (error) {
    // ... sama seperti error handling di atas
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
*/
