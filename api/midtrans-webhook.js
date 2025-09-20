// api/midtrans-webhook.js
const midtransClient = require('midtrans-client');

// Initialize Core API client for transaction verification
const coreApi = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// Firebase Admin SDK setup (you need to configure this)
// const admin = require('firebase-admin');
// if (!admin.apps.length) {
//   admin.initializeApp({
//     credential: admin.credential.cert({
//       projectId: process.env.FIREBASE_PROJECT_ID,
//       clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
//       privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
//     }),
//   });
// }
// const db = admin.firestore();

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
    console.log('Webhook: Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  console.log('=== MIDTRANS WEBHOOK RECEIVED ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  try {
    const notification = req.body;

    // Basic validation
    if (!notification || !notification.order_id || !notification.transaction_status) {
      console.error('Invalid webhook payload:', notification);
      return res.status(400).json({ error: 'Invalid notification payload' });
    }

    // Verify the notification with Midtrans
    console.log('Verifying transaction with Midtrans...');
    const statusResponse = await coreApi.transaction.notification(notification);
    
    console.log('Midtrans verification response:', statusResponse);

    // Extract important data
    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const transactionId = statusResponse.transaction_id;
    const paymentType = statusResponse.payment_type;
    const fraudStatus = statusResponse.fraud_status;
    const grossAmount = statusResponse.gross_amount;

    console.log('Processing transaction:', {
      orderId,
      transactionStatus,
      transactionId,
      paymentType,
      fraudStatus
    });

    // Determine order status based on transaction status
    let newOrderStatus;
    switch (transactionStatus) {
      case 'capture':
        // For credit card transactions
        if (fraudStatus === 'challenge') {
          newOrderStatus = 'pending'; // Challenge by fraud detection
        } else if (fraudStatus === 'accept') {
          newOrderStatus = 'paid';
        }
        break;
      
      case 'settlement':
        // Transaction is settled successfully
        newOrderStatus = 'paid';
        break;
      
      case 'pending':
        // Transaction is pending (e.g., bank transfer)
        newOrderStatus = 'pending';
        break;
      
      case 'deny':
        // Transaction is denied
        newOrderStatus = 'cancelled';
        break;
      
      case 'cancel':
      case 'expire':
        // Transaction is cancelled or expired
        newOrderStatus = 'cancelled';
        break;
      
      case 'refund':
      case 'partial_refund':
        // Transaction is refunded
        newOrderStatus = 'refunded';
        break;
      
      default:
        console.warn('Unknown transaction status:', transactionStatus);
        newOrderStatus = 'unknown';
    }

    console.log(`Updating order ${orderId} to status: ${newOrderStatus}`);

    // TODO: Update Firebase database
    // For now, we'll just log. You need to uncomment and configure Firebase Admin above
    
    /* UNCOMMENT THIS WHEN FIREBASE ADMIN IS CONFIGURED:
    
    try {
      // Find and update the order in Firebase
      const orderRef = db.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();
      
      if (!orderDoc.exists) {
        console.error('Order not found in database:', orderId);
        // Still return 200 to Midtrans to avoid retries
        return res.status(200).json({ 
          message: 'Order not found, but webhook processed',
          orderId,
          status: newOrderStatus
        });
      }

      // Update the order document
      await orderRef.update({
        status: newOrderStatus,
        transactionId: transactionId,
        paymentType: paymentType,
        transactionStatus: transactionStatus,
        fraudStatus: fraudStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        midtransResponse: statusResponse // Store full response for debugging
      });

      console.log('Order updated successfully in Firebase');
      
    } catch (dbError) {
      console.error('Database update error:', dbError);
      // Don't return error to Midtrans, or they'll keep retrying
      // Instead, log for manual investigation
    }
    
    */

    // Log successful processing
    console.log('Webhook processed successfully:', {
      orderId,
      newStatus: newOrderStatus,
      transactionId,
      paymentType
    });

    // IMPORTANT: Always return 200 OK to Midtrans
    // If you return error, Midtrans will retry the webhook multiple times
    return res.status(200).json({ 
      message: 'Webhook processed successfully',
      orderId: orderId,
      status: newOrderStatus,
      transactionId: transactionId
    });

  } catch (error) {
    console.error('Webhook processing error:', {
      message: error.message,
      stack: error.stack,
      requestBody: req.body
    });

    // Even on error, return 200 to prevent Midtrans retries
    // Log the error for manual investigation
    return res.status(200).json({
      message: 'Webhook received but processing failed',
      error: error.message,
      // Include timestamp for debugging
      timestamp: new Date().toISOString()
    });
  }
};
