// Menggunakan 'require' agar konsisten dengan API lain yang berfungsi
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require('firebase-admin');

// --- Inisialisasi Firebase Admin ---
let db;
let firebaseAdminError = null;

try {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON environment variable tidak diatur.");
  }

  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, 'base64').toString('utf-8')
  );

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  db = admin.firestore();
} catch (error) {
  firebaseAdminError = error.message;
  console.error('Firebase Admin Initialization Error:', firebaseAdminError);
}

// --- Inisialisasi Google Gemini AI ---
let genAI;
let geminiError = null;

if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
} else {
  geminiError = "GEMINI_API_KEY environment variable tidak diatur.";
  console.error(geminiError);
}

// Fungsi untuk mengambil data menu dari Firestore
async function getMenuContext() {
  if (!db) {
    return "Koneksi ke database menu gagal.";
  }
  try {
    const menuCollection = await db.collection('revitameal_menu_templates').get();
    if (menuCollection.empty) {
      return "Saat ini tidak ada data menu yang tersedia.";
    }
    const menuData = menuCollection.docs.map(doc => {
      const data = doc.data();
      return {
        nama: data.name,
        deskripsi: data.description,
        kalori: data.calories,
        harga: data.basePrice,
        tipe: data.type
      };
    });
    return `Berikut adalah data menu yang tersedia di Revitameal: ${JSON.stringify(menuData)}`;
  } catch (error) {
    console.error("Error fetching menu from Firestore:", error);
    return "Terjadi kesalahan saat mencoba mengambil data menu dari database.";
  }
}

// --- Handler utama ---
module.exports = async (req, res) => {
  const allowedOrigin = process.env.FRONTEND_URL || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (firebaseAdminError) {
    return res.status(503).json({ error: "Service Unavailable", message: `Koneksi Firebase gagal: ${firebaseAdminError}` });
  }
  if (geminiError) {
    return res.status(503).json({ error: "Service Unavailable", message: `Konfigurasi AI gagal: ${geminiError}` });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const menuContext = await getMenuContext();

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const systemInstructionString = `
Anda adalah Chibo, asisten nutrisi dari Revitameal.
Anda ramah dan siap membantu.

KONTEKS DARI DATABASE:
${menuContext}

Aturan:
1. Jawab semua pertanyaan tentang menu berdasarkan KONTEKS DARI DATABASE.
2. Jika pertanyaan di luar topik kesehatan atau menu, tolak dengan sopan.
3. Jangan pernah memberikan nasihat medis. Berikan disclaimer jika perlu.
4. Gunakan bahasa Indonesia.
`;

    // 🔥 Perbaikan: gunakan role + parts (sesuai format Content)
    const chat = model.startChat({
      history: [],
      generationConfig: { maxOutputTokens: 1000 },
      systemInstruction: {
      role: "system",
      parts: [{ text: systemInstructionString }]
  }

    });

    const result = await chat.sendMessage(message);
    const responseText = result.response.text();

    res.status(200).json({ response: responseText });

  } catch (error) {
    console.error("Error in handler:", error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Maaf, terjadi kesalahan di server Chibo.",
      detailError: error.message
    });
  }
};
