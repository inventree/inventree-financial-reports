# Financial Reports

An [InvenTree](https://inventree.org) plugin that adds monthly financial summaries for sales and purchasing.

Each report appears as a panel on the relevant InvenTree page and shows:

- The total value for a selected month, converted to your default currency
- Comparisons with the 12-month average, the previous month and the same month last year
- A 12-month bar chart
- Breakdowns by company and by part, as pie charts with value tables

## Reports

### Monthly Sales

Found on the **Sales** page, in the **Monthly Sales** panel.

Sales are counted **when goods ship**:

- Stock allocated to a sales order line counts on the date its shipment was shipped. Its value is the allocated quantity × sale price, less any line discount.
- Extra line items (freight, fees, etc.) count on the date the whole order was shipped.
- Partly shipped orders are split across the months in which each shipment went out.

Breakdowns are **Sales by Customer** and **Sales by Product**.

### Monthly Purchasing

Found on the **Purchasing** page, in the **Monthly Purchasing** panel.

Purchases are counted **when the order is placed**:

- Each purchase order line counts at its full value (quantity × purchase price, less any line discount) on the order's issue date.
- Extra line items count on the same date.
- Orders that have not been placed yet have no issue date, so they are not counted.

This shows the spend committed each month, not when goods arrived.

Breakdowns are **Purchases by Supplier** and **Purchases by Part**. Parts are grouped by the internal part, so a part bought from several suppliers appears once. Lines without a supplier part are grouped with extra line items.

### Rules for both reports

- **Cancelled orders are excluded.**
- **Currency:** all values are converted to the InvenTree default currency using the **current** exchange rates. InvenTree does not store historical rates, so past months from foreign-currency orders change slightly as rates move.
- **12-month average:** the average of the 12 complete months *before* the selected month. A partial current month does not pull it down.
- **Excluded values:** if anything was left out of the totals, a warning icon appears beside the headline figures. Hover over it to see why. There are two possible reasons:
  - a currency has no exchange rate
  - a line has no price

## Using the reports

- Use the arrows to step between months, or the calendar button to pick a month directly. Future months cannot be selected.
- Click a bar in the 12-month chart to jump to that month.
- Each pie chart shows the top 10 entries by default and groups the rest as "Other". Use the **10 / 20 / 50 / All** selector to show more. The first 10 slices have distinct colours; further slices are grey and can be identified by hovering or from the table.
- Click a customer, supplier or part name in a table to open its page.

## Installation

Requires InvenTree 1.0.0 or later.

### InvenTree Plugin Manager

In the InvenTree Admin Center, open **Plugins**, select **Install Plugin** and enter the package name `inventree-financial-reports`.

### Command line

```bash
pip install inventree-financial-reports
```

Then restart the InvenTree server.

### Enable the plugin

1. In **Admin Center → Plugin Settings**, enable:
   - **Enable URL integration**
   - **Enable interface integration**
2. In **Admin Center → Plugins**, activate **Financial Reports**.
3. Make sure currency exchange rates are set up (**Admin Center → Currencies**) if you trade in more than one currency.

## Access and configuration

Financial data is restricted:

- The **Monthly Sales** report requires the *view* permission for sales orders.
- The **Monthly Purchasing** report requires the *view* permission for purchase orders.

The plugin has one setting:

| Setting | Description |
| --- | --- |
| **Allowed Group** | If set, only members of this user group can see the reports, in addition to the permissions above. Leave blank to allow any user with the relevant order permission. |

The same checks apply to the panels and to the plugin's API endpoints.

## API

Each report has a read-only endpoint, which the panels use:

| Report | Endpoint |
| --- | --- |
| Monthly Sales | `GET /plugin/financial-reports/sales/monthly/` |
| Monthly Purchasing | `GET /plugin/financial-reports/purchasing/monthly/` |

Both accept optional `year` and `month` query parameters and default to the current month. Future months are rejected.

## Development

### Backend tests

Run from the InvenTree backend directory, with this plugin on the Python path:

```bash
cd src/backend/InvenTree
PYTHONPATH=/path/to/FinancialReports python manage.py test financial_reports.tests
```

### Frontend

The panels are built with React and Mantine, and are compiled into `financial_reports/static`:

```bash
cd frontend
npm install
npm run translate   # extract and compile translations
npm run build
npm run lint
```

Both panels are built from one shared layout (`frontend/src/MonthlyReportPanel.tsx`), and each report only supplies its own wording (`frontend/src/Panels.tsx`). To add another monthly report:

1. Add an aggregator subclass in `aggregation.py`.
2. Add a view subclass in `views.py`.
3. Add an entry to `MONTHLY_REPORTS` in `core.py`.
4. Add a render function in `Panels.tsx`.

## License

MIT
