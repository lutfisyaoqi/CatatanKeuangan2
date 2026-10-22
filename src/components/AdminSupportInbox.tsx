import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, MessageCircle, RefreshCw, Search, Send, Users } from 'lucide-react';
import { AdminUser, apiService, SupportConversation, SupportMessage } from '../services/apiService.js';

const supportUserPageSize = 25;

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Tanggal tidak tersedia'
    : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export const AdminSupportInbox: React.FC = () => {
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [userRefreshSequence, setUserRefreshSequence] = useState(0);
  const [listMode, setListMode] = useState<'messages' | 'users'>('messages');
  const [selectedId, setSelectedId] = useState('');
  const [openingUserId, setOpeningUserId] = useState('');
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [error, setError] = useState('');
  const messageEndRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async () => {
    const result = await apiService.listAdminSupportConversations();
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

  const refresh = useCallback(async () => {
    await refreshConversations();
    await refreshMessages();
  }, [refreshConversations, refreshMessages]);

  useEffect(() => {
    if (listMode !== 'users') return;
    let active = true;
    setLoading(true);
    void apiService.listAdminUsers(userPage, supportUserPageSize, userSearch, 'name', 'asc')
      .then((result) => {
        if (!active) return;
        setUsers(result.users);
        setUsersTotal(result.total);
        setError('');
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Daftar pengguna belum dapat dimuat.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [listMode, userPage, userRefreshSequence, userSearch]);

  useEffect(() => {
    let active = true;
    void refreshConversations().then((result) => {
      if (active && result[0]) setSelectedId((current) => current || result[0].id);
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Inbox chat belum dapat dimuat.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshConversations]);

  useEffect(() => {
    const refreshInbox = () => {
      if (listMode === 'users') {
        setUserRefreshSequence((sequence) => sequence + 1);
      } else {
        void refresh().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Inbox belum dapat diperbarui.'));
      }
    };
    window.addEventListener('catatuang-support-refresh', refreshInbox);
    return () => window.removeEventListener('catatuang-support-refresh', refreshInbox);
  }, [listMode, refresh]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [result, threads] = await Promise.all([
          apiService.listSupportMessages(selectedId),
          apiService.listAdminSupportConversations(),
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

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedId) return;
    setSending(true);
    setError('');
    try {
      await apiService.sendSupportMessage(selectedId, draft, true);
      setDraft('');
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Balasan belum dapat dikirim.');
    } finally {
      setSending(false);
    }
  };

  const openUserConversation = async (userId: string) => {
    setOpeningUserId(userId);
    setError('');
    try {
      const conversation = await apiService.getOrCreateAdminSupportConversation(userId);
      setConversations((current) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ]);
      setSelectedId(conversation.id);
      setListMode('messages');
      setDraft('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Chat untuk pengguna ini belum dapat dibuka.');
    } finally {
      setOpeningUserId('');
    }
  };

  const toggleStatus = async () => {
    const selected = conversations.find((conversation) => conversation.id === selectedId);
    if (!selected) return;
    setUpdatingStatus(true);
    setError('');
    try {
      await apiService.updateSupportConversationStatus(selected.id, selected.status === 'open' ? 'closed' : 'open');
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Status chat belum dapat diperbarui.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const selected = conversations.find((conversation) => conversation.id === selectedId);
  const userPageCount = Math.max(1, Math.ceil(usersTotal / supportUserPageSize));

  return <section className="grid min-h-[65vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[320px_minmax(0,1fr)]">
    <aside className="border-b border-slate-200 p-4 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between gap-2"><div><h2 className="font-bold text-slate-900">Pesan</h2><p className="mt-1 text-xs text-slate-500">{listMode === 'users' ? `${usersTotal} pengguna` : `${conversations.length} percakapan`}</p></div><button type="button" onClick={() => { if (listMode === 'users') setUserRefreshSequence((sequence) => sequence + 1); else void refresh().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Inbox belum dapat diperbarui.')); }} aria-label="Segarkan inbox" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /></button></div>
      <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
        <button type="button" onClick={() => setListMode('messages')} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold ${listMode === 'messages' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}><MessageCircle className="h-3.5 w-3.5" />Chat</button>
        <button type="button" onClick={() => { setListMode('users'); setUserPage(1); }} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold ${listMode === 'users' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}><Users className="h-3.5 w-3.5" />Semua pengguna</button>
      </div>
      {listMode === 'users' && <label className="relative mt-3 block"><span className="sr-only">Cari pengguna</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" maxLength={120} value={userSearch} onChange={(event) => { setUserSearch(event.target.value); setUserPage(1); }} placeholder="Cari nama atau email" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label>}
      <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto lg:max-h-[calc(65vh-5rem)]">
        {listMode === 'messages' && conversations.map((conversation) => <button key={conversation.id} type="button" onClick={() => { setDraft(''); setSelectedId(conversation.id); }} className={`w-full rounded-xl border p-3 text-left ${selectedId === conversation.id ? 'border-blue-300 bg-blue-50' : 'border-slate-100 hover:bg-slate-50'}`}>
          <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-800">{conversation.subject}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${conversation.status === 'open' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{conversation.status === 'open' ? 'Aktif' : 'Selesai'}</span></span>
          <span className="mt-1 block truncate text-xs font-medium text-slate-600">{conversation.userName || 'Pengguna'}</span>
          <span className="block truncate text-xs text-slate-500">{conversation.userEmail || conversation.userId}</span>
          <span className="mt-1 block text-[11px] text-slate-400">{formatDate(conversation.updatedAt)}</span>
        </button>)}
        {listMode === 'users' && users.map((account) => <button key={account.id} type="button" disabled={account.account_status !== 'active' || Boolean(openingUserId)} onClick={() => void openUserConversation(account.id)} className="w-full rounded-xl border border-slate-100 p-3 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55">
          <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-800">{account.name || 'Tanpa nama'}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${account.account_status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{account.account_status === 'active' ? 'Aktif' : 'Nonaktif'}</span></span>
          <span className="mt-1 block truncate text-xs text-slate-500">{account.email}</span>
          {openingUserId === account.id && <span className="mt-1 inline-flex items-center gap-1 text-xs text-blue-700"><LoaderCircle className="h-3 w-3 animate-spin" />Membuka chat...</span>}
        </button>)}
        {!loading && listMode === 'messages' && conversations.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Belum ada percakapan. Pilih tab Semua pengguna untuk memulai chat.</p>}
        {!loading && listMode === 'users' && users.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Pengguna tidak ditemukan.</p>}
        {loading && <p role="status" className="flex items-center gap-2 text-xs text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />{listMode === 'users' ? 'Memuat pengguna...' : 'Memuat inbox...'}</p>}
      </div>
      {listMode === 'users' && userPageCount > 1 && <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500"><button type="button" disabled={userPage <= 1 || loading} onClick={() => setUserPage((page) => page - 1)} className="rounded px-2 py-1 font-semibold text-blue-700 disabled:text-slate-300">Sebelumnya</button><span>Halaman {userPage} / {userPageCount}</span><button type="button" disabled={userPage >= userPageCount || loading} onClick={() => setUserPage((page) => page + 1)} className="rounded px-2 py-1 font-semibold text-blue-700 disabled:text-slate-300">Berikutnya</button></div>}
    </aside>

    <div className="flex min-h-[65vh] flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0"><h2 className="truncate font-bold text-slate-900">{selected?.subject || 'Pilih percakapan'}</h2><p className="mt-1 truncate text-xs text-slate-500">{selected ? `${selected.userName || 'Pengguna'} · ${selected.userEmail || selected.userId}` : 'Pesan pengguna akan muncul di sini.'}</p></div>
        {selected && <button type="button" disabled={updatingStatus} onClick={() => void toggleStatus()} className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50 ${selected.status === 'open' ? 'border border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-emerald-700 text-white hover:bg-emerald-800'}`}>{updatingStatus ? 'Menyimpan...' : selected.status === 'open' ? 'Tandai selesai' : 'Buka kembali'}</button>}
      </header>
      {error && <p role="alert" className="mx-5 mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div aria-live="polite" className="flex flex-1 flex-col gap-3 overflow-y-auto bg-slate-50/70 p-5">
        {messages.map((message) => <article key={message.id} className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${message.senderRole === 'admin' ? 'self-end rounded-br-md bg-blue-700 text-white' : 'self-start rounded-bl-md border border-slate-200 bg-white text-slate-800'}`}>
          <p className="mb-1 text-[11px] font-semibold opacity-75">{message.senderRole === 'admin' ? 'Admin' : selected?.userName || 'Pengguna'} · {formatDate(message.createdAt)}</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>
        </article>)}
        {selected && messages.length === 0 && <p className="m-auto text-sm text-slate-500">Belum ada pesan dalam percakapan ini.</p>}
        {!selected && <p className="m-auto text-sm text-slate-500">Pilih percakapan untuk membaca dan membalas pesan.</p>}
        <div ref={messageEndRef} />
      </div>
      {selected && <form onSubmit={(event) => void sendMessage(event)} className="flex items-end gap-2 border-t border-slate-200 p-4">
        <label className="sr-only" htmlFor="admin-support-message">Balas pesan pengguna</label>
        <textarea id="admin-support-message" required maxLength={4000} rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Tulis balasan..." className="max-h-36 min-h-12 flex-1 resize-y rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
        <button type="submit" disabled={sending} aria-label="Kirim balasan" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50"><Send className="h-4 w-4" /></button>
      </form>}
    </div>
  </section>;
};
