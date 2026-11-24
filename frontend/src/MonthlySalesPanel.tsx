import {
  ActionButton,
  checkPluginVersion,
  formatCurrencyValue,
  getDetailUrl,
  type InvenTreePluginContext,
  LocalizedComponent,
  ModelType,
  StylishText
} from '@inventreedb/ui';
import { t } from '@lingui/core/macro';
import { BarChart, PieChart } from '@mantine/charts';
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  ColorSwatch,
  Divider,
  Group,
  LoadingOverlay,
  Paper,
  Popover,
  SimpleGrid,
  Space,
  Stack,
  Table,
  Text,
  Title,
  Tooltip
} from '@mantine/core';
import { type DateValue, MonthPicker } from '@mantine/dates';
import {
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowUpRight,
  IconCalendarMonth,
  IconChevronLeft,
  IconChevronRight
} from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { loadLocale } from './locales';

// Categorical palette for pie slices, in fixed order (validated for CVD
// separation in light and dark mode). Remaining entries fold into "Other".
const SLICE_COLORS = [
  '#1c7ed6', // blue
  '#e8590c', // orange
  '#0ca678', // teal
  '#ae3ec9', // grape
  '#66a80f', // lime
  '#4263eb', // indigo
  '#e03131' // red
];
const OTHER_COLOR = 'gray.6';

type BreakdownRow = {
  pk: number | null;
  name: string | null;
  IPN?: string | null;
  total: number;
};

type MonthlySalesData = {
  currency: string;
  year: number;
  month: number;
  total: number;
  previous_month_total: number;
  last_year_total: number;
  average: number;
  history: { month: string; total: number }[];
  by_customer: BreakdownRow[];
  by_part: BreakdownRow[];
  warnings: {
    missing_rates: string[];
    unpriced_allocations: number;
  };
};

type YearMonth = { year: number; month: number };

function currentMonth(): YearMonth {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function shiftMonth(ym: YearMonth, offset: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + offset;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function monthKey(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, '0')}`;
}

function parseMonthKey(key: string): YearMonth {
  const [year, month] = key.split('-').map(Number);
  return { year, month };
}

// Mantine date pickers use 'YYYY-MM-DD' strings
function toPickerValue(ym: YearMonth): string {
  return `${monthKey(ym)}-01`;
}

// Parse the picker value without going via Date, which would apply a UTC
// offset to 'YYYY-MM-DD' strings and could shift the month
function fromPickerValue(value: DateValue | Date): YearMonth | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return { year: value.getFullYear(), month: value.getMonth() + 1 };
  }

  const match = /^(\d{4})-(\d{2})/.exec(value);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

/**
 * Percentage change from a reference value, or null if not meaningful
 */
function percentChange(value: number, reference: number): number | null {
  if (!reference) {
    return null;
  }
  return ((value - reference) / reference) * 100;
}

/**
 * Small stat block comparing the selected month against a reference value
 */
function ComparisonStat({
  label,
  value,
  reference,
  format
}: {
  label: string;
  value: number;
  reference: number;
  format: (value: number) => string;
}) {
  const change = percentChange(value, reference);

  return (
    <Stack gap={2}>
      <Text size='sm' c='dimmed'>
        {label}
      </Text>
      <Text size='lg' fw={500}>
        {format(reference)}
      </Text>
      {change !== null && (
        <Group gap={4}>
          {change >= 0 ? (
            <IconArrowUpRight size={16} />
          ) : (
            <IconArrowDownRight size={16} />
          )}
          <Text size='sm'>
            {t`This month`} {change >= 0 ? '+' : ''}
            {change.toFixed(1)}%
          </Text>
        </Group>
      )}
    </Stack>
  );
}

/**
 * Pie chart with an accompanying table (the table carries names and values,
 * so identity is never conveyed by colour alone)
 */
function BreakdownCard({
  title,
  rows,
  total,
  maxSlices,
  format,
  renderName
}: {
  title: string;
  rows: BreakdownRow[];
  total: number;
  maxSlices: number;
  format: (value: number) => string;
  renderName: (row: BreakdownRow) => React.ReactNode;
}) {
  // Top N entries get their own slice, the remainder is folded into "Other"
  const slices = useMemo(() => {
    const top = rows.slice(0, maxSlices).map((row, index) => ({
      key: `${row.pk ?? 'none'}`,
      row: row as BreakdownRow | null,
      value: row.total,
      color: SLICE_COLORS[index]
    }));

    const rest = rows.slice(maxSlices);

    if (rest.length > 0) {
      top.push({
        key: 'other',
        row: null,
        value: rest.reduce((sum, row) => sum + row.total, 0),
        color: OTHER_COLOR
      });
    }

    return top.map((slice) => ({
      ...slice,
      percent: total ? (slice.value / total) * 100 : 0
    }));
  }, [rows, total, maxSlices]);

  const otherCount = Math.max(0, rows.length - maxSlices);

  return (
    <Paper withBorder p='md'>
      <Stack gap='sm'>
        <Title order={5}>{title}</Title>
        <Divider />
        {slices.length === 0 ? (
          <Text c='dimmed' size='sm'>
            {t`No sales this month`}
          </Text>
        ) : (
          <Group align='flex-start' wrap='wrap' gap='lg'>
            <PieChart
              size={180}
              strokeWidth={2}
              withTooltip
              tooltipDataSource='segment'
              valueFormatter={format}
              data={slices.map((slice) => ({
                name:
                  slice.row === null
                    ? t`Other (${otherCount})`
                    : `${slice.row.name ?? '-'}`,
                value: slice.value,
                color: slice.color
              }))}
            />
            <Table
              style={{ flex: 1, minWidth: 260 }}
              verticalSpacing={4}
              highlightOnHover
            >
              <Table.Tbody>
                {slices.map((slice) => (
                  <Table.Tr key={slice.key}>
                    <Table.Td w={20}>
                      <ColorSwatch
                        color={
                          slice.color === OTHER_COLOR
                            ? 'var(--mantine-color-gray-6)'
                            : slice.color
                        }
                        size={12}
                        withShadow={false}
                      />
                    </Table.Td>
                    <Table.Td>
                      {slice.row === null ? (
                        <Text size='sm' c='dimmed'>
                          {t`Other (${otherCount})`}
                        </Text>
                      ) : (
                        renderName(slice.row)
                      )}
                    </Table.Td>
                    <Table.Td ta='right'>
                      <Text size='sm'>{format(slice.value)}</Text>
                    </Table.Td>
                    <Table.Td ta='right' w={60}>
                      <Text size='sm' c='dimmed'>
                        {slice.percent.toFixed(1)}%
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

function MonthlySalesPanel({ context }: { context: InvenTreePluginContext }) {
  const apiUrl: string = context.context?.api_url;

  const [selected, setSelected] = useState<YearMonth>(currentMonth());
  const [data, setData] = useState<MonthlySalesData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);

  const [monthPickerOpened, setMonthPickerOpened] = useState<boolean>(false);

  const isCurrentMonth = monthKey(selected) === monthKey(currentMonth());

  // Callback for the month picker (future months are disabled via maxDate)
  const selectMonth = (value: DateValue) => {
    const ym = fromPickerValue(value);

    if (ym && monthKey(ym) <= monthKey(currentMonth())) {
      setSelected(ym);
    }

    setMonthPickerOpened(false);
  };

  // Fetch report data whenever the selected month changes
  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(false);

    context.api
      .get(apiUrl, { params: { year: selected.year, month: selected.month } })
      .then((response) => {
        if (!cancelled) {
          setData(response.data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiUrl, context.api, selected]);

  const currency = data?.currency;

  const formatMoney = (value: number) =>
    `${formatCurrencyValue(value, {
      currency: currency,
      locale: context.locale,
      digits: 0
    })}`;

  const monthLabel = (ym: YearMonth, short = false) =>
    new Date(ym.year, ym.month - 1, 1).toLocaleDateString(context.locale, {
      month: short ? 'short' : 'long',
      year: short ? '2-digit' : 'numeric'
    });

  const chartData = useMemo(
    () =>
      data?.history.map((entry) => ({
        key: entry.month,
        label: monthLabel(parseMonthKey(entry.month), true),
        total: entry.total
      })) ?? [],
    [data, context.locale]
  );

  const selectedKey = monthKey(selected);

  const navigateTo = (model: ModelType, pk: number) => {
    context.navigate(getDetailUrl(model, pk));
  };

  const warnings = data?.warnings;
  const hasWarnings =
    !!warnings &&
    (warnings.missing_rates.length > 0 || warnings.unpriced_allocations > 0);

  return (
    <Stack gap='sm'>
      {/* Month navigation */}
      {/* Layout follows the built-in InvenTree calendar header:
          prev | month picker | next | month name ... actions */}
      <Paper withBorder p='sm'>
        <Group justify='space-between' gap='xs'>
          <Group gap={0} justify='left'>
            <ActionButton
              icon={<IconChevronLeft />}
              onClick={() => setSelected(shiftMonth(selected, -1))}
              tooltipAlignment='top'
              tooltip={t`Previous month`}
            />
            <Popover
              opened={monthPickerOpened}
              onClose={() => setMonthPickerOpened(false)}
              position='bottom-start'
              shadow='md'
            >
              <Popover.Target>
                <Tooltip label={t`Select month`} position='top'>
                  <Button
                    m={0}
                    variant='transparent'
                    aria-label='financial-reports-select-month'
                    onClick={() => setMonthPickerOpened(!monthPickerOpened)}
                  >
                    <IconCalendarMonth />
                  </Button>
                </Tooltip>
              </Popover.Target>
              <Popover.Dropdown>
                <MonthPicker
                  value={toPickerValue(selected)}
                  defaultDate={toPickerValue(selected)}
                  maxDate={toPickerValue(currentMonth())}
                  onChange={selectMonth}
                />
              </Popover.Dropdown>
            </Popover>
            <ActionButton
              icon={<IconChevronRight />}
              onClick={() => setSelected(shiftMonth(selected, 1))}
              tooltipAlignment='top'
              tooltip={t`Next month`}
              disabled={isCurrentMonth}
            />
            <Space w='sm' />
            <StylishText size='lg'>{monthLabel(selected)}</StylishText>
          </Group>
          <Group gap='xs'>
            {isCurrentMonth && (
              <Badge variant='light'>{t`Month to date`}</Badge>
            )}
            <Button
              variant='default'
              size='xs'
              disabled={isCurrentMonth}
              onClick={() => setSelected(currentMonth())}
            >
              {t`This month`}
            </Button>
          </Group>
        </Group>
      </Paper>

      <Box pos='relative' mih={200}>
        <LoadingOverlay visible={loading} />

        {error && (
          <Alert color='red' title={t`Error`}>
            {t`Failed to load sales data from the server`}
          </Alert>
        )}

        {data && (
          <Stack gap='sm'>
            {hasWarnings && (
              <Alert
                color='yellow'
                icon={<IconAlertTriangle />}
                title={t`Some sales are excluded from these totals`}
              >
                {warnings.missing_rates.length > 0 && (
                  <Text size='sm'>
                    {t`No exchange rate available for: ${warnings.missing_rates.join(', ')}`}
                  </Text>
                )}
                {warnings.unpriced_allocations > 0 && (
                  <Text size='sm'>
                    {t`Shipped items without a sale price this month: ${warnings.unpriced_allocations}`}
                  </Text>
                )}
              </Alert>
            )}

            {/* Headline figures */}
            <Paper withBorder p='md'>
              <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing='lg'>
                <Stack gap={2}>
                  <Text size='sm' c='dimmed'>
                    {t`Total sales`} ({data.currency})
                  </Text>
                  <Text fz={32} fw={700} lh={1.1}>
                    {formatMoney(data.total)}
                  </Text>
                </Stack>
                <ComparisonStat
                  label={t`Monthly average (previous 12 months)`}
                  value={data.total}
                  reference={data.average}
                  format={formatMoney}
                />
                <ComparisonStat
                  label={monthLabel(shiftMonth(selected, -1))}
                  value={data.total}
                  reference={data.previous_month_total}
                  format={formatMoney}
                />
                <ComparisonStat
                  label={monthLabel(shiftMonth(selected, -12))}
                  value={data.total}
                  reference={data.last_year_total}
                  format={formatMoney}
                />
              </SimpleGrid>
            </Paper>

            {/* 12 month history */}
            <Paper withBorder p='md'>
              <Stack gap='sm'>
                <Group justify='space-between'>
                  <Title order={5}>{t`Last 12 months`}</Title>
                  <Text size='xs' c='dimmed'>
                    {t`Click a bar to view that month`}
                  </Text>
                </Group>
                <BarChart
                  h={280}
                  data={chartData}
                  dataKey='label'
                  series={[{ name: 'total', label: t`Sales`, color: 'blue.6' }]}
                  getBarColor={(_value, entry: any) =>
                    entry?.key === selectedKey ? 'blue.7' : 'blue.3'
                  }
                  valueFormatter={formatMoney}
                  gridAxis='y'
                  tickLine='none'
                  maxBarWidth={40}
                  referenceLines={[
                    {
                      y: data.average,
                      color: 'gray.6',
                      label: t`12 month average`,
                      labelPosition: 'insideTopLeft',
                      strokeDasharray: '4 4'
                    }
                  ]}
                  barProps={{
                    radius: [4, 4, 0, 0],
                    cursor: 'pointer',
                    onClick: (entry: any) => {
                      const key = entry?.payload?.key ?? entry?.key;
                      if (key) {
                        setSelected(parseMonthKey(key));
                      }
                    }
                  }}
                />
              </Stack>
            </Paper>

            {/* Breakdowns for the selected month */}
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing='sm'>
              <BreakdownCard
                title={t`Sales by Customer`}
                rows={data.by_customer}
                total={data.total}
                maxSlices={SLICE_COLORS.length}
                format={formatMoney}
                renderName={(row) =>
                  row.pk ? (
                    <Anchor
                      size='sm'
                      onClick={() => navigateTo(ModelType.company, row.pk!)}
                    >
                      {row.name}
                    </Anchor>
                  ) : (
                    <Text size='sm' c='dimmed'>
                      {t`No customer`}
                    </Text>
                  )
                }
              />
              <BreakdownCard
                title={t`Sales by Product`}
                rows={data.by_part}
                total={data.total}
                maxSlices={SLICE_COLORS.length}
                format={formatMoney}
                renderName={(row) =>
                  row.pk ? (
                    <Anchor
                      size='sm'
                      onClick={() => navigateTo(ModelType.part, row.pk!)}
                    >
                      {row.name}
                    </Anchor>
                  ) : (
                    <Text size='sm' c='dimmed'>
                      {t`Extra line items`}
                    </Text>
                  )
                }
              />
            </SimpleGrid>
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

// Entry point called by InvenTree to render the panel
export function RenderMonthlySalesPanel(context: InvenTreePluginContext) {
  checkPluginVersion(context);

  return (
    <LocalizedComponent
      i18n={context.i18n}
      locale={context.locale}
      loadLocale={loadLocale}
    >
      <MonthlySalesPanel context={context} />
    </LocalizedComponent>
  );
}
