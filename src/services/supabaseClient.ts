import { createClient } from '@supabase/supabase-js';

const viteEnv = import.meta.env ?? {};
const runtimeEnv = typeof process === 'undefined' ? {} : process.env;
const supabaseUrl = (viteEnv.VITE_SUPABASE_URL ?? runtimeEnv.VITE_SUPABASE_URL)?.trim();
const supabaseKey = (
  viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY
  || viteEnv.VITE_SUPABASE_ANON_KEY
  || runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY
  || runtimeEnv.VITE_SUPABASE_ANON_KEY
)?.trim();

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Isi VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY di file environment.');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

export function supabaseErrorMessage(error: { message?: string; code?: string; status?: number } | null | undefined) {
  if (!error) return 'Permintaan belum dapat diproses.';
  const message = error.message ?? '';
  if (error.code === 'same_password' || /same password|different from.*old password/i.test(message)) {
    return 'Password baru harus berbeda dari password lama.';
  }
  if (error.code === 'weak_password' || /password.*(weak|at least|characters|contain)/i.test(message)) {
    return 'Password baru terlalu lemah. Gunakan password yang lebih kuat dan ikuti persyaratan yang ditampilkan.';
  }
  if (
    error.code === 'session_not_found'
    || error.code === 'flow_state_not_found'
    || error.code === 'code_verifier_not_found'
  ) {
    return 'Sesi pemulihan tidak ditemukan atau sudah berakhir. Minta tautan pemulihan baru.';
  }
  if (error.code === 'invalid_credentials') return 'Email atau password salah.';
  if (error.code === 'email_not_confirmed') return 'Email belum dikonfirmasi. Periksa inbox Anda.';
  if (error.code === '23505') return 'Data tersebut sudah terdaftar.';
  if (error.code === 'user_already_exists') return 'Email sudah terdaftar. Silakan login atau gunakan fitur lupa password.';
  if (error.code === 'email_address_invalid') return 'Alamat email tidak valid. Periksa kembali penulisannya.';
  if (error.code === 'signup_disabled') return 'Pendaftaran akun sedang dinonaktifkan. Hubungi pengelola aplikasi.';
  if (error.code === 'over_email_send_rate_limit' || error.status === 429) return 'Terlalu banyak permintaan email. Tunggu beberapa menit sebelum mencoba lagi.';
  if (error.code === 'email_provider_disabled') return 'Pengiriman email belum aktif pada layanan autentikasi. Pengelola perlu mengaktifkan SMTP/email.';
  if (error.code === 'otp_expired' || /expired|invalid|already used/i.test(message)) {
    return 'Tautan tidak valid, sudah digunakan, atau kedaluwarsa. Minta tautan pemulihan baru.';
  }
  if (/failed to fetch|network|fetch error/i.test(message)) return 'Tidak dapat terhubung ke layanan. Periksa koneksi internet lalu coba lagi.';
  return message || 'Permintaan belum dapat diproses.';
}
