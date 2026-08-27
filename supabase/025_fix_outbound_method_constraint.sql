-- Accept the exact Outbound Method labels used by the Lead Tracker form,
-- while continuing to accept values saved by earlier versions.

alter table public.leads
  drop constraint if exists leads_contact_method_check,
  add constraint leads_contact_method_check
  check (
    contact_method is null
    or lower(contact_method) in (
      'viber', 'whatsapp', 'messenger', 'phone call', 'email',
      'phone_call', 'facebook', 'linkedin', 'walk_in', 'other'
    )
  );
