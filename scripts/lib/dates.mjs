// 日付は 'YYYY-MM-DD' の文字列で持ち回る。UTC の 00:00 として計算する（時差で日付がずれないように）。
export const GSC_LAG_DAYS = 3;

export function ymd(date) { return date.toISOString().slice(0, 10); }

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

/** GSC は 2〜3 日遅れて確定する。終端を today−lag に置く。 */
export function resolveWindow(days, today, lagDays = GSC_LAG_DAYS) {
  return windowEndingAt(days, addDays(today, -lagDays));
}

export function windowEndingAt(days, endDate) {
  return { days, startDate: addDays(endDate, -(days - 1)), endDate };
}
