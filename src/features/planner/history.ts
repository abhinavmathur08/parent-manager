import { addDays, FREE_HISTORY_DAYS, startOfWeek, type PlanDate, type WeekStart } from './week';

export type HistoryWeek = {
  start: PlanDate;
  meals: { date: PlanDate; title: string }[];
  items: { total: number; bought: number } | null;
};

type Entry = {
  date: string;
  deleted_at: string | null;
  recipe_id: string | null;
  free_text: string | null;
  slot: string;
  position: number;
};
type List = { id: string; week_start: string; deleted_at: string | null };
type Item = { list_id: string; deleted_at: string | null; checked: boolean };

/**
 * S-34's past weeks (G-08, FR-LIST-13), newest first: every week before the current one that
 * has a plan or a list. On Free, only the 4 weeks before the current one, which is all the
 * server returns anyway (FR-PAY-6); `freeWindow` is false on Premium.
 */
export function historyWeeks(
  entries: readonly Entry[],
  lists: readonly List[],
  items: readonly Item[],
  today: PlanDate,
  weekStart: WeekStart,
  titleOf: (entry: Entry) => string,
  freeWindow: boolean,
): HistoryWeek[] {
  const current = startOfWeek(today, weekStart);
  const oldest = freeWindow ? addDays(current, -FREE_HISTORY_DAYS) : null;
  const visible = (start: PlanDate) => start < current && (!oldest || start >= oldest);
  const weeks = new Map<PlanDate, HistoryWeek>();
  const week = (start: PlanDate) => {
    let found = weeks.get(start);
    if (!found) {
      found = { start, meals: [], items: null };
      weeks.set(start, found);
    }
    return found;
  };

  for (const entry of entries) {
    if (entry.deleted_at) continue;
    const start = startOfWeek(entry.date, weekStart);
    if (visible(start)) week(start).meals.push({ date: entry.date, title: titleOf(entry) });
  }
  const listWeek = new Map<string, PlanDate>();
  for (const list of lists) {
    if (list.deleted_at || !visible(list.week_start)) continue;
    listWeek.set(list.id, list.week_start);
    week(list.week_start).items ??= { total: 0, bought: 0 };
  }
  for (const item of items) {
    const start = listWeek.get(item.list_id);
    if (!start || item.deleted_at) continue;
    const counts = week(start).items!;
    counts.total += 1;
    if (item.checked) counts.bought += 1;
  }
  for (const found of weeks.values()) {
    found.meals.sort((a, b) => a.date.localeCompare(b.date));
  }
  return [...weeks.values()].sort((a, b) => b.start.localeCompare(a.start));
}
