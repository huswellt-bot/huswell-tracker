begin;

alter function private.lead_costing_is_operator(uuid)
  set search_path = public, private;

commit;
