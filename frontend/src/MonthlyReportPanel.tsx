import {
  formatCurrencyValue,
  getDetailUrl,
  type InvenTreePluginContext,
  ModelType
} from '@inventreedb/ui';
import { t } from '@lingui/core/macro';
import { LineChart } from '@mantine/charts';
import {
  Alert,
  Box,
  Group,
  LoadingOverlay,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title
} from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { BreakdownCard, type BreakdownRow } from './components/BreakdownCard';
import { ComparisonStat, HeadlineStat } from './components/ComparisonStat';
import { ExclusionWarning } from './components/ExclusionWarning';
import { MonthNavigator } from './components/MonthNavigator';
import {
  currentMonth,
  monthKey,
  monthLabel,
  parseMonthKey,
  shiftMonth,
  type YearMonth
} from './months';

/**
 * Response from a monthly report API endpoint (see views.MonthlyReportView)
 */
type MonthlyReportData = {
  currency: string;
  year: number;
  month: number;
  total: number;
  previous_month_total: number;
  last_year_total: number;
  average: number;
  history: { month: string; total: number }[];
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
  // Bar chart series name, e.g. "Sales"
  series: string;
  loadError: string;
  // Title of the exclusion warning
  excluded: string;
  // Description of rows without a price, including the count
  unpriced: (count: number) => string;
  companyTitle: string;
  partTitle: string;
  // Shown in the breakdowns when there is nothing for the month
  empty: string;
  // Breakdown labels for rows with no company / part
  noCompany: string;
  noPart: string;
};

/**
 * Monthly order value report: headline figures, 12 month history,
 * and breakdowns by company and by part for the selected month.
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

  const [selected, setSelected] = useState<YearMonth>(currentMonth());
  const [data, setData] = useState<MonthlyReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);

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

  const formatMoney = (value: number) =>
    `${formatCurrencyValue(value, {
      currency: data?.currency,
      locale: locale,
      digits: 0
    })}`;

  const chartData = useMemo(
    () =>
      data?.history.map((entry) => ({
        key: entry.month,
        label: monthLabel(parseMonthKey(entry.month), locale, true),
        total: entry.total
      })) ?? [],
    [data, locale]
  );

  const selectedKey = monthKey(selected);

  const selectedPoint = chartData.find((entry) => entry.key === selectedKey);

  const navigateTo = (model: ModelType) => (pk: number) => {
    context.navigate(getDetailUrl(model, pk));
  };

  return (
    <Stack gap='sm'>
      <MonthNavigator value={selected} onChange={setSelected} locale={locale} />

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
                    label={t`Monthly average (previous 12 months)`}
                    value={data.total}
                    reference={data.average}
                    format={formatMoney}
                  />
                  <ComparisonStat
                    label={monthLabel(shiftMonth(selected, -1), locale)}
                    value={data.total}
                    reference={data.previous_month_total}
                    format={formatMoney}
                  />
                  <ComparisonStat
                    label={monthLabel(shiftMonth(selected, -12), locale)}
                    value={data.total}
                    reference={data.last_year_total}
                    format={formatMoney}
                  />
                </SimpleGrid>
                <ExclusionWarning
                  title={labels.excluded}
                  missingRates={data.warnings.missing_rates}
                  unpricedCount={data.warnings.unpriced_lines}
                  unpricedText={labels.unpriced(data.warnings.unpriced_lines)}
                />
              </Group>
            </Paper>

            {/* 12 month history */}
            <Paper withBorder p='md'>
              <Stack gap='sm'>
                <Group justify='space-between'>
                  <Title order={5}>{t`Last 12 months`}</Title>
                  <Text size='xs' c='dimmed'>
                    {t`Click the chart to view that month`}
                  </Text>
                </Group>
                <LineChart
                  h={280}
                  data={chartData}
                  dataKey='label'
                  series={[
                    { name: 'total', label: labels.series, color: 'blue.6' }
                  ]}
                  curveType='linear'
                  strokeWidth={2}
                  dotProps={{ r: 4 }}
                  activeDotProps={{ r: 5 }}
                  valueFormatter={formatMoney}
                  gridAxis='y'
                  tickLine='none'
                  // Highlight the selected month
                  referenceDots={
                    selectedPoint
                      ? [
                          {
                            x: selectedPoint.label,
                            y: selectedPoint.total,
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
                      y: data.average,
                      color: 'gray.6',
                      label: t`12 month average`,
                      labelPosition: 'insideTopLeft',
                      strokeDasharray: '4 4'
                    }
                  ]}
                  // Clicking anywhere in a month's column selects that month
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

            {/* Breakdowns for the selected month */}
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing='sm'>
              <BreakdownCard
                title={labels.companyTitle}
                rows={data.by_company}
                total={data.total}
                format={formatMoney}
                emptyText={labels.empty}
                unlinkedLabel={labels.noCompany}
                onSelect={navigateTo(ModelType.company)}
              />
              <BreakdownCard
                title={labels.partTitle}
                rows={data.by_part}
                total={data.total}
                format={formatMoney}
                emptyText={labels.empty}
                unlinkedLabel={labels.noPart}
                onSelect={navigateTo(ModelType.part)}
              />
            </SimpleGrid>
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
