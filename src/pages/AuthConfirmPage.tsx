import { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { apiService, signupResendCooldownSeconds } from '../services/apiService.js';
import { supabase } from '../services/supabaseClient.js';

type VerifyOtp = typeof supabase.auth.verifyOtp;
type AttemptGuard = { current: boolean };
type ConfirmationError = { code?: string; message?: string };
type ConfirmationType = 'signup' | 'recovery';

function confirmationErrorDetails(value: unknown): ConfirmationError {
  if (!value || typeof value !== 'object') return { message: String(value) };
  const code = 'code' in value && typeof value.code === 'string' ? value.code : undefined;
  const message = 'message' in value && typeof value.message === 'string' ? value.message : undefined;
  return { code, message };
}

export function confirmationOtpError(type: ConfirmationType, error: ConfirmationError | null) {
  if (!error) return '';
  const details = `${error.code ?? ''} ${error.message ?? ''}`;
  const target = type === 'signup' ? 'email konfirmasi' : 'tautan pemulihan';
  if (error.code === 'otp_expired' || /expired/i.test(details)) {
    return `Token ${target} sudah kedaluwarsa. Minta ${type === 'signup' ? 'email konfirmasi' : 'tautan pemulihan'} baru.`;
  }
  if (/already[ _-]?used|token_already_used|otp_already_used|already[ _-]?verified|already been verified/i.test(details)) {
    return type === 'signup'
      ? 'Token konfirmasi ini sudah dipakai. Akun mungkin sudah terverifikasi; coba login terlebih dahulu. Jika belum bisa, minta email konfirmasi baru.'
      : 'Tautan pemulihan ini sudah digunakan. Minta tautan pemulihan baru.';
  }
  if (/invalid|not found|malformed/i.test(details)) {
    return `Token ${target} tidak valid. Periksa tautannya atau minta yang baru.`;
  }
  return `Verifikasi ${type === 'signup' ? 'akun' : 'tautan pemulihan'} gagal. Periksa tautan atau minta yang baru.`;
}

export async function confirmOtpOnce(
  tokenHash: string,
  type: ConfirmationType,
  attempted: AttemptGuard,
  verifyOtp: VerifyOtp,
) {
  if (!tokenHash || attempted.current) return null;
  attempted.current = true;
  const { data, error } = await verifyOtp({ token_hash: tokenHash, type });
  if (error) return { error, hasSession: false };
  return { error: null, hasSession: Boolean(data.session) };
}

export async function confirmRecoveryOtp(
  tokenHash: string,
  attempted: AttemptGuard,
  verifyOtp: VerifyOtp,
  setRecoveryMode: (active: boolean) => void,
  navigate: (path: string, options: { replace: true }) => void,
) {
  if (!tokenHash || attempted.current) return { error: null };
  attempted.current = true;
  setRecoveryMode(true);
  const { data, error } = await verifyOtp({ token_hash: tokenHash, type: 'recovery' });
  if (error) {
    setRecoveryMode(false);
    return { error };
  }
  if (!data.session) {
    setRecoveryMode(false);
    return { error: { code: 'session_not_found', message: 'Verification returned no session.' } };
  }

  window.localStorage.setItem('catatuang.password-recovery-active', 'true');
  navigate('/reset-password', { replace: true });
  return { error: null };
}

export function AuthConfirmPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setRecoveryMode } = useAuth();
  const attempted = useRef(false);
  const [pending, setPending] = useState(false);
  const [signupVerifying, setSignupVerifying] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [signupHasSession, setSignupHasSession] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [resendPending, setResendPending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [resendError, setResendError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(() => signupResendCooldownSeconds());
  const query = new URLSearchParams(location.search);
  const tokenHash = query.get('token_hash') ?? '';
  const type = query.get('type');
  const isSignupLink = type === 'signup' && Boolean(tokenHash);
  const isRecoveryLink = type === 'recovery' && Boolean(tokenHash);
  const isSupportedLink = isSignupLink || isRecoveryLink;
  const showSignupResend = type === 'signup' && Boolean(error || !tokenHash);
  const showRecoveryResendLink = type === 'recovery' && Boolean(error || !tokenHash);

  useEffect(() => {
    const updateCooldown = () => setResendCooldown(signupResendCooldownSeconds());
    updateCooldown();
    const timer = window.setInterval(updateCooldown, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isSignupLink || attempted.current) return;
    setSignupVerifying(true);
    void confirmOtpOnce(
      tokenHash,
      'signup',
      attempted,
      supabase.auth.verifyOtp.bind(supabase.auth),
    ).then((result) => {
      window.history.replaceState(null, document.title, window.location.pathname);
      if (result?.error) {
        setError(confirmationOtpError('signup', confirmationErrorDetails(result.error)));
      } else if (result) {
        setSignupHasSession(result.hasSession);
        setSignupSuccess(true);
      }
    }).catch((requestError: unknown) => {
      window.history.replaceState(null, document.title, window.location.pathname);
      setError(confirmationOtpError('signup', confirmationErrorDetails(requestError)));
    }).finally(() => setSignupVerifying(false));
  }, [isSignupLink, tokenHash]);

  useEffect(() => {
    if (!signupSuccess) return;
    const timer = window.setTimeout(() => {
      navigate(signupHasSession ? '/dashboard' : '/login', { replace: true });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [navigate, signupHasSession, signupSuccess]);

  const handleRecoveryContinue = async () => {
    if (pending || attempted.current || !isRecoveryLink) return;
    setError('');
    setPending(true);
    try {
      const result = await confirmRecoveryOtp(
        tokenHash,
        attempted,
        supabase.auth.verifyOtp.bind(supabase.auth),
        setRecoveryMode,
        navigate,
      );
      window.history.replaceState(null, document.title, window.location.pathname);
      if (result.error) setError(confirmationOtpError('recovery', confirmationErrorDetails(result.error)));
    } catch (requestError) {
      window.history.replaceState(null, document.title, window.location.pathname);
      setRecoveryMode(false);
      setError(confirmationOtpError('recovery', confirmationErrorDetails(requestError)));
    } finally {
      setPending(false);
    }
  };

  const handleContinueAfterSignup = async () => {
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        navigate('/login', { replace: true });
        return;
      }
      navigate(data.session ? '/dashboard' : '/login', { replace: true });
    } catch {
      navigate('/login', { replace: true });
    }
  };

  const handleResend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (resendPending || resendCooldown > 0) return;
    setResendError('');
    setResendMessage('');
    setResendPending(true);
    try {
      const result = await apiService.resendSignupConfirmation(email.trim().toLowerCase());
      setResendMessage(result.message);
      setResendCooldown(signupResendCooldownSeconds());
    } catch (requestError) {
      setResendError(requestError instanceof Error ? requestError.message : 'Email konfirmasi belum dapat dikirim. Coba lagi nanti.');
    } finally {
      setResendPending(false);
    }
  };

  if (signupVerifying) {
    return <main className="grid min-h-screen place-items-center bg-slate-50 px-4 text-sm text-slate-600"><p role="status">Memverifikasi akun...</p></main>;
  }

  if (signupSuccess) {
    return <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <CheckCircle2 aria-hidden="true" className="mx-auto h-14 w-14 text-emerald-600" />
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Akun Anda berhasil dibuat</h1>
        <p role="status" className="mt-2 text-sm text-slate-600">Email berhasil diverifikasi. Anda akan diarahkan sebentar lagi.</p>
        <button type="button" onClick={() => void handleContinueAfterSignup()} className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
          Lanjutkan
        </button>
      </section>
    </main>;
  }

  return <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold text-slate-900">{isRecoveryLink ? 'Konfirmasi pemulihan password' : 'Konfirmasi email'}</h1>
      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>}
      {!isSupportedLink && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">Tautan tidak lengkap atau jenisnya tidak didukung.</p>}
      {isRecoveryLink && !error && <p className="mt-2 text-sm text-slate-600">Tekan Lanjutkan untuk memverifikasi tautan dan memilih password baru.</p>}
      {isRecoveryLink && <button type="button" onClick={() => void handleRecoveryContinue()} disabled={pending || attempted.current}
        className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
        {pending ? 'Memverifikasi...' : 'Lanjutkan'}
      </button>}
      {showRecoveryResendLink && <Link to="/login?forgot=1" className="mt-4 inline-flex text-sm font-semibold text-blue-700 hover:text-blue-800">Minta tautan pemulihan baru</Link>}
      {showSignupResend && <form onSubmit={(event) => void handleResend(event)} className="mt-6 space-y-4">
        {resendError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{resendError}</p>}
        {resendMessage && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">{resendMessage}</p>}
        <div>
          <label htmlFor="confirmation-email" className="mb-1.5 block text-sm font-medium text-slate-700">Email akun</label>
          <input id="confirmation-email" type="email" autoComplete="email" required maxLength={254} value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
        </div>
        <button type="submit" disabled={resendPending || resendCooldown > 0} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {resendPending ? 'Mengirim...' : resendCooldown > 0 ? `Kirim ulang dalam ${resendCooldown} detik` : 'Kirim ulang email konfirmasi'}
        </button>
      </form>}
      <Link to="/login" className="mt-5 block text-center text-sm font-semibold text-blue-700 hover:text-blue-800">Kembali ke login</Link>
    </section>
  </main>;
}
