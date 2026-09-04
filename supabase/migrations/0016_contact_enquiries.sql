-- Enquiries from the public "for cities" form on the front page.
--
-- The form's primary job is to email the team, but email is not a record: it
-- can bounce, land in junk, or be deleted by whoever reads the inbox. A city
-- that took the trouble to write in is the most valuable thing this site
-- produces, so the enquiry is stored here as well and the email is treated as
-- a notification about a row rather than as the delivery mechanism.
--
-- Deliberately NOT reusing meetings/jobs: an enquiry is not civic content, it
-- never becomes public, and it must never appear in the library or in search.
--
-- No row-level security policy is added, which means (with RLS enabled) only
-- the service role can read this table. That is correct: the app writes these
-- server-side with the service key, and nothing anonymous should ever read
-- other people's contact details back out.

create table if not exists contact_enquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  organization text not null,
  role text not null default '',
  message text not null,
  -- Coarse provenance for abuse triage. Not shown to anyone in the UI.
  source_ip text,
  user_agent text,
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

alter table contact_enquiries enable row level security;

-- Newest first is the only way this is ever read.
create index if not exists contact_enquiries_created_at_idx
  on contact_enquiries (created_at desc);
