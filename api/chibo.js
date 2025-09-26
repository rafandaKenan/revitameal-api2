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
    return [];
  }
  try {
    const menuCollection = await db.collection('revitameal_menu_templates').get();
    if (menuCollection.empty) {
      return [];
    }
    const menuData = menuCollection.docs.map(doc => {
      const data = doc.data();
      return {
        nama: data.name || "Tidak diketahui",
        deskripsi: data.description || "",
        kalori: data.calories || 0,
        harga: data.basePrice || 0,
        tipe: data.type || "lainnya"
      };
    });
    return menuData;
  } catch (error) {
    console.error("Error fetching menu from Firestore:", error);
    return [];
  }
}

// Fungsi untuk format menu data menjadi string yang readable
function formatMenuForAI(menuData) {
  if (!menuData.length) {
    return "Saat ini tidak ada data menu yang tersedia di database.";
  }
  
  let formatted = "DAFTAR MENU REVITAMEAL:\n\n";
  
  // Group by type
  const grouped = menuData.reduce((acc, item) => {
    if (!acc[item.tipe]) acc[item.tipe] = [];
    acc[item.tipe].push(item);
    return acc;
  }, {});
  
  Object.keys(grouped).forEach(type => {
    formatted += `${type.toUpperCase()}:\n`;
    grouped[type].forEach(item => {
      formatted += `• ${item.nama}\n`;
      formatted += `  Kalori: ${item.kalori} kcal\n`;
      formatted += `  Harga: Rp ${item.harga.toLocaleString('id-ID')}\n`;
      if (item.deskripsi) {
        formatted += `  Deskripsi: ${item.deskripsi}\n`;
      }
      formatted += `\n`;
    });
    formatted += `\n`;
  });
  
  return formatted;
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
    return res.status(503).json({ 
      error: "Service Unavailable", 
      message: `Koneksi Firebase gagal: ${firebaseAdminError}` 
    });
  }
  
  if (geminiError) {
    return res.status(503).json({ 
      error: "Service Unavailable", 
      message: `Konfigurasi AI gagal: ${geminiError}` 
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Valid message is required" });
    }

    // Ambil data menu dari database
    console.log("Fetching menu data...");
    const menuData = await getMenuContext();
    const formattedMenu = formatMenuForAI(menuData);

    // Coba beberapa model name yang mungkin tersedia
    const modelVariants = [
      "gemini-1.5-flash-latest",
      "gemini-1.5-flash",
      "gemini-1.5-pro-latest", 
      "gemini-1.5-pro",
      "gemini-pro"
    ];

    let model = null;
    let modelUsed = null;

    // Coba setiap variant model sampai ada yang berhasil
    for (const modelName of modelVariants) {
      try {
        console.log(`Trying model: ${modelName}`);
        model = genAI.getGenerativeModel({ 
          model: modelName,
          systemInstruction: `Anda adalah Chibo, asisten nutrisi dari Revitameal yang ramah dan membantu.

ATURAN PENTING:
1. Jawab pertanyaan tentang menu berdasarkan data yang diberikan
2. Gunakan bahasa Indonesia yang ramah dan sopan
3. Jika pertanyaan di luar topik menu/nutrisi, tolak dengan sopan
4. Jangan memberikan nasihat medis - berikan disclaimer jika perlu
5. Fokus pada informasi menu: nama, kalori, harga, tipe`
        });
        modelUsed = modelName;
        break;
      } catch (error) {
        console.log(`Model ${modelName} failed:`, error.message);
        continue;
      }
    }

    if (!model) {
      throw new Error("Tidak ada model Gemini yang tersedia");
    }

    console.log(`Using model: ${modelUsed}`);

    // Buat prompt lengkap dengan konteks menu
    const fullPrompt = `${formattedMenu}

PERTANYAAN PENGGUNA: ${message}

Jawab berdasarkan menu di atas dengan bahasa Indonesia yang ramah.`;

    // Generate response
    const result = await model.generateContent(fullPrompt);
    const responseText = result.response.text();

    console.log("Response generated successfully");

    res.status(200).json({ 
      response: responseText,
      model: modelUsed 
    });

  } catch (error) {
    console.error("Error in handler:", error);
    
    // Log detail error untuk debugging
    if (error.status) {
      console.error("API Error Status:", error.status);
      console.error("API Error Message:", error.message);
    }
    
    // Berikan response yang informatif
    let errorMessage = "Maaf, terjadi kesalahan di server Chibo.";
    
    if (error.message.includes("not found") || error.status === 404) {
      errorMessage = "Model AI tidak tersedia saat ini. Tim teknis sedang memperbaiki.";
    } else if (error.message.includes("quota") || error.message.includes("limit")) {
      errorMessage = "Server sedang sibuk. Silakan coba lagi dalam beberapa saat.";
    } else if (error.message.includes("API key")) {
      errorMessage = "Konfigurasi server bermasalah. Hubungi administrator.";
    }
    
    res.status(500).json({
      error: "Internal Server Error",
      message: errorMessage,
      detailError: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
