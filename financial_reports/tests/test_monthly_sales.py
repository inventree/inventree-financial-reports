"""Unit tests for the monthly sales report.

Run from the InvenTree backend directory, with this plugin on the PYTHONPATH:

    PYTHONPATH=/path/to/FinancialReports python manage.py test financial_reports.tests
"""

import datetime
from decimal import Decimal
from types import SimpleNamespace

from djmoney.money import Money
from rest_framework.test import APIRequestFactory, force_authenticate

from common.models import InvenTreeSetting
from company.models import Company
from InvenTree.unit_test import InvenTreeTestCase
from order.models import (
    SalesOrder,
    SalesOrderAllocation,
    SalesOrderExtraLine,
    SalesOrderLineItem,
    SalesOrderShipment,
)
from order.status_codes import SalesOrderStatus
from part.models import Part
from stock.models import StockItem

from financial_reports import aggregation as sales
from financial_reports.views import MonthlySalesView


D = datetime.date


class MonthlySalesTest(InvenTreeTestCase):
    """Tests for shipped-basis sales aggregation (June 2025 is the reference month)."""

    roles = ["sales_order.view"]

    @classmethod
    def setUpTestData(cls):
        """Create a set of orders exercising the various edge cases."""
        super().setUpTestData()

        InvenTreeSetting.set_setting("INVENTREE_DEFAULT_CURRENCY", "USD", None)

        cls.cust_a = Company.objects.create(name="Customer A", is_customer=True)
        cls.cust_b = Company.objects.create(name="Customer B", is_customer=True)

        cls.p1 = Part.objects.create(name="P1", description="Part 1", salable=True)
        cls.p2 = Part.objects.create(name="P2", description="Part 2", salable=True)

        cls.stock = {
            cls.p1.pk: StockItem.objects.create(part=cls.p1, quantity=1000),
            cls.p2.pk: StockItem.objects.create(part=cls.p2, quantity=1000),
        }

        cls.counter = 0

        # Order 1 (USD, A): 10 x $20 @ 10% discount, partially shipped
        o1 = cls.make_order(cls.cust_a, "USD", shipment_date=D(2025, 6, 20))
        line = cls.make_line(o1, cls.p1, 10, Money(20, "USD"), discount=10)
        cls.ship(line, 5, D(2025, 6, 15))  # 5 x 20 x 0.9 = 90 (June)
        cls.ship(line, 3, D(2025, 5, 10))  # 3 x 20 x 0.9 = 54 (May)
        cls.ship(line, 2, None)  # not yet shipped - excluded
        # Extra line counted on the order's shipment date: $25 (June)
        SalesOrderExtraLine.objects.create(
            order=o1, quantity=1, price=Money(25, "USD"), reference="Freight"
        )

        # Order 2 (AUD, B): 4 x AUD 30 = AUD 120 = USD 80 (June)
        o2 = cls.make_order(cls.cust_b, "AUD")
        line = cls.make_line(o2, cls.p2, 4, Money(30, "AUD"))
        cls.ship(line, 4, D(2025, 6, 1))

        # Order 3 (cancelled): excluded
        o3 = cls.make_order(cls.cust_a, "USD", status=SalesOrderStatus.CANCELLED.value)
        line = cls.make_line(o3, cls.p1, 1, Money(1000, "USD"))
        cls.ship(line, 1, D(2025, 6, 2))

        # Order 4: no sale price - excluded, but reported
        o4 = cls.make_order(cls.cust_b, "USD")
        line = cls.make_line(o4, cls.p2, 1, None)
        cls.ship(line, 1, D(2025, 6, 2))

        # Order 5: no exchange rate for JPY - excluded, but reported
        o5 = cls.make_order(cls.cust_a, "JPY")
        line = cls.make_line(o5, cls.p1, 1, Money(1000, "JPY"))
        cls.ship(line, 1, D(2025, 6, 3))

        # Order 6: one year earlier - $100 (June 2024)
        o6 = cls.make_order(cls.cust_a, "USD")
        line = cls.make_line(o6, cls.p1, 1, Money(100, "USD"))
        cls.ship(line, 1, D(2024, 6, 30))

        # Order 7: outside the 13 month window - $5000 (May 2024)
        o7 = cls.make_order(cls.cust_a, "USD")
        line = cls.make_line(o7, cls.p1, 1, Money(5000, "USD"))
        cls.ship(line, 1, D(2024, 5, 31))

    @classmethod
    def make_order(cls, customer, currency, status=None, shipment_date=None):
        """Create a sales order."""
        cls.counter += 1
        return SalesOrder.objects.create(
            customer=customer,
            reference=f"SO-{cls.counter:04d}",
            order_currency=currency,
            status=status or SalesOrderStatus.IN_PROGRESS.value,
            shipment_date=shipment_date,
        )

    @classmethod
    def make_line(cls, order, part, quantity, price, discount=0):
        """Create a sales order line item."""
        return SalesOrderLineItem.objects.create(
            order=order,
            part=part,
            quantity=quantity,
            sale_price=price,
            discount=discount,
        )

    @classmethod
    def ship(cls, line, quantity, date):
        """Allocate stock to a line in its own shipment, shipped on the given date."""
        cls.counter += 1
        shipment = SalesOrderShipment.objects.create(
            order=line.order, reference=f"S-{cls.counter}", shipment_date=date
        )
        return SalesOrderAllocation.objects.create(
            line=line,
            shipment=shipment,
            item=cls.stock[line.part.pk],
            quantity=quantity,
        )

    def setUp(self):
        """Exchange rates are needed for each test (USD base, AUD = 1.5)."""
        super().setUp()
        self.generate_exchange_rates()

    def test_month_helpers(self):
        """Test month arithmetic."""
        self.assertEqual(sales.add_months(D(2025, 1, 1), -1), D(2024, 12, 1))
        self.assertEqual(sales.add_months(D(2025, 12, 1), 1), D(2026, 1, 1))
        self.assertEqual(sales.add_months(D(2025, 6, 1), -12), D(2024, 6, 1))
        self.assertEqual(sales.month_start(D(2025, 6, 17)), D(2025, 6, 1))

    def test_monthly_total(self):
        """Total for June 2025 includes shipped allocations and extra lines."""
        agg = sales.SalesAggregator(D(2025, 6, 1), D(2025, 7, 1), "USD")

        self.assertAlmostEqual(agg.total(), Decimal(195))  # 90 + 25 + 80
        self.assertEqual(agg.missing_rates, {"JPY"})
        self.assertEqual(agg.unpriced_line_count(), 1)

    def test_monthly_totals(self):
        """Monthly totals cover every month in the range."""
        agg = sales.SalesAggregator(D(2024, 6, 1), D(2025, 7, 1), "USD")
        totals = agg.monthly_totals()

        self.assertEqual(len(totals), 13)
        self.assertAlmostEqual(totals[D(2024, 6, 1)], Decimal(100))
        self.assertAlmostEqual(totals[D(2025, 5, 1)], Decimal(54))
        self.assertAlmostEqual(totals[D(2025, 6, 1)], Decimal(195))
        self.assertEqual(totals[D(2025, 1, 1)], Decimal(0))

    def test_breakdowns(self):
        """Totals grouped by customer and by part."""
        agg = sales.SalesAggregator(D(2025, 6, 1), D(2025, 7, 1), "USD")

        by_customer = agg.totals_by(sales.DIMENSION_COMPANY)
        self.assertAlmostEqual(by_customer[self.cust_a.pk], Decimal(115))
        self.assertAlmostEqual(by_customer[self.cust_b.pk], Decimal(80))

        by_part = agg.totals_by(sales.DIMENSION_PART)
        self.assertAlmostEqual(by_part[self.p1.pk], Decimal(90))
        self.assertAlmostEqual(by_part[self.p2.pk], Decimal(80))
        self.assertAlmostEqual(by_part[None], Decimal(25))  # extra lines

        with self.assertRaises(ValueError):
            agg.totals_by("supplier")

    def get_response(self, plugin_access=True, **params):
        """Call the API view directly (the plugin is not registered in tests)."""
        request = APIRequestFactory().get("/", params)
        force_authenticate(request, user=self.user)

        plugin = SimpleNamespace(user_has_access=lambda user: plugin_access)

        return MonthlySalesView.as_view(plugin=plugin)(request)

    def test_api(self):
        """Test the monthly sales API endpoint."""
        response = self.get_response(year=2025, month=6)
        self.assertEqual(response.status_code, 200, response.data)

        data = response.data

        self.assertEqual(data["currency"], "USD")
        self.assertEqual(data["total"], 195)
        self.assertEqual(data["previous_month_total"], 54)
        self.assertEqual(data["last_year_total"], 100)
        # Average of the 12 months *before* June 2025 (excludes Order 7)
        self.assertEqual(data["average"], round(154 / 12, 2))

        history = data["history"]
        self.assertEqual(len(history), 12)
        self.assertEqual(history[0]["month"], "2024-07")
        self.assertEqual(history[-1], {"month": "2025-06", "total": 195})

        self.assertEqual(
            [(r["name"], r["total"]) for r in data["by_company"]],
            [("Customer A", 115), ("Customer B", 80)],
        )
        self.assertEqual(
            [(r["name"], r["total"]) for r in data["by_part"]],
            [("P1", 90), ("P2", 80), (None, 25)],
        )

        self.assertEqual(data["warnings"]["missing_rates"], ["JPY"])
        self.assertEqual(data["warnings"]["unpriced_lines"], 1)

    def test_api_validation(self):
        """Invalid or future months are rejected."""
        self.assertEqual(self.get_response(year=2025, month=13).status_code, 400)

        future = sales.add_months(datetime.date.today(), 2)
        response = self.get_response(year=future.year, month=future.month)
        self.assertEqual(response.status_code, 400)

        # Defaults to the current month
        response = self.get_response()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["year"], datetime.date.today().year)

    def test_api_permissions(self):
        """Access requires plugin access (group) and the sales order view role."""
        self.assertEqual(self.get_response(plugin_access=False).status_code, 403)

        self.user.groups.clear()
        self.assertEqual(self.get_response().status_code, 403)
