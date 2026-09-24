create table if not exists app_users (
  id text primary key, email text not null unique, name text not null, password_hash text not null,
  role text not null check (role in ('admin', 'editor', 'reader')), created_at timestamptz not null default now()
);
create table if not exists app_sessions (
  token_hash text primary key, user_id text not null references app_users(id) on delete cascade, expires_at timestamptz not null
);
create table if not exists app_settings (id text primary key, value jsonb not null);
create table if not exists cases (
  id text primary key, user_id text not null references app_users(id), title text not null default 'New case',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists cases_owner on cases(user_id, updated_at desc);
create table if not exists documents (
  id text primary key, owner_id text not null references app_users(id), case_id text references cases(id) on delete cascade,
  title text not null, filename text not null, media_type text not null, byte_size integer not null,
  storage_key text not null, checksum text not null, source_note text not null default '',
  status text not null default 'queued' check(status in ('queued','processing','review','published','failed','deleted')),
  revision integer not null default 1, warnings jsonb not null default '[]', error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists documents_scope on documents(case_id, status);
create index if not exists documents_hash on documents(checksum, owner_id);
create table if not exists document_chunks (
  id text primary key, document_id text not null references documents(id) on delete cascade, revision integer not null,
  ordinal integer not null, locator text not null, content text not null,
  search_vector tsvector generated always as (to_tsvector('simple', content)) stored,
  unique(document_id, revision, ordinal)
);
create index if not exists chunk_search on document_chunks using gin(search_vector);
create index if not exists chunk_document on document_chunks(document_id, revision);
create table if not exists ingestion_jobs (
  id text primary key, document_id text not null unique references documents(id) on delete cascade,
  state text not null default 'queued', attempts integer not null default 0, lease_until timestamptz,
  lease_token text, created_at timestamptz not null default now()
);
create index if not exists jobs_available on ingestion_jobs(state, lease_until);
create table if not exists messages (
  id text primary key, sequence bigserial unique, case_id text not null references cases(id) on delete cascade,
  role text not null check(role in ('user','assistant')), content text not null, sources jsonb not null default '[]',
  status text not null default 'complete', created_at timestamptz not null default now()
);
create index if not exists message_case on messages(case_id, created_at);
create table if not exists audit_events (
  id text primary key, user_id text references app_users(id), action text not null, resource_id text, created_at timestamptz not null default now()
);
create table if not exists usage_events (
  id text primary key, user_id text not null references app_users(id), provider text not null, model text not null,
  input_tokens integer not null default 0, output_tokens integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists request_limits (key text primary key, count integer not null, resets_at timestamptz not null);
