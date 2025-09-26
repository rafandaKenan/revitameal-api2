// ... import lainnya
import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Sparkles, MessageCircle } from "lucide-react";

// GANTI BARIS INI:
// const CHIBO_API_URL = "https://revitameal-chibo-api.vercel.app/api/chibo";

// MENJADI SEPERTI INI:
const CHIBO_API_URL = import.meta.env.VITE_CHIBO_API_URL;

function ChiboAssistant() {
// ... sisa kode tidak perlu diubah ...
```

**Langkah 4: Atur Environment Variable di Vercel (Frontend)**

Terakhir, Anda juga harus mendaftarkan variabel ini di pengaturan Vercel untuk proyek **frontend** Anda.
1.  Buka proyek *frontend* di Vercel.
2.  Masuk ke **Settings > Environment Variables**.
3.  Buat variabel baru:
    * **Name**: `VITE_CHIBO_API_URL`
    * **Value**: `https://<URL_API_VERCEL_ANDA>/api/chibo` (URL yang sama seperti di file `.env`)
4.  Klik **Save**.

### 2. Konfigurasi di Repositori Backend (API)

Kode `api/chibo.js` Anda sebenarnya **sudah hampir siap** untuk menerima permintaan dari domain yang berbeda. Bagian ini yang membuatnya bekerja:

```javascript
// Mengatur header untuk CORS
res.setHeader('Access-Control-Allow-Origin', '*');
