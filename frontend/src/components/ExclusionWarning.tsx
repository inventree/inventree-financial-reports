import { t } from '@lingui/core/macro';
import {
  ActionIcon,
  Alert,
  Badge,
  Group,
  HoverCard,
  Stack,
  Text
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCurrencyDollarOff,
  IconTagOff
} from '@tabler/icons-react';

/**
 * Warning icon with a hover card, listing why some value is excluded from
 * the report totals. Renders nothing if there is nothing to report.
 */
export function ExclusionWarning({
  title,
  missingRates,
  unpricedCount,
  unpricedText
}: {
  title: string;
  // Currency codes with no exchange rate
  missingRates: string[];
  // Number of rows with no price
  unpricedCount: number;
  // Description of the unpriced rows (including the count)
  unpricedText: string;
}) {
  if (missingRates.length === 0 && unpricedCount === 0) {
    return null;
  }

  return (
    <HoverCard
      position='left-start'
      width={360}
      shadow='md'
      withArrow
      events={{ hover: true, focus: true, touch: true }}
    >
      <HoverCard.Target>
        <ActionIcon variant='transparent' color='yellow' aria-label={title}>
          <IconAlertTriangle />
        </ActionIcon>
      </HoverCard.Target>
      <HoverCard.Dropdown p={0}>
        <Alert
          variant='light'
          color='yellow'
          icon={<IconAlertTriangle />}
          title={title}
        >
          <Stack gap='xs'>
            {missingRates.length > 0 && (
              <Group gap='xs' wrap='nowrap' align='flex-start'>
                <IconCurrencyDollarOff size={18} style={{ flexShrink: 0 }} />
                <Stack gap={4}>
                  <Text size='sm'>{t`No exchange rate available for:`}</Text>
                  <Group gap={4}>
                    {missingRates.map((code) => (
                      <Badge
                        key={code}
                        size='sm'
                        variant='outline'
                        color='yellow'
                      >
                        {code}
                      </Badge>
                    ))}
                  </Group>
                </Stack>
              </Group>
            )}
            {unpricedCount > 0 && (
              <Group gap='xs' wrap='nowrap' align='flex-start'>
                <IconTagOff size={18} style={{ flexShrink: 0 }} />
                <Text size='sm'>{unpricedText}</Text>
              </Group>
            )}
          </Stack>
        </Alert>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}
