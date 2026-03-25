# LexiSpeak

Versi website dari project LexiSpeak, dibangun dengan Next.js App Router dan siap deploy ke Vercel.

## Fitur Starter

- Mode soal:
  - Generate by AI (OpenAI/Groq via environment variable)
  - Generate lokal by domain (tanpa topik utama)
  - Enter by topic
- Session flow:
  - Generate 10 pertanyaan
  - Rekam suara langsung dari browser
  - Transcribe audio ke teks via endpoint server
  - Jawab satu per satu
  - Hitung skor akhir dan mapping CEFR
- Progress per user:
  - Simpan hasil sesi ke Supabase
  - Simpan transcript per pertanyaan (Q/A)
  - Tampilkan riwayat Band score terbaru
  - Tampilkan trend band mingguan
- API serverless:
  - `POST /api/questions`
  - `POST /api/transcribe`
  - `POST /api/evaluate`
  - `GET /api/history?userId=...`
  - `POST /api/history`

## Konfigurasi Environment

1. Copy file env contoh:

  `Copy-Item .env.example .env.local`

2. Isi value sesuai provider yang dipakai.

Minimal untuk OpenAI:
- `AI_PROVIDER=openai`
- `OPENAI_API_KEY=...`

Minimal untuk Groq:
- `AI_PROVIDER=groq`
- `GROQ_API_KEY=...`

Untuk simpan riwayat progress:
- `SUPABASE_URL=...`
- `SUPABASE_SERVICE_ROLE_KEY=...`

Di Vercel, isi semua variabel tadi di Project Settings > Environment Variables.

## Setup Supabase

1. Buka SQL Editor di Supabase.
2. Jalankan isi file [supabase/schema.sql](supabase/schema.sql).
3. Pastikan tabel `speaking_sessions` berhasil dibuat.
4. Kalau tabel sudah lama, jalankan ulang file yang sama untuk menambah kolom `qa_transcripts`.

## Run Lokal

1. Masuk folder project:

	`cd ielts-web`

2. Jalankan development server:

	`npm run dev`

3. Buka browser:

	`http://localhost:3000`

## Build Check

Untuk memastikan siap deploy:

`npm run build`

## Deploy ke Vercel

1. Login Vercel CLI:

	`npx vercel login`

2. Deploy project:

	`npx vercel`

3. Untuk production deploy:

	`npx vercel --prod`

## Deploy Aman (Direkomendasikan)

- Jangan simpan API key di code, commit, atau client-side code.
- Simpan semua secret hanya di Vercel Environment Variables.
- Aktifkan 2FA di akun Vercel, GitHub, dan Supabase.
- Rotasi API key secara berkala.
- Gunakan domain production sendiri dan pakai HTTPS (default di Vercel).
- Monitor log request 429/403 untuk deteksi abuse.

### Environment Variables yang wajib untuk AI

Tanpa env AI, fitur generate AI/transcribe tidak akan berjalan.

- `AI_PROVIDER` = `openai` atau `groq`
- Jika OpenAI:
  - `OPENAI_API_KEY`
  - `OPENAI_BASE_URL` (opsional, default sudah ada)
  - `OPENAI_CHAT_MODEL` (opsional)
  - `OPENAI_TRANSCRIBE_MODEL` (opsional)
- Jika Groq:
  - `GROQ_API_KEY`
  - `GROQ_BASE_URL` (opsional, default sudah ada)
  - `GROQ_CHAT_MODEL` (opsional)
  - `GROQ_TRANSCRIBE_MODEL` (opsional)

Untuk history/progress storage:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Upgrade Berikutnya (Direkomendasikan)

- Tambah autentikasi Supabase Auth (login user real, bukan userId manual).
- Simpan transcript per pertanyaan (bukan hanya hasil akhir session).
- Tambah analitik progress mingguan dengan chart (misalnya average band trend).
