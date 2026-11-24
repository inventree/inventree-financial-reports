/**
 * Entry points for the panels provided by this plugin.
 * Each report reuses MonthlyReportPanel, supplying its own text.
 */
import {
  checkPluginVersion,
  type InvenTreePluginContext,
  LocalizedComponent
} from '@inventreedb/ui';
import { t } from '@lingui/core/macro';
import { loadLocale } from './locales';
import {
  type MonthlyReportLabels,
  MonthlyReportPanel
} from './MonthlyReportPanel';

function MonthlySalesReport({ context }: { context: InvenTreePluginContext }) {
  const labels: MonthlyReportLabels = {
    total: t`Total sales`,
    basis: t`Value of goods shipped`,
    series: t`Sales`,
    loadError: t`Failed to load sales data from the server`,
    excluded: t`Some sales are excluded from these totals`,
    unpriced: (count) =>
      t`Shipped items without a sale price this month: ${count}`,
    companyTitle: t`Sales by Customer`,
    partTitle: t`Sales by Product`,
    empty: t`No sales this month`,
    noCompany: t`No customer`,
    noPart: t`Extra line items`
  };

  return <MonthlyReportPanel context={context} labels={labels} />;
}

function MonthlyPurchasingReport({
  context
}: {
  context: InvenTreePluginContext;
}) {
  const labels: MonthlyReportLabels = {
    total: t`Total purchases`,
    basis: t`Value of orders placed`,
    series: t`Purchases`,
    loadError: t`Failed to load purchasing data from the server`,
    excluded: t`Some purchases are excluded from these totals`,
    unpriced: (count) =>
      t`Order lines without a purchase price this month: ${count}`,
    companyTitle: t`Purchases by Supplier`,
    partTitle: t`Purchases by Part`,
    empty: t`No purchases this month`,
    noCompany: t`No supplier`,
    noPart: t`Extra or unlinked line items`
  };

  return <MonthlyReportPanel context={context} labels={labels} />;
}

// Wrap a panel with plugin version check and localisation
function renderPanel(
  context: InvenTreePluginContext,
  Panel: (props: { context: InvenTreePluginContext }) => React.ReactNode
) {
  checkPluginVersion(context);

  return (
    <LocalizedComponent
      i18n={context.i18n}
      locale={context.locale}
      loadLocale={loadLocale}
    >
      <Panel context={context} />
    </LocalizedComponent>
  );
}

// Entry points called by InvenTree (see FinancialReports.MONTHLY_REPORTS)
export function RenderMonthlySalesPanel(context: InvenTreePluginContext) {
  return renderPanel(context, MonthlySalesReport);
}

export function RenderMonthlyPurchasingPanel(context: InvenTreePluginContext) {
  return renderPanel(context, MonthlyPurchasingReport);
}
