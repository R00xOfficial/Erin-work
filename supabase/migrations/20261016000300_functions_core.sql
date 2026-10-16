-- 03: core helper functions (no table dependencies).

create or replace function public.fn_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- unaccent() is STABLE; generated columns and indexes need IMMUTABLE, so wrap it with a fixed dictionary.
create or replace function public.fn_immutable_unaccent(text)
returns text language sql immutable parallel safe strict
set search_path = public, extensions
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

-- Mirrors normaliseCompanyName() in packages/shared: lowercase, strip accents, & -> and,
-- punctuation -> space, remove legal-form words only, collapse whitespace.
create or replace function public.fn_normalise_company_name(name text)
returns text language sql immutable parallel safe
set search_path = public, extensions
as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               replace(lower(public.fn_immutable_unaccent(coalesce(name, ''))), '&', ' and '),
               '[^a-z0-9\s]', ' ', 'g'),
             '\m(ltd|limited|llp|lp|plc|inc|incorporated|cic|co|company|uk)\M\.?', ' ', 'g'),
           '\s+', ' ', 'g')), '')
$$;

-- "gu314aa" -> "GU31 4AA"; null when not a full UK postcode.
create or replace function public.fn_normalise_postcode(input text)
returns text language plpgsql immutable parallel safe as $$
declare compact text; spaced text;
begin
  if input is null then return null; end if;
  compact := regexp_replace(upper(input), '[^A-Z0-9]', '', 'g');
  if length(compact) < 5 or length(compact) > 7 then return null; end if;
  spaced := left(compact, length(compact) - 3) || ' ' || right(compact, 3);
  if spaced ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$' then return spaced; end if;
  return null;
end $$;

create or replace function public.fn_postcode_district(input text)
returns text language sql immutable parallel safe as $$
  select case when public.fn_normalise_postcode(input) is not null
              then split_part(public.fn_normalise_postcode(input), ' ', 1)
              when regexp_replace(upper(coalesce(input,'')), '[^A-Z0-9]', '', 'g') ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?$'
              then regexp_replace(upper(input), '[^A-Z0-9]', '', 'g')
              else null end
$$;

create or replace function public.fn_sha256(input text)
returns text language sql immutable parallel safe strict
set search_path = public, extensions
as $$ select encode(extensions.digest(convert_to(input, 'UTF8'), 'sha256'), 'hex') $$;

-- Domain extraction roughly matching extractDomain() in packages/shared.
create or replace function public.fn_extract_domain(url text)
returns text language plpgsql immutable parallel safe as $$
declare host text; parts text[]; n int;
begin
  if url is null or btrim(url) = '' then return null; end if;
  host := lower(btrim(url));
  host := regexp_replace(host, '^[a-z][a-z0-9+.-]*://', '');
  host := split_part(split_part(split_part(host, '/', 1), '?', 1), ':', 1);
  host := regexp_replace(host, '^www\.', '');
  if host = '' or position('.' in host) = 0 then return null; end if;
  parts := string_to_array(host, '.');
  n := array_length(parts, 1);
  if n <= 2 then return host; end if;
  if length(parts[n]) = 2 and parts[n-1] in ('co','org','ac','gov','net','ltd','plc','me','sch') then
    return array_to_string(parts[n-2:n], '.');
  end if;
  return array_to_string(parts[n-1:n], '.');
end $$;

-- array_to_string() is only STABLE; generated columns need IMMUTABLE. Text arrays have no volatile output, so this wrapper is safe.
create or replace function public.fn_immutable_array_to_string(arr text[], sep text)
returns text language sql immutable parallel safe as $$ select array_to_string(arr, sep) $$;
