import type { DateValue } from '@mantine/dates';

/**
 * Calendar month helpers, shared by all monthly reports.
 * Months are handled as {year, month} (1-12) to avoid timezone issues.
 */
export type YearMonth = { year: number; month: number };

export function currentMonth(): YearMonth {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function shiftMonth(ym: YearMonth, offset: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + offset;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

// 'YYYY-MM' key (sorts chronologically as a string)
export function monthKey(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, '0')}`;
}

export function parseMonthKey(key: string): YearMonth {
  const [year, month] = key.split('-').map(Number);
  return { year, month };
}

export function isCurrentMonth(ym: YearMonth): boolean {
  return monthKey(ym) === monthKey(currentMonth());
}

// Localised month name, e.g. "June 2025" (or "Jun 25" when short)
export function monthLabel(ym: YearMonth, locale: string, short = false) {
  return new Date(ym.year, ym.month - 1, 1).toLocaleDateString(locale, {
    month: short ? 'short' : 'long',
    year: short ? '2-digit' : 'numeric'
  });
}

// Mantine date pickers use 'YYYY-MM-DD' strings
export function toPickerValue(ym: YearMonth): string {
  return `${monthKey(ym)}-01`;
}

// Parse the picker value without going via Date, which would apply a UTC
// offset to 'YYYY-MM-DD' strings and could shift the month
export function fromPickerValue(value: DateValue | Date): YearMonth | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return { year: value.getFullYear(), month: value.getMonth() + 1 };
  }

  const match = /^(\d{4})-(\d{2})/.exec(value);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}
