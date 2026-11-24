"""Unit tests for the monthly purchasing report.

Run from the InvenTree backend directory, with this plugin on the PYTHONPATH:

    PYTHONPATH=/path/to/FinancialReports python manage.py test financial_reports.tests
"""

import datetime
from decimal import Decimal
from types import SimpleNamespace

from djmoney.money import Money
from rest_framework.test import APIRequestFactory, force_authenticate

from common.models import InvenTreeSetting
from company.models import Company, SupplierPart
from InvenTree.unit_test import InvenTreeTestCase
from order.models import PurchaseOrder, PurchaseOrderExtraLine, PurchaseOrderLineItem
from order.status_codes import PurchaseOrderStatus
from part.models import Part

from financial_reports import aggregation
from financial_reports.views import MonthlyPurchasingView


D = datetime.date


class MonthlyPurchasingTest(InvenTreeTestCase):
    """Tests for order-placed basis purchase aggregation (June 2025 is the reference month)."""

    roles = ["purchase_order.view"]

    @classmethod
    def setUpTestData(cls):
        """Create a set of purchase orders exercising the various edge cases."""
        super().setUpTestData()

        InvenTreeSetting.set_setting("INVENTREE_DEFAULT_CURRENCY", "USD", None)

        cls.s1 = Company.objects.create(name="Supplier 1", is_supplier=True)
        cls.s2 = Company.objects.create(name="Supplier 2", is_supplier=True)
        cls.s3 = Company.objects.create(name="Supplier 3", is_supplier=True)

        cls.p1 = Part.objects.create(name="P1", description="Part 1", purchaseable=True)
        cls.p2 = Part.objects.create(name="P2", description="Part 2", purchaseable=True)

        sp1 = SupplierPart.objects.create(part=cls.p1, supplier=cls.s1, SKU="S1-P1")
        sp2 = SupplierPart.objects.create(part=cls.p2, supplier=cls.s1, SKU="S1-P2")
        sp3 = SupplierPart.objects.create(part=cls.p1, supplier=cls.s2, SKU="S2-P1")

        cls.counter = 0

        # PO1 (USD, S1, placed June):
        # 10 x $5 @ 20% discount = 40, 2 x $50 = 100, extra line $15
        po1 = cls.make_order(cls.s1, "USD", D(2025, 6, 10))
        cls.make_line(po1, sp1, 10, Money(5, "USD"), discount=20)
        cls.make_line(po1, sp2, 2, Money(50, "USD"))
        PurchaseOrderExtraLine.objects.create(
            order=po1, quantity=1, price=Money(15, "USD"), reference="Freight"
        )

        # PO2 (AUD, S2, completed): 3 x AUD 30 = AUD 90 = USD 60 (June)
        po2 = cls.make_order(cls.s2, "AUD", D(2025, 6, 20))
        cls.make_line(po2, sp3, 3, Money(30, "AUD"))
        cls.set_status(po2, PurchaseOrderStatus.COMPLETE.value)

        # PO3 (cancelled): excluded
        po3 = cls.make_order(cls.s1, "USD", D(2025, 6, 5))
        cls.make_line(po3, sp1, 1, Money(999, "USD"))
        cls.set_status(po3, PurchaseOrderStatus.CANCELLED.value)

        # PO4 (pending - never placed, no issue date): excluded
        po4 = cls.make_order(cls.s1, "USD", None, PurchaseOrderStatus.PENDING.value)
        cls.make_line(po4, sp1, 1, Money(888, "USD"))

        # PO5 (S3, June): one unpriced line (reported), one line with no part ($7)
        po5 = cls.make_order(cls.s3, "USD", D(2025, 6, 28))
        cls.make_line(po5, sp1, 1, None)
        cls.make_line(po5, None, 1, Money(7, "USD"))

        # PO6 (May 2025): $30
        po6 = cls.make_order(cls.s1, "USD", D(2025, 5, 1))
        cls.make_line(po6, sp1, 1, Money(30, "USD"))

        # PO7 (June 2024): $120
        po7 = cls.make_order(cls.s1, "USD", D(2024, 6, 15))
        cls.make_line(po7, sp1, 1, Money(120, "USD"))

    @classmethod
    def make_order(cls, supplier, currency, issue_date, status=None):
        """Create a purchase order."""
        cls.counter += 1
        return PurchaseOrder.objects.create(
            supplier=supplier,
            reference=f"PO-{cls.counter:04d}",
            order_currency=currency,
            issue_date=issue_date,
            status=status or PurchaseOrderStatus.PLACED.value,
        )

    @classmethod
    def set_status(cls, order, status):
        """Set the order status after adding lines (completed orders are locked)."""
        PurchaseOrder.objects.filter(pk=order.pk).update(status=status)

    @classmethod
    def make_line(cls, order, supplier_part, quantity, price, discount=0):
        """Create a purchase order line item."""
        return PurchaseOrderLineItem.objects.create(
            order=order,
            part=supplier_part,
            quantity=quantity,
            purchase_price=price,
            discount=discount,
        )

    def setUp(self):
        """Exchange rates are needed for each test (USD base, AUD = 1.5)."""
        super().setUp()
        self.generate_exchange_rates()

    def test_monthly_total(self):
        """Total for June 2025 includes order lines and extra lines."""
        agg = aggregation.PurchaseAggregator(D(2025, 6, 1), D(2025, 7, 1), "USD")

        # 40 + 100 + 15 + 60 + 7
        self.assertAlmostEqual(agg.total(), Decimal(222))
        self.assertEqual(agg.missing_rates, set())
        self.assertEqual(agg.unpriced_line_count(), 1)

    def test_breakdowns(self):
        """Totals grouped by supplier and by (internal) part."""
        agg = aggregation.PurchaseAggregator(D(2025, 6, 1), D(2025, 7, 1), "USD")

        by_supplier = agg.totals_by(aggregation.DIMENSION_COMPANY)
        self.assertAlmostEqual(by_supplier[self.s1.pk], Decimal(155))
        self.assertAlmostEqual(by_supplier[self.s2.pk], Decimal(60))
        self.assertAlmostEqual(by_supplier[self.s3.pk], Decimal(7))

        by_part = agg.totals_by(aggregation.DIMENSION_PART)
        # P1 is bought from two suppliers: 40 (S1) + 60 (S2)
        self.assertAlmostEqual(by_part[self.p1.pk], Decimal(100))
        self.assertAlmostEqual(by_part[self.p2.pk], Decimal(100))
        # Extra line ($15) + line without a supplier part ($7)
        self.assertAlmostEqual(by_part[None], Decimal(22))

    def get_response(self, **params):
        """Call the API view directly (the plugin is not registered in tests)."""
        request = APIRequestFactory().get("/", params)
        force_authenticate(request, user=self.user)

        plugin = SimpleNamespace(user_has_access=lambda user: True)

        return MonthlyPurchasingView.as_view(plugin=plugin)(request)

    def test_api(self):
        """Test the monthly purchasing API endpoint."""
        response = self.get_response(year=2025, month=6)
        self.assertEqual(response.status_code, 200, response.data)

        data = response.data

        self.assertEqual(data["total"], 222)
        self.assertEqual(data["previous_total"], 30)
        self.assertEqual(data["last_year_total"], 120)
        self.assertEqual(data["average"], round(150 / 12, 2))
        self.assertEqual(len(data["history"]), 12)

        self.assertEqual(
            [(r["name"], r["total"]) for r in data["by_company"]],
            [("Supplier 1", 155), ("Supplier 2", 60), ("Supplier 3", 7)],
        )
        self.assertEqual(data["warnings"]["unpriced_lines"], 1)

    def test_api_permissions(self):
        """The purchase order view role is required (sales role is not enough)."""
        self.user.groups.clear()
        self.assertEqual(self.get_response().status_code, 403)
