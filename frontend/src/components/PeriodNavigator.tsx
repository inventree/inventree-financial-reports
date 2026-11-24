import { ActionButton, StylishText } from '@inventreedb/ui';
import { t } from '@lingui/core/macro';
import {
  Badge,
  Button,
  Group,
  Paper,
  Popover,
  SegmentedControl,
  Space,
  Tooltip
} from '@mantine/core';
import { type DateValue, MonthPicker, YearPicker } from '@mantine/dates';
import {
  IconCalendarMonth,
  IconChevronLeft,
  IconChevronRight
} from '@tabler/icons-react';
import { useState } from 'react';
import {
  currentMonth,
  fromPickerValue,
  isCurrentPeriod,
  monthKey,
  type Period,
  periodLabel,
  periodStart,
  shiftPeriod,
  toPickerValue,
  type YearMonth
} from '../periods';

/**
 * Period-specific text (built at render time, for the active locale)
 */
function periodText(period: Period) {
  switch (period) {
    case 'quarter':
      return {
        previous: t`Previous quarter`,
        next: t`Next quarter`,
        toDate: t`Quarter to date`,
        current: t`This quarter`
      };
    case 'year':
      return {
        previous: t`Previous year`,
        next: t`Next year`,
        toDate: t`Year to date`,
        current: t`This year`
      };
    default:
      return {
        previous: t`Previous month`,
        next: t`Next month`,
        toDate: t`Month to date`,
        current: t`This month`
      };
  }
}

/**
 * Period selection bar. Future periods cannot be selected.
 *
 * Layout follows the built-in InvenTree calendar header:
 * prev | picker | next | period name ... period mode | actions
 *
 * `value` may be any month - it is shown as the period which contains it.
 */
export function PeriodNavigator({
  value,
  period,
  onChange,
  onPeriodChange,
  locale
}: {
  value: YearMonth;
  period: Period;
  onChange: (value: YearMonth) => void;
  onPeriodChange: (period: Period) => void;
  locale: string;
}) {
  const [pickerOpened, setPickerOpened] = useState<boolean>(false);

  const text = periodText(period);
  const start = periodStart(value, period);
  const atCurrentPeriod = isCurrentPeriod(value, period);

  const selectDate = (picked: DateValue) => {
    const ym = fromPickerValue(picked);

    if (ym && monthKey(ym) <= monthKey(currentMonth())) {
      onChange(periodStart(ym, period));
    }

    setPickerOpened(false);
  };

  // Months are picked for quarters too (the quarter containing it is used)
  const pickerProps = {
    value: toPickerValue(start),
    defaultDate: toPickerValue(start),
    maxDate: toPickerValue(currentMonth()),
    onChange: selectDate
  };

  return (
    <Paper withBorder p='sm'>
      <Group justify='space-between' gap='xs'>
        <Group gap={0} justify='left'>
          <ActionButton
            icon={<IconChevronLeft />}
            onClick={() => onChange(shiftPeriod(value, period, -1))}
            tooltipAlignment='top'
            tooltip={text.previous}
          />
          <Popover
            opened={pickerOpened}
            onClose={() => setPickerOpened(false)}
            position='bottom-start'
            shadow='md'
          >
            <Popover.Target>
              <Tooltip label={t`Select period`} position='top'>
                <Button
                  m={0}
                  variant='transparent'
                  aria-label='financial-reports-select-period'
                  onClick={() => setPickerOpened(!pickerOpened)}
                >
                  <IconCalendarMonth />
                </Button>
              </Tooltip>
            </Popover.Target>
            <Popover.Dropdown>
              {period === 'year' ? (
                <YearPicker {...pickerProps} />
              ) : (
                <MonthPicker {...pickerProps} />
              )}
            </Popover.Dropdown>
          </Popover>
          <ActionButton
            icon={<IconChevronRight />}
            onClick={() => onChange(shiftPeriod(value, period, 1))}
            tooltipAlignment='top'
            tooltip={text.next}
            disabled={atCurrentPeriod}
          />
          <Space w='sm' />
          <StylishText size='lg'>
            {periodLabel(value, period, locale)}
          </StylishText>
        </Group>
        <Group gap='xs'>
          {atCurrentPeriod && <Badge variant='light'>{text.toDate}</Badge>}
          <SegmentedControl
            size='xs'
            value={period}
            onChange={(selected) => onPeriodChange(selected as Period)}
            data={[
              { value: 'month', label: t`Monthly` },
              { value: 'quarter', label: t`Quarterly` },
              { value: 'year', label: t`Yearly` }
            ]}
          />
          <Button
            variant='default'
            size='xs'
            disabled={atCurrentPeriod}
            onClick={() => onChange(currentMonth())}
          >
            {text.current}
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}
