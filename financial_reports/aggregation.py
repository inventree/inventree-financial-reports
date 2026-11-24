"""Order value aggregation for the FinancialReports plugin.

OrderValueAggregator sums the value of order lines over a date range, grouped
by month, company or part. Subclasses describe *which* rows count and *which*
date applies, via field paths:

Sales (SalesAggregator) - recognised when goods ship:
- Stock allocated against a sales order line counts on the date its shipment
  was shipped. Value = allocated quantity x sale price x (1 - discount).
- Extra line items (freight, fees, etc) count on the date the whole order
  was shipped.

Purchases (PurchaseAggregator) - recognised when the order is placed:
- Each purchase order line counts at its full value on the order's issue date.
  Value = line quantity x purchase price x (1 - discount).
- Extra line items also count on the order's issue date.

In both cases cancelled orders are excluded, and all values are converted into
the InvenTree default currency using the *current* exchange rates (InvenTree
does not store historical rates).
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db.models import DecimalField, ExpressionWrapper, F, Sum, Value
from django.db.models.functions import TruncMonth

from djmoney.contrib.exchange.exceptions import MissingRate
from djmoney.contrib.exchange.models import get_rate

from common.currency import currency_code_default


# Grouping dimensions which are supported by OrderValueAggregator.totals_by()
DIMENSION_COMPANY = "company"
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


class RowSource:
    """Field paths describing one source of valued rows (e.g. order lines).

    All paths are relative to the queried model.
    """

    def __init__(
        self,
        *,
        date: str,
        quantity: str,
        price: str,
        discount: str,
        company: str,
        status: str,
        part: str | None = None,
    ):
        """Store the field paths for this source."""
        self.date = date
        self.quantity = quantity
        self.price = price
        self.discount = discount
        self.company = company
        self.status = status
        self.part = part


class OrderValueAggregator:
    """Aggregate order value over a date range [start, end).

    Aggregation is performed in the database, grouped by source currency,
    and the (small number of) grouped results are converted in Python.

    Subclasses must provide:
    - lines(): Base queryset for the primary rows, and `line_source`
    - extra_lines(): Base queryset for extra line items, and `extra_source`
    - excluded_statuses: Order status values which are not counted
    """

    line_source: RowSource
    extra_source: RowSource
    excluded_statuses: list[int] = []

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

    def lines(self):
        """Base queryset for the primary rows (unfiltered)."""
        raise NotImplementedError

    def extra_lines(self):
        """Base queryset for extra line items (unfiltered)."""
        raise NotImplementedError

    def _filter(self, queryset, source: RowSource):
        """Restrict a queryset to the date range, excluding unwanted statuses."""
        return queryset.filter(**{
            f"{source.date}__gte": self.start,
            f"{source.date}__lt": self.end,
        }).exclude(**{f"{source.status}__in": self.excluded_statuses})

    def counted_lines(self):
        """Primary rows within the date range (priced or not)."""
        return self._filter(self.lines(), self.line_source)

    def priced_lines(self):
        """Primary rows within the date range which have a price."""
        return self.counted_lines().filter(**{
            f"{self.line_source.price}__isnull": False
        })

    def priced_extra_lines(self):
        """Extra line items within the date range which have a price."""
        return self._filter(self.extra_lines(), self.extra_source).filter(**{
            f"{self.extra_source.price}__isnull": False
        })

    def unpriced_line_count(self) -> int:
        """Number of rows in the range with no price (excluded from totals)."""
        return (
            self.counted_lines()
            .filter(**{f"{self.line_source.price}__isnull": True})
            .count()
        )

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

    def _grouped(self, queryset, source: RowSource, dimension: str | None):
        """Sum row values, grouped by currency and (optionally) a dimension."""
        annotations = {
            "_currency": F(f"{source.price}_currency"),
            "_month": TruncMonth(source.date),
            "_company": F(source.company),
        }

        if source.part:
            annotations["_part"] = F(source.part)

        group = ["_currency"]

        if dimension:
            key = f"_{dimension}"
            # Sources without a part (e.g. extra lines) group under None
            if key in annotations:
                group.append(key)

        return (
            queryset.annotate(**annotations)
            .values(*group)
            .annotate(
                _value=Sum(_line_value(source.quantity, source.price, source.discount))
            )
            .order_by()
        )

    def _aggregate(self, dimension: str | None) -> dict:
        """Return {key: total} across primary and extra rows."""
        totals: dict = {}

        for queryset, source in (
            (self.priced_lines(), self.line_source),
            (self.priced_extra_lines(), self.extra_source),
        ):
            for row in self._grouped(queryset, source, dimension):
                key = row.get(f"_{dimension}") if dimension else None
                totals[key] = totals.get(key, Decimal(0)) + self.convert(
                    row["_value"], row["_currency"]
                )

        return totals

    def total(self) -> Decimal:
        """Total value over the date range."""
        return self._aggregate(None).get(None, Decimal(0))

    def monthly_totals(self) -> dict[datetime.date, Decimal]:
        """Total value for each month in the range.

        Every month in the range is present in the result (zero if empty).
        """
        result = {}
        month = month_start(self.start)

        while month < self.end:
            result[month] = Decimal(0)
            month = add_months(month, 1)

        for key, value in self._aggregate("month").items():
            # TruncMonth may return a datetime on some database backends
            if isinstance(key, datetime.datetime):
                key = key.date()
            if key in result:
                result[key] += value

        return result

    def totals_by(self, dimension: str) -> dict:
        """Total value grouped by company or part (primary keys).

        Rows without a part (e.g. extra line items) are grouped under None.
        """
        if dimension not in (DIMENSION_COMPANY, DIMENSION_PART):
            raise ValueError(f"Invalid dimension: {dimension}")

        return self._aggregate(dimension)


class SalesAggregator(OrderValueAggregator):
    """Sales value, recognised on the date goods are shipped."""

    line_source = RowSource(
        date="shipment__shipment_date",
        quantity="quantity",
        price="line__sale_price",
        discount="line__discount",
        company="line__order__customer",
        part="line__part",
        status="line__order__status",
    )

    extra_source = RowSource(
        date="order__shipment_date",
        quantity="quantity",
        price="price",
        discount="discount",
        company="order__customer",
        status="order__status",
    )

    @property
    def excluded_statuses(self):
        """Cancelled sales orders are not counted."""
        from order.status_codes import SalesOrderStatus

        return [SalesOrderStatus.CANCELLED.value]

    def lines(self):
        """Stock allocated against sales order lines."""
        from order.models import SalesOrderAllocation

        return SalesOrderAllocation.objects.all()

    def extra_lines(self):
        """Sales order extra line items."""
        from order.models import SalesOrderExtraLine

        return SalesOrderExtraLine.objects.all()


class PurchaseAggregator(OrderValueAggregator):
    """Purchase value, recognised on the date the order is placed."""

    line_source = RowSource(
        date="order__issue_date",
        quantity="quantity",
        price="purchase_price",
        discount="discount",
        company="order__supplier",
        # Group by the internal part (via the supplier part)
        part="part__part",
        status="order__status",
    )

    extra_source = RowSource(
        date="order__issue_date",
        quantity="quantity",
        price="price",
        discount="discount",
        company="order__supplier",
        status="order__status",
    )

    @property
    def excluded_statuses(self):
        """Cancelled purchase orders are not counted."""
        from order.status_codes import PurchaseOrderStatus

        return [PurchaseOrderStatus.CANCELLED.value]

    def lines(self):
        """Purchase order line items."""
        from order.models import PurchaseOrderLineItem

        return PurchaseOrderLineItem.objects.all()

    def extra_lines(self):
        """Purchase order extra line items."""
        from order.models import PurchaseOrderExtraLine

        return PurchaseOrderExtraLine.objects.all()
