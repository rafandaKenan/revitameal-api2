import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from 'firebase-admin';

// --- Inisialisasi Firebase Admin ---
try {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8')
  );

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
} catch (error) {
  console.error('Firebase Admin Initialization Error:', error.message);
}

const db = admin.firestore();

// Inisialisasi Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Fungsi untuk mengambil data menu dari Firestore
async function getMenuContext() {
  try {
    const menuCollection = await db.collection('revitameal_menu_templates').get();
    if (menuCollection.empty) {
      return "Saat ini tidak ada data menu yang tersedia.";
    }
    
    const menuData = menuCollection.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        nama: data.name,
        deskripsi: data.description,
        kalori: data.calories,
        harga: data.basePrice,
        tipe: data.type,
        komponen: data.components || {},
        gambar: data.image_url || null
      };
    });
    
    return `Data menu Revitameal lengkap (${menuData.length} menu tersedia):\n${JSON.stringify(menuData, null, 2)}`;
  } catch (error) {
    console.error("Error fetching menu:", error);
    return "Terjadi kesalahan saat mengambil data menu dari database.";
  }
}

// Fungsi untuk mengambil data ingredients
async function getIngredientsContext() {
  try {
    const ingredientsCollection = await db.collection('revitameal_ingredients').get();
    if (ingredientsCollection.empty) {
      return "Tidak ada data bahan makanan yang tersedia.";
    }
    
    const ingredientsData = ingredientsCollection.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        nama: data.name,
        deskripsi: data.description,
        kalori: data.calories || 0,
        protein: data.protein || 0,
        kategori: data.category || 'tidak dikategorikan'
      };
    });
    
    return `Data bahan makanan lengkap (${ingredientsData.length} bahan):\n${JSON.stringify(ingredientsData, null, 2)}`;
  } catch (error) {
    console.error("Error fetching ingredients:", error);
    return "Terjadi kesalahan saat mengambil data bahan makanan.";
  }
}

// Fungsi untuk analisis query dan menentukan konteks yang dibutuhkan
function analyzeQuery(message) {
  const lowercaseMessage = message.toLowerCase();
  
  // Deteksi jenis pertanyaan
  const patterns = {
    menuQuery: /(?:menu|makanan|makan|tersedia|ada apa|pilihan)/i,
    priceQuery: /(?:harga|berapa|biaya|mahal|murah|budget)/i,
    ingredientQuery: /(?:bahan|ingredient|komposisi|terbuat|kandungan)/i,
    nutritionQuery: /(?:kalori|nutrisi|gizi|sehat|protein|vitamin|serat)/i,
    recommendationQuery: /(?:rekomen|saran|pilih|bagus|terbaik|cocok)/i,
    orderQuery: /(?:pesan|order|beli|checkout|cara pesan)/i,
    healthQuery: /(?:diet|turun berat|naik berat|olahraga|stamina|kesehatan)/i,
    generalNutrition: /(?:sarapan|makan siang|makan malam|camilan|snack)/i
  };
  
  const detectedPatterns = [];
  for (const [key, pattern] of Object.entries(patterns)) {
    if (pattern.test(lowercaseMessage)) {
      detectedPatterns.push(key);
    }
  }
  
  return {
    patterns: detectedPatterns,
    needsMenuData: detectedPatterns.some(p => 
      ['menuQuery', 'priceQuery', 'recommendationQuery', 'orderQuery'].includes(p)
    ),
    needsIngredientsData: detectedPatterns.some(p => 
      ['ingredientQuery', 'nutritionQuery', 'recommendationQuery'].includes(p)
    ),
    isGeneralNutrition: detectedPatterns.includes('generalNutrition') || 
                       detectedPatterns.includes('healthQuery'),
    originalMessage: message
  };
}

// Fungsi untuk mendapatkan waktu salam yang tepat
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 11) return "Selamat pagi";
  if (hour < 15) return "Selamat siang";
  if (hour < 18) return "Selamat sore";
  return "Selamat malam";
}

// Fungsi handler utama
export default async function handler(req, res) {
  // CORS Headers
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173', 
    'https://revitameal.vercel.app',
    'https://revitameal-frontend.vercel.app',
    process.env.FRONTEND_URL
  ].filter(Boolean);

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== "POST") {
    return res.status(405).json({ 
      error: "Method Not Allowed",
      message: "Hanya metode POST yang diizinkan untuk endpoint ini."
    });
  }

  try {
    const { message } = req.body;
    
    // Validasi input
    if (!message) {
      return res.status(400).json({ 
        error: "Message is required",
        response: "Maaf, pesan tidak boleh kosong. Silakan tulis pertanyaan Anda tentang nutrisi atau menu Revitameal."
      });
    }

    if (typeof message !== 'string') {
      return res.status(400).json({
        error: "Invalid message format",
        response: "Format pesan tidak valid. Harap kirim pesan dalam bentuk teks."
      });
    }

    if (message.trim().length > 1000) {
      return res.status(400).json({
        error: "Message too long",
        response: "Pesan terlalu panjang. Silakan persingkat pertanyaan Anda (maksimal 1000 karakter)."
      });
    }

    // Analisis query untuk menentukan data apa yang dibutuhkan
    const queryAnalysis = analyzeQuery(message);
    
    // Bangun konteks berdasarkan analisis
    let contextData = [];
    
    // Selalu sertakan informasi dasar tentang Revitameal
    contextData.push("INFORMASI REVITAMEAL: Revitameal adalah layanan katering sehat yang menyediakan menu bergizi seimbang dengan fokus pada nutrisi optimal untuk gaya hidup aktif.");
    
    // Tambahkan data menu jika diperlukan
    if (queryAnalysis.needsMenuData) {
      try {
        const menuContext = await getMenuContext();
        contextData.push(`MENU TERSEDIA:\n${menuContext}`);
      } catch (error) {
        console.error("Error loading menu context:", error);
      }
    }
    
    // Tambahkan data ingredients jika diperlukan
    if (queryAnalysis.needsIngredientsData) {
      try {
        const ingredientsContext = await getIngredientsContext();
        contextData.push(`BAHAN MAKANAN:\n${ingredientsContext}`);
      } catch (error) {
        console.error("Error loading ingredients context:", error);
      }
    }

    // Inisialisasi model AI
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // System instruction yang komprehensif
    const systemInstruction = `
      Anda adalah Chibo, asisten nutrisi virtual yang ramah dan berpengetahuan dari Revitameal. ${getGreeting()}!

      KEPRIBADIAN ANDA:
      - Ramah, supportif, dan mudah didekati
      - Berpengetahuan luas tentang nutrisi dan kesehatan
      - Selalu memberikan saran praktis dan dapat diterapkan
      - Menggunakan bahasa Indonesia yang santai namun informatif
      - Antusias membantu pengguna mencapai tujuan kesehatan mereka

      KONTEKS DATABASE DAN INFORMASI:
      ${contextData.join('\n\n')}

      KEMAMPUAN DAN FOKUS ANDA:
      1. **Menu Revitameal**: Jelaskan detail menu, harga, kalori, dan komposisi berdasarkan database
      2. **Rekomendasi Personal**: Berikan saran menu berdasarkan kebutuhan spesifik pengguna
      3. **Edukasi Nutrisi**: Jelaskan konsep nutrisi, kalori, makronutrient, dan mikronutrient
      4. **Tips Gaya Hidup Sehat**: Berikan saran diet, olahraga, dan pola hidup sehat
      5. **Panduan Praktis**: Cara pemesanan, porsi ideal, timing makan, dll

      ATURAN RESPONS:
      1. **Gunakan data database** saat menjawab pertanyaan tentang menu Revitameal
      2. **Berikan penjelasan detail** untuk pertanyaan nutrisi, termasuk contoh konkret
      3. **Sertakan disclaimer medis** untuk masalah kesehatan: "Informasi ini tidak menggantikan nasihat medis profesional"
      4. **Fokus pada topik nutrisi dan kesehatan** - arahkan kembali jika pertanyaan di luar topik
      5. **Berikan jawaban praktis** yang bisa langsung diterapkan pengguna
      6. **Gunakan emoji secukupnya** untuk membuat percakapan lebih hidup
      7. **Jawab dalam bahasa Indonesia** yang natural dan mudah dipahami

      CONTOH RESPONS YANG BAIK:
      - Untuk menu: "Menu Paket Campuran Lengkap kami seharga Rp 45.000 mengandung sekitar 450 kalori dengan komposisi..."
      - Untuk nutrisi: "Kebutuhan kalori harian Anda tergantung pada usia, jenis kelamin, dan aktivitas. Umumnya..."
      - Untuk rekomendasi: "Berdasarkan tujuan Anda untuk menurunkan berat badan, saya rekomendasikan..."

      Jawab dengan hangat, informatif, dan selalu siap membantu! 🌟
    `;
    
    // Generate response
    const chat = model.startChat({
      history: [],
      generationConfig: { 
        maxOutputTokens: 1000,
        temperature: 0.7,
        topP: 0.8,
        topK: 40
      },
      systemInstruction,
    });

    const result = await chat.sendMessage(message.trim());
    const responseText = result.response.text();

    // Log untuk monitoring (optional)
    console.log(`[${new Date().toISOString()}] Query type: ${queryAnalysis.patterns.join(', ')} | Length: ${message.length}`);
    
    // Response sukses
    res.status(200).json({ 
      response: responseText,
      timestamp: new Date().toISOString(),
      // Data tambahan untuk debugging (bisa dihapus di production)
      debug: process.env.NODE_ENV === 'development' ? {
        queryType: queryAnalysis.patterns,
        contextLoaded: contextData.length
      } : undefined
    });

  } catch (error) {
    console.error("Error in Chibo handler:", error);
    
    // Tentukan jenis error dan response yang tepat
    let errorResponse = "Maaf, terjadi kesalahan teknis. Silakan coba lagi dalam beberapa saat.";
    let statusCode = 500;
    
    if (error.message?.includes('API_KEY')) {
      errorResponse = "Layanan sedang dalam pemeliharaan. Tim kami sedang memperbaikinya.";
      statusCode = 503;
    } else if (error.message?.includes('QUOTA_EXCEEDED')) {
      errorResponse = "Maaf, kapasitas server sedang penuh. Silakan coba lagi dalam beberapa menit.";
      statusCode = 429;
    } else if (error.message?.includes('Firebase')) {
      errorResponse = "Sedang mengalami gangguan koneksi database. Data menu mungkin tidak lengkap saat ini.";
    }
    
    res.status(statusCode).json({ 
      error: error.message || "Internal Server Error",
      response: errorResponse,
      timestamp: new Date().toISOString()
    });
  }
}
