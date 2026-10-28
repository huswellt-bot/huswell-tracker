begin;

update public.business_settings settings
set pricing_markup_defaults =
      (coalesce(settings.pricing_markup_defaults, '{}'::jsonb) - 'third_party_markup')
      || jsonb_build_object(
        'vat',
        (settings.pricing_markup_defaults -> 'third_party_markup')
          || jsonb_build_object(
            'system_role', 'vat',
            'purpose', 'vat',
            'calculation_type', 'percentage'
          )
      ),
    vat_rate = greatest(least(
      coalesce((settings.pricing_markup_defaults -> 'third_party_markup' ->> 'value')::numeric, settings.vat_rate, 0),
      100
    ), 0)
where jsonb_typeof(settings.pricing_markup_defaults) = 'object'
  and settings.pricing_markup_defaults ? 'third_party_markup'
  and lower(btrim(coalesce(settings.pricing_markup_defaults -> 'third_party_markup' ->> 'label', ''))) = 'vat'
  and not exists (
    select 1
    from jsonb_each(settings.pricing_markup_defaults) entry(key, value)
    where private.pricing_markup_purpose(entry.key, entry.value) = 'vat'
  );

commit;
