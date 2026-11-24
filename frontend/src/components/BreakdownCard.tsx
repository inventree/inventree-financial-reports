import { t } from '@lingui/core/macro';
import { PieChart } from '@mantine/charts';
import {
  Anchor,
  ColorSwatch,
  Divider,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
  Tooltip
} from '@mantine/core';
import { useMemo, useState } from 'react';

// Categorical palette for pie slices, in fixed order (validated for CVD
// separation in light and dark mode, including the last -> first wrap-around).
// Do not reorder without re-validating.
const SLICE_COLORS = [
  '#1c7ed6', // blue
  '#e8590c', // orange
  '#0ca678', // teal
  '#ae3ec9', // grape
  '#66a80f', // lime
  '#4263eb', // indigo
  '#e03131', // red
  '#1098ad', // cyan
  '#7048e8', // violet
  '#d6336c' // pink
];

// Slices beyond the palette are drawn in a neutral tone (identified by
// tooltip and table row), and the folded remainder is a darker neutral.
const TAIL_COLOR = 'gray.4';
const OTHER_COLOR = 'gray.6';

// Options for the number of items shown in each breakdown
const SLICE_LIMITS = ['10', '20', '50', 'all'];
const DEFAULT_SLICE_LIMIT = '10';

// Convert a Mantine theme color key (e.g. 'gray.6') to a CSS color
function cssColor(color: string): string {
  const match = /^(\w+)\.(\d+)$/.exec(color);
  return match ? `var(--mantine-color-${match[1]}-${match[2]})` : color;
}

export type BreakdownRow = {
  pk: number | null;
  name: string | null;
  IPN?: string | null;
  total: number;
};

/**
 * Pie chart with an accompanying table (the table carries names and values,
 * so identity is never conveyed by colour alone).
 *
 * Rows are expected sorted by total, descending.
 */
export function BreakdownCard({
  title,
  rows,
  total,
  format,
  emptyText,
  unlinkedLabel,
  onSelect
}: {
  title: string;
  rows: BreakdownRow[];
  total: number;
  format: (value: number) => string;
  // Shown when there are no rows
  emptyText: string;
  // Label for the row with no linked object (pk = null)
  unlinkedLabel: string;
  // Called when a linked row name is clicked
  onSelect?: (pk: number) => void;
}) {
  const [limit, setLimit] = useState<string>(DEFAULT_SLICE_LIMIT);

  const maxSlices = limit === 'all' ? rows.length : Number(limit);

  // Top N entries get their own slice, the remainder is folded into "Other"
  const slices = useMemo(() => {
    const top = rows.slice(0, maxSlices).map((row, index) => ({
      key: `${row.pk ?? 'none'}`,
      row: row as BreakdownRow | null,
      value: row.total,
      color: SLICE_COLORS[index] ?? TAIL_COLOR
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

  const sliceName = (row: BreakdownRow | null): string => {
    if (row === null) {
      return t`Other (${otherCount})`;
    }
    return row.pk ? `${row.name ?? '-'}` : unlinkedLabel;
  };

  const renderName = (row: BreakdownRow | null) => {
    if (row?.pk && onSelect) {
      const pk = row.pk;
      return (
        <Anchor size='sm' onClick={() => onSelect(pk)}>
          {row.name}
        </Anchor>
      );
    }

    return (
      <Text size='sm' c={row?.pk ? undefined : 'dimmed'}>
        {sliceName(row)}
      </Text>
    );
  };

  return (
    <Paper withBorder p='md'>
      <Stack gap='sm'>
        <Group justify='space-between' gap='xs'>
          <Title order={5}>{title}</Title>
          <Tooltip label={t`Number of items to show`} position='top'>
            <SegmentedControl
              size='xs'
              value={limit}
              onChange={setLimit}
              data={SLICE_LIMITS.map((value) => ({
                value: value,
                label: value === 'all' ? t`All` : value
              }))}
            />
          </Tooltip>
        </Group>
        <Divider />
        {slices.length === 0 ? (
          <Text c='dimmed' size='sm'>
            {emptyText}
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
                name: sliceName(slice.row),
                value: slice.value,
                color: slice.color
              }))}
            />
            <ScrollArea.Autosize mah={400} style={{ flex: 1, minWidth: 260 }}>
              <Table verticalSpacing={4} highlightOnHover>
                <Table.Tbody>
                  {slices.map((slice) => (
                    <Table.Tr key={slice.key}>
                      <Table.Td w={20}>
                        <ColorSwatch
                          color={cssColor(slice.color)}
                          size={12}
                          withShadow={false}
                        />
                      </Table.Td>
                      <Table.Td>{renderName(slice.row)}</Table.Td>
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
            </ScrollArea.Autosize>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}
