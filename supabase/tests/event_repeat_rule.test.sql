-- C-01.2, FR2-CAL-4: the server accepts each repeat rule in the glossary and refuses any other
-- shape, matching parseRepeat on the device.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

select ok(private.valid_repeat(null), 'a single event has no rule');
select ok(private.valid_repeat('{"freq": "daily"}'), 'daily');
select ok(private.valid_repeat('{"freq": "daily", "count": 10}'), 'daily, after a count');
select ok(private.valid_repeat('{"freq": "weekly", "weekdays": [1, 3]}'), 'weekly on weekdays');
select ok(private.valid_repeat('{"freq": "weekly", "weekdays": [7, 1, 2, 3, 4, 5, 6]}'), 'every weekday');
select ok(private.valid_repeat('{"freq": "weekly", "interval": 2, "weekdays": [5]}'), 'every 2 weeks');
select ok(private.valid_repeat('{"freq": "monthly", "until": "2027-06-30"}'), 'monthly, until a date');
select ok(private.valid_repeat('{"freq": "daily", "until": null, "count": 3}'), 'null values count as missing');

select ok(not private.valid_repeat('[]'), 'not an object');
select ok(not private.valid_repeat('{"freq": "yearly"}'), 'no yearly rule');
select ok(not private.valid_repeat('{"freq": "weekly"}'), 'weekly needs weekdays');
select ok(not private.valid_repeat('{"freq": "weekly", "weekdays": []}'), 'at least one weekday');
select ok(not private.valid_repeat('{"freq": "weekly", "weekdays": [0]}'), 'weekdays are 1 to 7');
select ok(not private.valid_repeat('{"freq": "weekly", "weekdays": [2, 2]}'), 'each weekday once');
select ok(not private.valid_repeat('{"freq": "daily", "interval": 2}'), 'every 2 days isn''t a rule');
select ok(not private.valid_repeat('{"freq": "daily", "weekdays": [1]}'), 'weekdays only for weekly');
select ok(not private.valid_repeat('{"freq": "daily", "count": 0}'), 'a count is at least 1');
select ok(not private.valid_repeat('{"freq": "daily", "count": 1.5}'), 'a count is whole');
select ok(not private.valid_repeat('{"freq": "daily", "until": "2027-13-01"}'), 'until is a date');
select ok(not private.valid_repeat('{"freq": "daily", "count": 2, "until": "2027-01-01"}'), 'until or count, not both');
select ok(not private.valid_repeat('{"freq": "daily", "byhour": 3}'), 'unknown keys are refused');

select col_has_check('public', 'events', 'repeat', 'events check their rule');

select * from finish();
rollback;
