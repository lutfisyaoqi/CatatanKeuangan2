import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.js';
import { apiService } from '../services/apiService.js';
import { supabase } from '../services/supabaseClient.js';
import type { Session } from '@supabase/supabase-js';
import { errorDiagnosticCode, logAuthDiagnostic, nextAuthDiagnosticMountCount } from '../services/authDiagnostics.js';

const recoverySessionWaitMs = 1800;
const recoverySessionKey = 'catatuang.password-recovery-active';
const recoveryRequestOriginKey = 'catatuang.password-recovery-request-origin';

export function recoveryLinkError(search: string, hash: string) {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const errorCode = query.get('error_code') ?? fragment.get('error_code');
  const error = query.get('error') ?? fragment.get('error');
  const description = query.get('error_description') ?? fragment.get('error_description') ?? '';
  const details = `${errorCode ?? ''} ${error ?? ''} ${description}`;

  if (/already[ _-]?used|code[ _-]?used|has been used/i.test(details)) {
    return `Kode pemulihan ini sudah digunakan. Minta tautan baru. (Kode error Supabase: ${errorCode ?? error ?? 'unknown'})`;
  }
  if (errorCode === 'otp_expired' || /expired/i.test(details)) {
    return `Tautan pemulihan kedaluwarsa atau kodenya ditolak. Minta tautan baru. (Kode error Supabase: ${errorCode ?? error ?? 'unknown'})`;
  }
  if (
    errorCode === 'flow_state_not_found'
    || errorCode === 'code_verifier_not_found'
    || /code[_ ]verifier|flow[_ ]state|pkce/i.test(details)
  ) {
    return `Tautan dibuka di browser atau perangkat berbeda, sehingga verifikasi tidak dapat diselesaikan. Buka tautan baru di browser yang sama dengan yang meminta pemulihan. (Kode error Supabase: ${errorCode ?? error ?? 'unknown'})`;
  }
  if (error || errorCode) {
    return `Tautan pemulihan tidak dapat diverifikasi. Minta tautan baru. (Kode error Supabase: ${errorCode ?? error ?? 'unknown'})`;
  }
  return null;
}

export function recoverySessionError(hasRecoveryCode: boolean) {
  return hasRecoveryCode
    ? 'SDK tidak mendapatkan sesi setelah memproses kode pemulihan. Kode mungkin kedaluwarsa atau sudah dipakai. Minta tautan baru.'
    : 'Sesi pemulihan tidak ditemukan. Buka tautan dari email di browser yang sama atau minta tautan baru.';
}

export async function completePasswordReset(
  password: string,
  confirmation: string,
  resetPassword: typeof apiService.resetPassword,
  setRecoveryMode: (active: boolean) => void,
  navigate: (path: string, options: { replace: true; state: { message: string } }) => void,
) {
  await resetPassword(password, confirmation);
  window.localStorage.removeItem('catatuang.password-recovery-requested-at');
  window.localStorage.removeItem(recoverySessionKey);
  setRecoveryMode(false);
  navigate('/login', {
    replace: true,
    state: { message: 'Password berhasil diubah, silakan login.' },
  });
}

export function PasswordResetPage() {
  const renderCount = useRef(0);
  renderCount.current++;
  const navigate = useNavigate();
  const { setRecoveryMode } = useAuth();
  const resolved = useRef(false);
  const submitting = useRef(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);
  const [linkError, setLinkError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  logAuthDiagnostic('PasswordResetPage', 'render', {
    render: renderCount.current,
    checkingLink,
    sessionReady,
    hasLinkError: Boolean(linkError),
  });

  useEffect(() => {
    setRecoveryMode(true);
    const query = new URLSearchParams(window.location.search);
    const recoveryCode = query.get('code');
    const errorMessage = recoveryLinkError(window.location.search, window.location.hash);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const requestedOrigin = window.localStorage.getItem(recoveryRequestOriginKey);
    const hasPreviousRecoverySession = window.localStorage.getItem(recoverySessionKey) === 'true';
    const navigationType = performance.getEntriesByType('navigation')[0]?.toJSON().type ?? 'unknown';
    const originMatchesRequest = requestedOrigin ? requestedOrigin === window.location.origin : null;
    let active = true;
    let timeoutId = 0;
    let subscription: { unsubscribe: () => void } | undefined;
    let sdkProcessedUrl = false;
    let urlCleaned = false;
    let sessionWasResolved = false;

    let sessionLookupError: unknown = null;
    const cleanSdkProcessedUrl = () => {
      if (!sdkProcessedUrl || urlCleaned) return;
      window.history.replaceState(null, document.title, window.location.pathname);
      urlCleaned = true;
      logAuthDiagnostic('PasswordResetPage', 'URL cleaned after SDK processing', {
        pathname: window.location.pathname,
      });
    };
    const finish = (session: Session | null, failureMessage?: string) => {
      if (!active || (resolved.current && (!session || sessionWasResolved))) {
        cleanSdkProcessedUrl();
        return;
      }
      resolved.current = true;
      window.clearTimeout(timeoutId);
      subscription?.unsubscribe();
      if (session) {
        sessionWasResolved = true;
        window.localStorage.setItem(recoverySessionKey, 'true');
        setRecoveryMode(true);
        setSessionReady(true);
        setLinkError('');
        logAuthDiagnostic('PasswordResetPage', 'recovery session ready', {
          source: 'auth event or getSession',
          hasSession: true,
        });
      } else {
        setRecoveryMode(false);
        const message = errorMessage ?? failureMessage ?? recoverySessionError(Boolean(recoveryCode));
        const originNotice = originMatchesRequest === false
          ? ' Tautan dibuka pada origin yang berbeda dari origin saat meminta email pemulihan.'
          : '';
        setLinkError(`${message}${originNotice}`);
        logAuthDiagnostic('PasswordResetPage', 'recovery session unavailable', {
          hasSession: false,
          errorCode: query.get('error_code') ?? hash.get('error_code') ?? errorDiagnosticCode(sessionLookupError),
          originMatchesRequest,
        });
      }
      cleanSdkProcessedUrl();
      setCheckingLink(false);
    };

    logAuthDiagnostic('PasswordResetPage', 'mount', {
      mount: nextAuthDiagnosticMountCount('catatuang.auth-debug.reset-page-mounts'),
      navigationType,
      origin: window.location.origin,
      pathname: window.location.pathname,
      hasCode: Boolean(recoveryCode),
      errorCode: query.get('error_code') ?? hash.get('error_code'),
      hashKeys: [...hash.keys()],
      previousRecoverySession: hasPreviousRecoverySession,
      requestedOrigin,
      originMatchesRequest,
    });

    const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange((event, session) => {
      logAuthDiagnostic('PasswordResetPage', 'onAuthStateChange', {
        event,
        hasSession: Boolean(session),
      });
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        sdkProcessedUrl = true;
        finish(session);
      }
    });
    subscription = authSubscription;
    timeoutId = window.setTimeout(() => finish(
      null,
      sessionLookupError
        ? `Sesi pemulihan tidak dapat diperiksa. Periksa koneksi lalu buka kembali tautan. (Kode error Supabase: ${errorDiagnosticCode(sessionLookupError) ?? 'unknown'})`
        : recoverySessionError(Boolean(recoveryCode)),
    ), recoverySessionWaitMs);
    void supabase.auth.getSession().then(({ data, error }) => {
      sdkProcessedUrl = true;
      logAuthDiagnostic('PasswordResetPage', 'getSession resolved', {
        hasSession: Boolean(data.session),
        errorCode: errorDiagnosticCode(error),
      });
      if (error) {
        sessionLookupError = error;
        finish(null);
        return;
      }
      if (data.session) finish(data.session);
    }).catch((error: unknown) => {
      sdkProcessedUrl = true;
      sessionLookupError = error;
      logAuthDiagnostic('PasswordResetPage', 'getSession rejected', {
        errorCode: errorDiagnosticCode(error),
      });
      finish(null);
    });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      subscription?.unsubscribe();
    };
  }, [setRecoveryMode]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || pending) return;
    setError('');
    if (password.length < 8) { setError('Password baru minimal 8 karakter.'); return; }
    if (password !== confirmation) { setError('Konfirmasi password tidak sama.'); return; }
    if (!sessionReady) {
      setError('Sesi pemulihan tidak ditemukan. Minta tautan pemulihan baru.');
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      await completePasswordReset(password, confirmation, apiService.resetPassword, setRecoveryMode, navigate);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Password belum dapat diperbarui.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
    <div className="w-full max-w-md">
      <Link to="/login" className="mb-8 flex items-center justify-center gap-3 text-slate-900"><span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600 text-white"><Wallet className="h-5 w-5" /></span><span className="text-xl font-bold">CatatUang</span></Link>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900">Buat password baru</h1>
        <p className="mt-1 text-sm text-slate-500">Gunakan password minimal 8 karakter.</p>
        {checkingLink ? <p role="status" className="mt-6 text-sm text-slate-500">Memeriksa tautan pemulihan...</p> : linkError ? <div className="mt-6 space-y-4"><p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{linkError}</p><Link to="/login?forgot=1" className="inline-flex text-sm font-semibold text-blue-700 hover:text-blue-800">Minta tautan pemulihan baru</Link></div> : <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
          {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>}
          {error && <Link to="/login?forgot=1" className="inline-flex text-sm font-semibold text-blue-700 hover:text-blue-800">Minta tautan pemulihan baru</Link>}
          <div><label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-slate-700">Password baru</label><input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></div>
          <div><label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-slate-700">Ulangi password baru</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></div>
          <button type="submit" disabled={pending || !sessionReady} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{pending ? 'Menyimpan...' : 'Simpan password baru'}</button>
        </form>}
      </section>
    </div>
  </main>;
}
