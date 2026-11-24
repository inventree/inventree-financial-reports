import { Group, Stack, Text } from '@mantine/core';
import { IconArrowDownRight, IconArrowUpRight } from '@tabler/icons-react';

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
 * Headline figure for the selected month
 */
export function HeadlineStat({
  label,
  description,
  value,
  format
}: {
  label: string;
  description?: string;
  value: number;
  format: (value: number) => string;
}) {
  return (
    <Stack gap={2}>
      <Text size='sm' c='dimmed'>
        {label}
      </Text>
      <Text fz={32} fw={700} lh={1.1}>
        {format(value)}
      </Text>
      {description && (
        <Text size='xs' c='dimmed'>
          {description}
        </Text>
      )}
    </Stack>
  );
}

/**
 * Small stat block comparing the selected month against a reference value
 */
export function ComparisonStat({
  label,
  currentLabel,
  value,
  reference,
  format
}: {
  label: string;
  // Name for the selected period in the change text, e.g. "This month"
  currentLabel: string;
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
            {currentLabel} {change >= 0 ? '+' : ''}
            {change.toFixed(1)}%
          </Text>
        </Group>
      )}
    </Stack>
  );
}
