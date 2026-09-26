-- Allow Instagram as an Outbound Method while preserving legacy lead values.
-- Run after the existing lead tracker migrations and before using the new Add Lead option.

alter table public.leads
  drop constraint if exists leads_contact_method_check,
  add constraint leads_contact_method_check
  check (
    contact_method is null
    or lower(contact_method) in (
      'viber', 'whatsapp', 'messenger', 'instagram', 'phone call', 'email',
      'phone_call', 'facebook', 'linkedin', 'walk_in', 'other'
    )
  );
