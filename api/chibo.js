import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from 'firebase-admin';

// --- Inisialisasi Firebase Admin yang Lebih Aman ---
let db;
let firebaseAdminError = null;

try {
  // 1. Memeriksa apakah environment variable ada SEBELUM digunakan
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY environment variable tidak diatur.");
  }
  
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8')
  );

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  db = admin.firestore();
} catch (error) {
  // 2. Menyimpan pesan error jika inisialisasi gagal
  firebaseAdminError = error.message;
  console.error('Firebase Admin Initialization Error:', firebaseAdminError);
}
// ----------------------------------------------------------------

// --- Inisialisasi Google Gemini AI yang Lebih Aman ---
let genAI;
let geminiError = null;

// 3. Memeriksa kunci API Gemini
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
} else {
  geminiError = "GEMINI_API_KEY environment variable tidak diatur.";
  console.error(geminiError);
}
// ----------------------------------------------------

// Fungsi untuk mengambil data menu dari Firestore
async function getMenuContext() {
  // Pastikan 'db' sudah terinisialisasi
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
    
    return `Berikut adalah data menu yang tersedia di Revitameal dalam format JSON: ${JSON.stringify(menuData)}`;
  } catch (error) {
    console.error("Error fetching menu from Firestore:", error);
    return "Terjadi kesalahan saat mencoba mengambil data menu dari database.";
  }
}

// Fungsi handler utama yang akan dijalankan oleh Vercel
export default async function handler(req, res) {
  const allowedOrigin = process.env.FRONTEND_URL || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // 4. Memberikan respons error yang jelas jika service gagal di-load
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

    const systemInstruction = `
      Anda adalah Chibo, seorang asisten nutrisi dan kesehatan virtual dari Revitameal.
      Anda ramah, berpengetahuan, dan siap membantu.
      
      KONTEKS PENTING DARI DATABASE:
      ${menuContext}

      Aturan Anda:
      1.  Gunakan bahasa Indonesia yang sopan dan mudah dimengerti.
      2.  JAWAB SEMUA PERTANYAAN TENTANG MENU BERDASARKAN KONTEKS DARI DATABASE DI ATAS. Jika pengguna bertanya menu apa yang tersedia, atau detail tentang menu tertentu (seperti harga atau kalori), gunakan informasi tersebut.
      3.  Jika pertanyaan di luar topik kesehatan atau menu Revitameal, tolak dengan sopan. Contoh: "Maaf, fokus saya adalah membantu Anda seputar nutrisi dan menu dari Revitameal."
      4.  JANGAN PERNAH memberikan nasihat medis. Selalu berikan disclaimer: "Informasi ini tidak menggantikan nasihat medis profesional. Silakan berkonsultasi dengan dokter Anda." jika pertanyaan menyangkut kondisi medis.
      5.  Jaga agar jawaban tetap singkat dan padat.
    `;
    
    const chat = model.startChat({
      history: [],
      generationConfig: { maxOutputTokens: 1000 },
      systemInstruction,
    });

    const result = await chat.sendMessage(message);
    const responseText = result.response.text();
    
    res.status(200).json({ response: responseText });

  } catch (error) {
    console.error("Error in handler:", error);
    res.status(500).json({ error: "Maaf, terjadi kesalahan di server Chibo." });
  }
}

