import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, LoaderCircle, MessageCircle, Plus, RefreshCw, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiService, SupportConversation, SupportMessage } from '../services/apiService.js';

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Tanggal tidak tersedia'
    : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export const SupportPage: React.FC = () => {
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [subject, setSubject] = useState('');
  const [draft, setDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const messageEndRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async () => {
    const result = await apiService.listSupportConversations();
    setConversations(result);
    return result;
  }, []);

  const refreshMessages = useCallback(async () => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    setMessages(await apiService.listSupportMessages(selectedId));
  }, [selectedId]);

  useEffect(() => {
    let active = true;
    void refreshConversations().then((result) => {
      if (active && result[0]) setSelectedId((current) => current || result[0].id);
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Chat belum dapat dimuat.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshConversations]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [result, threads] = await Promise.all([
          apiService.listSupportMessages(selectedId),
          apiService.listSupportConversations(),
        ]);
        if (active) {
          setMessages(result);
          setConversations(threads);
          setError('');
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Pesan belum dapat dimuat.');
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 8000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const startConversation = async (event: React.FormEvent) => {
    event.preventDefault();
    setStarting(true);
    setError('');
    try {
      const id = await apiService.createSupportConversation(subject, draft);
      setSubject('');
      setDraft('');
      await refreshConversations();
      setSelectedId(id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Chat belum dapat dikirim.');
      try {
        await refreshConversations();
      } catch (refreshError) {
        setError(`${requestError instanceof Error ? requestError.message : 'Chat belum dapat dikirim.'} Daftar chat juga gagal diperbarui${refreshError instanceof Error ? `: ${refreshError.message}` : '.'}`);
      }
    } finally {
      setStarting(false);
    }
  };

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedId) return;
    setSending(true);
    setError('');
    try {
      await apiService.sendSupportMessage(selectedId, draft, false);
      setDraft('');
      await Promise.all([refreshMessages(), refreshConversations()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Pesan belum dapat dikirim.');
    } finally {
      setSending(false);
    }
  };

  const selected = conversations.find((conversation) => conversation.id === selectedId);

  return <main className="min-h-screen bg-slate-50">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white"><MessageCircle className="h-5 w-5" /></span>
          <div><h1 className="font-bold text-slate-900">Bantuan admin</h1><p className="text-xs text-slate-500">Chat dukungan CatatUang</p></div>
        </div>
        <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" />Dashboard</Link>
      </div>
    </header>

    <div className="mx-auto grid max-w-6xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div><h2 className="font-bold text-slate-900">Percakapan</h2><p className="mt-1 text-xs text-slate-500">{conversations.length} chat</p></div>
          <button type="button" onClick={() => { setSelectedId(''); setSubject(''); setDraft(''); }} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"><Plus className="h-4 w-4" />Chat baru</button>
        </div>
        <div className="mt-4 space-y-2">
          {conversations.map((conversation) => <button key={conversation.id} type="button" onClick={() => { setDraft(''); setSelectedId(conversation.id); }} className={`w-full rounded-xl border p-3 text-left transition ${selectedId === conversation.id ? 'border-blue-300 bg-blue-50' : 'border-slate-100 hover:bg-slate-50'}`}>
            <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-800">{conversation.subject}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${conversation.status === 'open' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{conversation.status === 'open' ? 'Aktif' : 'Selesai'}</span></span>
            <span className="mt-1 block text-xs text-slate-500">{formatDate(conversation.updatedAt)}</span>
          </button>)}
          {!loading && conversations.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">Belum ada percakapan. Mulai chat baru untuk menghubungi admin.</p>}
        </div>
        {loading && <p role="status" className="mt-3 flex items-center gap-2 text-xs text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />Memuat chat...</p>}
      </aside>

      <section className="flex min-h-[70vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div><h2 className="font-bold text-slate-900">{selected?.subject || 'Mulai percakapan baru'}</h2><p className="mt-1 text-xs text-slate-500">{selected ? selected.status === 'open' ? 'Admin akan membalas di sini.' : 'Percakapan ini sudah ditandai selesai.' : 'Jelaskan kendala atau pertanyaanmu.'}</p></div>
          <button type="button" onClick={() => { void refreshConversations().then(refreshMessages).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Chat belum dapat diperbarui.')); }} aria-label="Segarkan chat" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /></button>
        </div>

        {error && <p role="alert" className="mx-5 mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        {!selected ? <form onSubmit={(event) => void startConversation(event)} className="flex flex-1 flex-col gap-4 p-5">
          <label className="text-sm font-medium text-slate-700">Topik<input required maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Contoh: Kendala mencatat transaksi" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label>
          <label className="flex flex-1 flex-col text-sm font-medium text-slate-700">Pesan<textarea required maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ceritakan yang ingin ditanyakan..." className="mt-1.5 min-h-40 flex-1 resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label>
          <button type="submit" disabled={starting} className="inline-flex w-fit items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"><Send className="h-4 w-4" />{starting ? 'Mengirim...' : 'Kirim ke admin'}</button>
        </form> : <>
          <div aria-live="polite" className="flex flex-1 flex-col gap-3 overflow-y-auto bg-slate-50/70 p-5">
            {messages.map((message) => <article key={message.id} className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${message.senderRole === 'user' ? 'self-end rounded-br-md bg-blue-700 text-white' : 'self-start rounded-bl-md border border-slate-200 bg-white text-slate-800'}`}>
              <p className="mb-1 text-[11px] font-semibold opacity-75">{message.senderRole === 'user' ? 'Kamu' : 'Admin'} · {formatDate(message.createdAt)}</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>
            </article>)}
            {messages.length === 0 && <p className="m-auto text-sm text-slate-500">Belum ada pesan.</p>}
            <div ref={messageEndRef} />
          </div>
          {selected.status === 'open' ? <form onSubmit={(event) => void sendMessage(event)} className="flex items-end gap-2 border-t border-slate-200 p-4">
            <label className="sr-only" htmlFor="support-message">Tulis pesan</label>
            <textarea id="support-message" required maxLength={4000} rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Tulis pesan..." className="max-h-36 min-h-12 flex-1 resize-y rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
            <button type="submit" disabled={sending} aria-label="Kirim pesan" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50"><Send className="h-4 w-4" /></button>
          </form> : <p className="border-t border-slate-200 px-5 py-4 text-sm text-slate-500">Chat selesai. Buat chat baru jika masih perlu bantuan.</p>}
        </>}
      </section>
    </div>
  </main>;
};
