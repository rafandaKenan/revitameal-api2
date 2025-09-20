// api/env.js
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const envCheck = {
    MIDTRANS_SERVER_KEY: !!process.env.MIDTRANS_SERVER_KEY,
    MIDTRANS_CLIENT_KEY: !!process.env.MIDTRANS_CLIENT_KEY,
    MIDTRANS_IS_PRODUCTION: process.env.MIDTRANS_IS_PRODUCTION,
    NODE_ENV: process.env.NODE_ENV
  };

  console.log('Environment variables check:', envCheck);

  return res.status(200).json({
    success: true,
    environment: envCheck
  });
};
