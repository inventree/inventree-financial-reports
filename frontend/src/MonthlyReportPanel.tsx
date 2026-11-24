import {
  formatCurrencyValue,
  getDetailUrl,
  type InvenTreePluginContext,
  ModelType,
  navigateToLink
} from '@inventreedb/ui';
import { t } from '@lingui/core/macro';
import { LineChart } from '@mantine/charts';
import {
  Alert,
  Box,
  Group,
  LoadingOverlay,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title
} from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { BreakdownCard, type BreakdownRow } from './components/BreakdownCard';
import { ComparisonStat, HeadlineStat } from './components/ComparisonStat';
import { ExclusionWarning } from './components/ExclusionWarning';
import { PeriodNavigator } from './components/PeriodNavigator';
import {
  currentMonth,
  DEFAULT_PERIOD,
  monthKey,
  type Period,
  parseMonthKey,
  periodLabel,
  periodStart,
  shiftMonth,
  shiftPeriod,
  type YearMonth
} from './periods';

/**
 * Response from a report API endpoint (see views.MonthlyReportView)
 */
type MonthlyReportData = {
  currency: string;
  period: Period;
  // First month of the reported period
  year: number;
  month: number;
  total: number;
  previous_total: number;
  // Null for yearly reports (it would equal previous_total)
  last_year_total: number | null;
  average: number;
  // Number of preceding periods in the average
  average_periods: number;
  // Average number of orders in the preceding periods
  average_orders: number;
  // Each period is identified by its first month ('YYYY-MM')
  history: { start: string; total: number; orders: number }[];
  by_company: BreakdownRow[];
  by_part: BreakdownRow[];
  warnings: {
    missing_rates: string[];
    unpriced_lines: number;
  };
};

/**
 * Report-specific text. Build this inside a component (not at module level)
 * so that translations use the active locale.
 */
export type MonthlyReportLabels = {
  // Headline figure, e.g. "Total sales"
  total: string;
  // What the totals represent, e.g. "Value of goods shipped"
  basis: string;
  // Chart series name for the value, e.g. "Sales"
  series: string;
  // Chart series name for the order count, e.g. "Orders shipped"
  orders: string;
  loadError: string;
  // Title of the exclusion warning
  excluded: string;
  // Description of rows without a price, including the count
  unpriced: (count: number) => string;
  companyTitle: string;
  partTitle: string;
  // Shown in the breakdowns when there is nothing for the period
  empty: string;
  // Breakdown labels for rows with no company / part
  noCompany: string;
  noPart: string;
};

// Values which can be shown in the history chart (keys of the chart data)
type ChartMetric = 'total' | 'orders';

/**
 * Period-specific text for the report body
 */
function periodText(period: Period, count: number) {
  switch (period) {
    case 'quarter':
      return {
        current: t`This quarter`,
        average: t`Quarterly average (previous ${count} quarters)`,
        history: t`Last ${count} quarters`,
        click: t`Click the chart to view that quarter`
      };
    case 'year':
      return {
        current: t`This year`,
        average: t`Yearly average (previous ${count} years)`,
        history: t`Last ${count} years`,
        click: t`Click the chart to view that year`
      };
    default:
      return {
        current: t`This month`,
        average: t`Monthly average (previous ${count} months)`,
        history: t`Last ${count} months`,
        click: t`Click the chart to view that month`
      };
  }
}

/**
 * Order value report for a month, quarter or year: headline figures,
 * history chart, and breakdowns by company and by part.
 */
export function MonthlyReportPanel({
  context,
  labels
}: {
  context: InvenTreePluginContext;
  labels: MonthlyReportLabels;
}) {
  const apiUrl: string = context.context?.api_url;
  const locale = context.locale;

  // Selected month - the report covers the period which contains it
  const [selected, setSelected] = useState<YearMonth>(currentMonth());
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);

  // What the history chart displays
  const [chartMetric, setChartMetric] = useState<ChartMetric>('total');
  const [data, setData] = useState<MonthlyReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);

  // Fetch report data whenever the selected period changes
  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(false);

    context.api
      .get(apiUrl, {
        params: { period: period, year: selected.year, month: selected.month }
      })
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
  }, [apiUrl, context.api, selected, period]);

  const formatMoney = (value: number) =>
    `${formatCurrencyValue(value, {
      currency: data?.currency,
      locale: locale,
      digits: 0
    })}`;

  const showOrders = chartMetric === 'orders';

  // Order counts are whole numbers (averages may not be)
  const formatCount = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);

  // Describe the data with the period it was fetched for (the selection may
  // already have changed while the next report loads)
  const dataPeriod: Period = data?.period ?? period;
  const dataStart: YearMonth = data
    ? { year: data.year, month: data.month }
    : periodStart(selected, period);

  const text = periodText(dataPeriod, data?.average_periods ?? 0);

  const chartData = useMemo(
    () =>
      data?.history.map((entry) => ({
        key: entry.start,
        label: periodLabel(
          parseMonthKey(entry.start),
          data.period,
          locale,
          true
        ),
        total: entry.total,
        orders: entry.orders
      })) ?? [],
    [data, locale]
  );

  const selectedKey = monthKey(dataStart);

  const selectedPoint = chartData.find((entry) => entry.key === selectedKey);

  // Absolute URL (including the frontend base path), for anchor hrefs
  const detailUrl = (model: ModelType) => (pk: number) =>
    getDetailUrl(model, pk, true);

  // Navigate within the app, or open a new tab for modified clicks
  const onLinkClick = (url: string, event: React.MouseEvent) =>
    navigateToLink(url, context.navigate, event);

  return (
    <Stack gap='sm'>
      <PeriodNavigator
        value={selected}
        period={period}
        onChange={setSelected}
        // The selected month is kept, so switching shows the period which
        // contains it (e.g. June 2025 -> Q2 2025 -> 2025)
        onPeriodChange={setPeriod}
        locale={locale}
      />

      <Box pos='relative' mih={200}>
        <LoadingOverlay visible={loading} />

        {error && (
          <Alert color='red' title={t`Error`}>
            {labels.loadError}
          </Alert>
        )}

        {data && (
          <Stack gap='sm'>
            {/* Headline figures */}
            <Paper withBorder p='md'>
              <Group align='flex-start' wrap='nowrap' gap='sm'>
                <SimpleGrid
                  cols={{ base: 1, sm: 2, md: 4 }}
                  spacing='lg'
                  style={{ flex: 1 }}
                >
                  <HeadlineStat
                    label={`${labels.total} (${data.currency})`}
                    description={labels.basis}
                    value={data.total}
                    format={formatMoney}
                  />
                  <ComparisonStat
                    label={text.average}
                    currentLabel={text.current}
                    value={data.total}
                    reference={data.average}
                    format={formatMoney}
                  />
                  <ComparisonStat
                    label={periodLabel(
                      shiftPeriod(dataStart, dataPeriod, -1),
                      dataPeriod,
                      locale
                    )}
                    currentLabel={text.current}
                    value={data.total}
                    reference={data.previous_total}
                    format={formatMoney}
                  />
                  {data.last_year_total !== null && (
                    <ComparisonStat
                      label={periodLabel(
                        shiftMonth(dataStart, -12),
                        dataPeriod,
                        locale
                      )}
                      currentLabel={text.current}
                      value={data.total}
                      reference={data.last_year_total}
                      format={formatMoney}
                    />
                  )}
                </SimpleGrid>
                <ExclusionWarning
                  title={labels.excluded}
                  missingRates={data.warnings.missing_rates}
                  unpricedCount={data.warnings.unpriced_lines}
                  unpricedText={labels.unpriced(data.warnings.unpriced_lines)}
                />
              </Group>
            </Paper>

            {/* History of recent periods */}
            <Paper withBorder p='md'>
              <Stack gap='sm'>
                <Group justify='space-between'>
                  <Title order={5}>{text.history}</Title>
                  <Group gap='sm'>
                    <Text size='xs' c='dimmed'>
                      {text.click}
                    </Text>
                    <SegmentedControl
                      size='xs'
                      value={chartMetric}
                      onChange={(value) => setChartMetric(value as ChartMetric)}
                      data={[
                        { value: 'total', label: t`Value` },
                        { value: 'orders', label: t`Orders` }
                      ]}
                    />
                  </Group>
                </Group>
                <LineChart
                  h={280}
                  data={chartData}
                  dataKey='label'
                  series={[
                    {
                      name: chartMetric,
                      label: showOrders ? labels.orders : labels.series,
                      color: 'blue.6'
                    }
                  ]}
                  curveType='linear'
                  strokeWidth={2}
                  dotProps={{ r: 4 }}
                  activeDotProps={{ r: 5 }}
                  valueFormatter={showOrders ? formatCount : formatMoney}
                  yAxisProps={{ allowDecimals: !showOrders }}
                  gridAxis='y'
                  tickLine='none'
                  // Highlight the selected period
                  referenceDots={
                    selectedPoint
                      ? [
                          {
                            x: selectedPoint.label,
                            y: selectedPoint[chartMetric],
                            r: 7,
                            color: 'blue.8',
                            stroke: 'var(--mantine-color-body)',
                            strokeWidth: 2,
                            ifOverflow: 'extendDomain'
                          }
                        ]
                      : []
                  }
                  referenceLines={[
                    {
                      y: showOrders ? data.average_orders : data.average,
                      color: 'gray.6',
                      label: t`Average`,
                      labelPosition: 'insideTopLeft',
                      strokeDasharray: '4 4'
                    }
                  ]}
                  // Clicking anywhere in a period's column selects that period
                  lineChartProps={{
                    style: { cursor: 'pointer' },
                    onClick: (state) => {
                      const index = Number(state?.activeIndex);
                      const key = chartData[index]?.key;
                      if (key) {
                        setSelected(parseMonthKey(key));
                      }
                    }
                  }}
                />
              </Stack>
            </Paper>

            {/* Breakdowns for the selected period */}
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing='sm'>
              <BreakdownCard
                title={labels.companyTitle}
                rows={data.by_company}
                total={data.total}
                format={formatMoney}
                emptyText={labels.empty}
                unlinkedLabel={labels.noCompany}
                getLink={detailUrl(ModelType.company)}
                onLinkClick={onLinkClick}
              />
              <BreakdownCard
                title={labels.partTitle}
                rows={data.by_part}
                total={data.total}
                format={formatMoney}
                emptyText={labels.empty}
                unlinkedLabel={labels.noPart}
                getLink={detailUrl(ModelType.part)}
                onLinkClick={onLinkClick}
              />
            </SimpleGrid>
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
