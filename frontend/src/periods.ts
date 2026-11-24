import { t } from '@lingui/core/macro';
import type { DateValue } from '@mantine/dates';

/**
 * Calendar period helpers, shared by all reports.
 * Months are handled as {year, month} (1-12) to avoid timezone issues.
 * A period (month, quarter or year) is identified by its first month.
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

// Reporting periods (values match the API 'period' parameter)
export type Period = 'month' | 'quarter' | 'year';

export const DEFAULT_PERIOD: Period = 'month';

const PERIOD_MONTHS: Record<Period, number> = {
  month: 1,
  quarter: 3,
  year: 12
};

// First month of the calendar period containing the given month
export function periodStart(ym: YearMonth, period: Period): YearMonth {
  const length = PERIOD_MONTHS[period];
  const month = Math.floor((ym.month - 1) / length) * length + 1;
  return { year: ym.year, month: month };
}

// Start of the period offset by the given number of periods
export function shiftPeriod(
  ym: YearMonth,
  period: Period,
  offset: number
): YearMonth {
  return shiftMonth(periodStart(ym, period), offset * PERIOD_MONTHS[period]);
}

export function isCurrentPeriod(ym: YearMonth, period: Period): boolean {
  return (
    monthKey(periodStart(ym, period)) ===
    monthKey(periodStart(currentMonth(), period))
  );
}

// Localised month name, e.g. "June 2025" (or "Jun 25" when short)
export function monthLabel(ym: YearMonth, locale: string, short = false) {
  return new Date(ym.year, ym.month - 1, 1).toLocaleDateString(locale, {
    month: short ? 'short' : 'long',
    year: short ? '2-digit' : 'numeric'
  });
}

// Localised period name, e.g. "June 2025" / "Q2 2025" / "2025"
// (short: "Jun 25" / "Q2 25" / "2025")
export function periodLabel(
  ym: YearMonth,
  period: Period,
  locale: string,
  short = false
): string {
  const start = periodStart(ym, period);
  const year =
    short && period !== 'year' ? String(start.year).slice(-2) : start.year;

  switch (period) {
    case 'quarter': {
      const quarter = Math.floor((start.month - 1) / 3) + 1;
      return t`Q${quarter} ${year}`;
    }
    case 'year':
      return `${year}`;
    default:
      return monthLabel(start, locale, short);
  }
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
