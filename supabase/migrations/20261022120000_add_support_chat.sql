-- Chat dukungan pengguna dengan admin/support.
-- Jalankan setelah database/schema.sql melalui Supabase SQL Editor.

create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  user_name text not null default '',
  user_email text not null default '',
  subject text not null check (char_length(trim(subject)) between 1 and 120),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  sender_role text not null check (sender_role in ('user', 'admin')),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists support_conversations_user_updated_idx
  on public.support_conversations (user_id, updated_at desc);
create index if not exists support_conversations_status_updated_idx
  on public.support_conversations (status, updated_at desc);
create index if not exists support_messages_conversation_created_idx
  on public.support_messages (conversation_id, created_at);

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;

revoke all on public.support_conversations from public, anon, authenticated;
revoke all on public.support_messages from public, anon, authenticated;
grant select, insert on public.support_conversations to authenticated;
grant update (status) on public.support_conversations to authenticated;
grant select, insert on public.support_messages to authenticated;

create or replace function public.support_can_access_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_conversations c
    where c.id = p_conversation_id
      and (
        (
          c.user_id = (select auth.uid())
          and (select public.account_is_active())
        )
        or public.admin_get_my_role() in ('admin', 'support', 'owner')
      )
  );
$$;
revoke all on function public.support_can_access_conversation(uuid) from public, anon;
grant execute on function public.support_can_access_conversation(uuid) to authenticated;

create or replace function public.support_user_can_message(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_conversations c
    where c.id = p_conversation_id
      and c.user_id = (select auth.uid())
      and c.status = 'open'
      and (select public.account_is_active())
  );
$$;
revoke all on function public.support_user_can_message(uuid) from public, anon;
grant execute on function public.support_user_can_message(uuid) to authenticated;

create or replace function public.support_prepare_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'Percakapan hanya dapat dibuat untuk akun sendiri.' using errcode = '42501';
  end if;
  if not public.account_is_active() then
    raise exception 'Akun aktif diperlukan.' using errcode = '42501';
  end if;

  select coalesce(u.name, ''), coalesce(a.email, '')
    into new.user_name, new.user_email
  from public.users u
  left join auth.users a on a.id = u.id
  where u.id = new.user_id;

  return new;
end;
$$;
revoke all on function public.support_prepare_conversation() from public, anon, authenticated;

create or replace function public.support_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.support_conversations
  set updated_at = now(),
      status = case when new.sender_role = 'admin' then 'open' else status end
  where id = new.conversation_id;
  return new;
end;
$$;
revoke all on function public.support_touch_conversation() from public, anon, authenticated;

drop trigger if exists support_conversations_prepare on public.support_conversations;
create trigger support_conversations_prepare
before insert on public.support_conversations
for each row execute function public.support_prepare_conversation();

drop trigger if exists support_messages_touch_conversation on public.support_messages;
create trigger support_messages_touch_conversation
after insert on public.support_messages
for each row execute function public.support_touch_conversation();

drop policy if exists "support participants can read conversations" on public.support_conversations;
create policy "support participants can read conversations"
on public.support_conversations for select to authenticated
using (
  (user_id = (select auth.uid()) and (select public.account_is_active()))
  or public.admin_get_my_role() in ('admin', 'support', 'owner')
);

drop policy if exists "active users can create support conversations" on public.support_conversations;
create policy "active users can create support conversations"
on public.support_conversations for insert to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'open'
  and (select public.account_is_active())
);

drop policy if exists "admins can update support conversation status" on public.support_conversations;
create policy "admins can update support conversation status"
on public.support_conversations for update to authenticated
using (public.admin_get_my_role() in ('admin', 'support', 'owner'))
with check (public.admin_get_my_role() in ('admin', 'support', 'owner'));

drop policy if exists "support participants can read messages" on public.support_messages;
create policy "support participants can read messages"
on public.support_messages for select to authenticated
using (public.support_can_access_conversation(conversation_id));

drop policy if exists "conversation participants can send messages" on public.support_messages;
create policy "conversation participants can send messages"
on public.support_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and (
    (
      sender_role = 'user'
      and (select public.support_user_can_message(conversation_id))
    )
    or (
      sender_role = 'admin'
      and public.admin_get_my_role() in ('admin', 'support', 'owner')
      and public.support_can_access_conversation(conversation_id)
    )
  )
);
