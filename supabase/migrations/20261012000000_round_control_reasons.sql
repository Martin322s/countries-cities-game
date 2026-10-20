-- Commit new enum values before using them in functions.
alter type public.round_lock_reason add value if not exists 'stop';
alter type public.sheet_lock_reason add value if not exists 'tab_exit';
