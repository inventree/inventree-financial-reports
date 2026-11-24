"""Sales aggregation for the FinancialReports plugin.

Sales are recognised on a *shipped* basis:

- Stock allocated against a sales order line counts as a sale on the date
  that its shipment was shipped (SalesOrderShipment.shipment_date).
  Value = allocated quantity x line sale price x (1 - line discount).
- Extra line items (freight, fees, etc) are not shipped individually, so they
  count as a sale on the date the whole order was shipped
  (SalesOrder.shipment_date).
- Cancelled orders are excluded.

All values are converted into the InvenTree default currency, using the
*current* exchange rates (InvenTree does not store historical rates).
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db.models import DecimalField, ExpressionWrapper, F, Sum, Value
from django.db.models.functions import TruncMonth

from djmoney.contrib.exchange.exceptions import MissingRate
from djmoney.contrib.exchange.models import get_rate

from common.currency import currency_code_default
from order.models import SalesOrderAllocation, SalesOrderExtraLine
from order.status_codes import SalesOrderStatus


# Grouping dimensions which are supported by SalesAggregator.totals_by()
DIMENSION_CUSTOMER = "customer"
DIMENSION_PART = "part"


def month_start(date: datetime.date) -> datetime.date:
    """Return the first day of the month containing the given date."""
    return date.replace(day=1)


def add_months(date: datetime.date, months: int) -> datetime.date:
    """Return the first day of the month offset by the given number of months."""
    index = date.year * 12 + (date.month - 1) + months
    return datetime.date(index // 12, index % 12 + 1, 1)


def _line_value(quantity: str, price: str, discount: str) -> ExpressionWrapper:
    """Database expression for: quantity x price x (100 - discount) / 100."""
    return ExpressionWrapper(
        F(quantity)
        * F(price)
        * (Value(Decimal(100)) - F(discount))
        / Value(Decimal(100)),
        output_field=DecimalField(max_digits=30, decimal_places=8),
    )


class SalesAggregator:
    """Aggregate shipped sales value over a date range [start, end).

    Aggregation is performed in the database, grouped by source currency,
    and the (small number of) grouped results are converted in Python.
    """

    def __init__(
        self,
        start: datetime.date,
        end: datetime.date,
        currency: str | None = None,
    ):
        """Initialize the aggregator for the date range [start, end)."""
        self.start = start
        self.end = end
        self.currency = currency or currency_code_default()

        # Currencies for which no exchange rate is available
        self.missing_rates: set[str] = set()

        self._rates: dict[str, Decimal | None] = {}

    # ---- Querysets ----

    def allocations(self):
        """Stock allocations shipped within the date range."""
        return SalesOrderAllocation.objects.filter(
            shipment__shipment_date__gte=self.start,
            shipment__shipment_date__lt=self.end,
        ).exclude(line__order__status=SalesOrderStatus.CANCELLED.value)

    def extra_lines(self):
        """Extra line items for orders shipped within the date range."""
        return SalesOrderExtraLine.objects.filter(
            order__shipment_date__gte=self.start,
            order__shipment_date__lt=self.end,
            price__isnull=False,
        ).exclude(order__status=SalesOrderStatus.CANCELLED.value)

    def priced_allocations(self):
        """Shipped allocations whose line item has a sale price."""
        return self.allocations().filter(line__sale_price__isnull=False)

    def unpriced_allocation_count(self) -> int:
        """Number of shipped allocations which have no sale price (excluded from totals)."""
        return self.allocations().filter(line__sale_price__isnull=True).count()

    # ---- Currency conversion ----

    def convert(self, amount, currency: str | None) -> Decimal:
        """Convert an amount into the target currency.

        If no exchange rate is available, the amount is excluded (returns zero)
        and the currency is recorded in self.missing_rates.
        """
        if amount is None:
            return Decimal(0)

        currency = currency or self.currency

        if currency not in self._rates:
            try:
                self._rates[currency] = Decimal(get_rate(currency, self.currency))
            except MissingRate:
                self._rates[currency] = None

        rate = self._rates[currency]

        if rate is None:
            self.missing_rates.add(currency)
            return Decimal(0)

        return Decimal(amount) * rate

    # ---- Aggregations ----

    def _aggregate(self, allocation_key: str | None, extra_key: str | None):
        """Return {key: total} for allocations and extra lines.

        Arguments:
            allocation_key: Field (or annotation) to group allocations by
            extra_key: Field (or annotation) to group extra lines by.
                If None, extra lines are grouped under the key None.
        """
        totals: dict = {}

        def accumulate(rows, key_field):
            for row in rows:
                key = row.get(key_field) if key_field else None
                totals[key] = totals.get(key, Decimal(0)) + self.convert(
                    row["value"], row["currency"]
                )

        alloc_group = ["currency"] + ([allocation_key] if allocation_key else [])
        accumulate(
            self.priced_allocations()
            .annotate(
                month=TruncMonth("shipment__shipment_date"),
                customer=F("line__order__customer"),
                part=F("line__part"),
                currency=F("line__sale_price_currency"),
            )
            .values(*alloc_group)
            .annotate(
                value=Sum(_line_value("quantity", "line__sale_price", "line__discount"))
            )
            .order_by(),
            allocation_key,
        )

        extra_group = ["currency"] + ([extra_key] if extra_key else [])
        accumulate(
            self.extra_lines()
            .annotate(
                month=TruncMonth("order__shipment_date"),
                customer=F("order__customer"),
                currency=F("price_currency"),
            )
            .values(*extra_group)
            .annotate(value=Sum(_line_value("quantity", "price", "discount")))
            .order_by(),
            extra_key,
        )

        return totals

    def total(self) -> Decimal:
        """Total sales value over the date range."""
        return self._aggregate(None, None).get(None, Decimal(0))

    def monthly_totals(self) -> dict[datetime.date, Decimal]:
        """Total sales value for each month in the range.

        Every month in the range is present in the result (zero if no sales).
        """
        raw = self._aggregate("month", "month")

        result = {}
        month = month_start(self.start)

        while month < self.end:
            result[month] = Decimal(0)
            month = add_months(month, 1)

        for key, value in raw.items():
            # TruncMonth may return a datetime on some database backends
            if isinstance(key, datetime.datetime):
                key = key.date()
            if key in result:
                result[key] += value

        return result

    def totals_by(self, dimension: str) -> dict:
        """Total sales value grouped by customer or part (primary keys).

        For the part dimension, extra line items are grouped under the key None.
        """
        if dimension == DIMENSION_CUSTOMER:
            return self._aggregate("customer", "customer")

        if dimension == DIMENSION_PART:
            return self._aggregate("part", None)

        raise ValueError(f"Invalid dimension: {dimension}")
