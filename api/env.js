module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") return res.status(200).end();

  const envCheck = {
    DOKU_CLIENT_ID: !!process.env.DOKU_CLIENT_ID,
    DOKU_SECRET_KEY: !!process.env.DOKU_SECRET_KEY,
    DOKU_CALLBACK_URL: process.env.DOKU_CALLBACK_URL,
    DOKU_BASE_URL: process.env.DOKU_BASE_URL,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    NODE_ENV: process.env.NODE_ENV
  };

  console.log("Environment check:", envCheck);

  res.status(200).json({
    success: true,
    environment: envCheck
  });
};
