-- Migration to fix "record 'new' has no field '_updated_at'" error on usage_daily table
-- This error happens when a trigger tries to access a column that doesn't exist.
-- We will normalize the trigger to use the 'updated_at' column.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return NEW;
end;
$function$;
