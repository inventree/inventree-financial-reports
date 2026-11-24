import { ActionButton, StylishText } from '@inventreedb/ui';
import { t } from '@lingui/core/macro';
import {
  Badge,
  Button,
  Group,
  Paper,
  Popover,
  Space,
  Tooltip
} from '@mantine/core';
import { type DateValue, MonthPicker } from '@mantine/dates';
import {
  IconCalendarMonth,
  IconChevronLeft,
  IconChevronRight
} from '@tabler/icons-react';
import { useState } from 'react';
import {
  currentMonth,
  fromPickerValue,
  isCurrentMonth,
  monthKey,
  monthLabel,
  shiftMonth,
  toPickerValue,
  type YearMonth
} from '../months';

/**
 * Month selection bar. Future months cannot be selected.
 *
 * Layout follows the built-in InvenTree calendar header:
 * prev | month picker | next | month name ... actions
 */
export function MonthNavigator({
  value,
  onChange,
  locale
}: {
  value: YearMonth;
  onChange: (value: YearMonth) => void;
  locale: string;
}) {
  const [pickerOpened, setPickerOpened] = useState<boolean>(false);

  const atCurrentMonth = isCurrentMonth(value);

  const selectMonth = (picked: DateValue) => {
    const ym = fromPickerValue(picked);

    if (ym && monthKey(ym) <= monthKey(currentMonth())) {
      onChange(ym);
    }

    setPickerOpened(false);
  };

  return (
    <Paper withBorder p='sm'>
      <Group justify='space-between' gap='xs'>
        <Group gap={0} justify='left'>
          <ActionButton
            icon={<IconChevronLeft />}
            onClick={() => onChange(shiftMonth(value, -1))}
            tooltipAlignment='top'
            tooltip={t`Previous month`}
          />
          <Popover
            opened={pickerOpened}
            onClose={() => setPickerOpened(false)}
            position='bottom-start'
            shadow='md'
          >
            <Popover.Target>
              <Tooltip label={t`Select month`} position='top'>
                <Button
                  m={0}
                  variant='transparent'
                  aria-label='financial-reports-select-month'
                  onClick={() => setPickerOpened(!pickerOpened)}
                >
                  <IconCalendarMonth />
                </Button>
              </Tooltip>
            </Popover.Target>
            <Popover.Dropdown>
              <MonthPicker
                value={toPickerValue(value)}
                defaultDate={toPickerValue(value)}
                maxDate={toPickerValue(currentMonth())}
                onChange={selectMonth}
              />
            </Popover.Dropdown>
          </Popover>
          <ActionButton
            icon={<IconChevronRight />}
            onClick={() => onChange(shiftMonth(value, 1))}
            tooltipAlignment='top'
            tooltip={t`Next month`}
            disabled={atCurrentMonth}
          />
          <Space w='sm' />
          <StylishText size='lg'>{monthLabel(value, locale)}</StylishText>
        </Group>
        <Group gap='xs'>
          {atCurrentMonth && <Badge variant='light'>{t`Month to date`}</Badge>}
          <Button
            variant='default'
            size='xs'
            disabled={atCurrentMonth}
            onClick={() => onChange(currentMonth())}
          >
            {t`This month`}
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}
