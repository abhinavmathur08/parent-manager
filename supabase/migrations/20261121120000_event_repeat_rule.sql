-- C-01.2 (part 2): the server checks a repeating event's rule (spec FR2-CAL-4, glossary
-- "Repeat"; architecture section 3.5). The device expands it (src/features/calendar/repeat.ts,
-- parseRepeat), and this is the same shape:
--
--   { "freq": "daily" | "weekly" | "monthly",
--     "interval": 1 | 2,                -- optional; 2 ("every 2 weeks") for weekly only
--     "weekdays": [1..7],               -- ISO weekdays, required for weekly, not allowed otherwise
--     "until": "YYYY-MM-DD",            -- optional, inclusive, in the household's timezone
--     "count": 1..730 }                 -- optional; not with until
--
-- Null values count as missing. Unknown keys are refused, so a newer app can't store a rule an
-- older one would misread.

create function private.valid_repeat(rule jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  r jsonb;
  freq text;
begin
  if rule is null then
    return true;
  end if;
  if jsonb_typeof(rule) <> 'object' then
    return false;
  end if;
  r := jsonb_strip_nulls(rule);
  freq := r ->> 'freq';
  if freq is null or freq not in ('daily', 'weekly', 'monthly')
    or (r - array['freq', 'interval', 'weekdays', 'until', 'count']) <> '{}'::jsonb then
    return false;
  end if;
  if r ? 'interval' and not (
    (r -> 'interval') = '1'::jsonb or ((r -> 'interval') = '2'::jsonb and freq = 'weekly')
  ) then
    return false;
  end if;
  if freq = 'weekly' then
    if jsonb_typeof(r -> 'weekdays') is distinct from 'array'
      or jsonb_array_length(r -> 'weekdays') not between 1 and 7
      or exists (
        select 1 from jsonb_array_elements(r -> 'weekdays') d
        where d not in ('1', '2', '3', '4', '5', '6', '7')
      )
      or (select count(distinct d) from jsonb_array_elements(r -> 'weekdays') d)
        <> jsonb_array_length(r -> 'weekdays') then
      return false;
    end if;
  elsif r ? 'weekdays' then
    return false;
  end if;
  if r ? 'until' and (jsonb_typeof(r -> 'until') <> 'string'
    or (r ->> 'until') !~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$') then
    return false;
  end if;
  if r ? 'count' and (jsonb_typeof(r -> 'count') <> 'number'
    or (r ->> 'count') !~ '^\d{1,3}$'
    or (r ->> 'count')::integer not between 1 and 730) then
    return false;
  end if;
  return not (r ? 'until' and r ? 'count');
end;
$$;

revoke all on function private.valid_repeat(jsonb) from public;

-- Replaces C-01.1's plain "an object" check. Existing rows are checked as the constraint is
-- added; the calendar has no screens yet, so there are none to fail.
alter table public.events drop constraint events_repeat_check;
alter table public.events add constraint events_repeat_check check (private.valid_repeat(repeat));
