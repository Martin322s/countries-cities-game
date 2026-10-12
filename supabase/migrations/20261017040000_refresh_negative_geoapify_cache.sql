delete from public.geographic_validation_cache
 where normalized_name like 'geoapify-v1:%'
   and requested_category in ('city', 'village')
   and result ->> 'status' = 'INVALID';
