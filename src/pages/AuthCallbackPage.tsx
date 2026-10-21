import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { apiService, signupResendCooldownSeconds } from '../services/apiService.js';

export function confirmationError(search: string, hash: string) {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const errorCode = query.get('error_code') ?? fragment.get('error_code');
  const error = query.get('error_description') ?? query.get('error')
    ?? fragment.get('error_description') ?? fragment.get('error');

  if (
    errorCode === 'flow_state_not_found'
    || errorCode === 'code_verifier_not_found'
    || /code[_ ]verifier|flow[_ ]state|pkce/i.test(error ?? '')
  ) {
    return 'Verifikasi lama gagal karena PKCE verifier tidak tersedia. Ini dapat terjadi jika tautan dibuka di browser/perangkat lain atau pemindai email membuka tautan lebih dulu. Coba login terlebih dahulu; jika akun belum aktif, minta email konfirmasi baru dan gunakan tautan terbarunya.';
  }
  if (errorCode === 'otp_expired' || /expired|invalid|already used/i.test(error ?? '')) {
    return 'Tautan verifikasi tidak valid, sudah digunakan, atau kedaluwarsa. Minta email konfirmasi baru.';
  }
  if (error) return 'Verifikasi email belum berhasil. Periksa email atau minta tautan konfirmasi baru.';
  if (query.has('code')) {
    return 'Kode verifikasi lama tidak dapat diselesaikan. Ini dapat terjadi jika tautan dibuka di browser/perangkat lain atau pemindai email membuka tautan lebih dulu. Coba login terlebih dahulu; jika akun belum aktif, minta email konfirmasi baru.';
  }
  return 'Sesi verifikasi tidak ditemukan. Buka tautan dari email atau minta email konfirmasi baru.';
}

export const AuthCallbackPage: React.FC = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(() => signupResendCooldownSeconds());

  useEffect(() => {
    const updateCooldown = () => setResendCooldown(signupResendCooldownSeconds());
    updateCooldown();
    const timer = window.setInterval(updateCooldown, 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (loading) {
    return <main className="grid min-h-screen place-items-center text-sm text-slate-500">Memverifikasi email...</main>;
  }
  if (user) return <Navigate to="/dashboard" replace />;

  const handleResend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (resendCooldown > 0) return;
    setError('');
    setMessage('');
    setPending(true);
    try {
      const result = await apiService.resendSignupConfirmation(email.trim().toLowerCase());
      setMessage(result.message);
      setResendCooldown(signupResendCooldownSeconds());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Email konfirmasi belum dapat dikirim. Coba lagi nanti.');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900">Verifikasi email</h1>
        <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
          {confirmationError(location.search, location.hash)}
        </p>
        {error && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>}
        {message && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">{message}</p>}
        <form onSubmit={(event) => void handleResend(event)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="confirmation-email" className="mb-1.5 block text-sm font-medium text-slate-700">Email akun</label>
            <input id="confirmation-email" type="email" autoComplete="email" required maxLength={254} value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
          </div>
          <button type="submit" disabled={pending || resendCooldown > 0} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {pending ? 'Mengirim...' : resendCooldown > 0 ? `Kirim ulang dalam ${resendCooldown} detik` : 'Kirim ulang email konfirmasi'}
          </button>
        </form>
        <Link to="/login" className="mt-5 block text-center text-sm font-semibold text-blue-700 hover:text-blue-800">Kembali ke login</Link>
      </section>
    </main>
  );
};
