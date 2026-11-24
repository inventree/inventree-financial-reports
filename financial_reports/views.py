"""API views for the FinancialReports plugin."""

import datetime
from decimal import Decimal
from typing import cast

from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from users.permissions import check_user_role
from users.ruleset import RuleSetEnum

from . import aggregation
from .serializers import ReportRequestSerializer


def money(value: Decimal) -> float:
    """Round a monetary value for the API response (display only)."""
    return round(float(value), 2)


class FinancialReportPermission(permissions.BasePermission):
    """Restrict access to financial data.

    The user must:
    - Be authenticated
    - Have the required role (e.g. 'view' on sales orders)
    - Be a member of the plugin's configured user group (if one is set)
    """

    def has_permission(self, request, view):
        """Check whether the requesting user may view this report."""
        user = request.user

        if not user or not user.is_authenticated:
            return False

        plugin = getattr(view, "plugin", None)

        if plugin is None or not plugin.user_has_access(user):
            return False

        role = getattr(view, "role_required", None)

        return bool(role) and check_user_role(user, role, "view")


class MonthlyReportView(APIView):
    """Periodic order value summary (base class).

    Query parameters select a calendar month, quarter or year. Returns:
    - Total value for the selected period (in the default currency)
    - Totals and order counts for the selected period and the periods
      before it (history)
    - Totals for the previous period, and the same period last year
    - Average value (and order count) of the periods *before* the selected period
    - Breakdown by company (customer / supplier) and by part

    Subclasses set `aggregator_class` and `role_required`.
    """

    permission_classes = [FinancialReportPermission]

    aggregator_class: type[aggregation.OrderValueAggregator]
    role_required: str

    # Set via as_view(plugin=...) in FinancialReports.setup_urls
    plugin = None

    def get(self, request, *args, **kwargs):
        """Return the period summary."""
        serializer = ReportRequestSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        params = cast(dict, serializer.validated_data)

        period = params["period"]
        length = aggregation.PERIOD_MONTHS[period]
        count = aggregation.PERIOD_HISTORY[period]

        selected = aggregation.period_start(
            datetime.date(params["year"], params["month"], 1), period
        )
        selected_end = aggregation.add_months(selected, length)

        # The selected period, plus `count` periods before it (for the
        # average), oldest first
        starts = [
            aggregation.add_months(selected, -length * i) for i in range(count, -1, -1)
        ]

        history = self.aggregator_class(starts[0], selected_end)
        monthly = history.monthly_totals()

        totals = {
            start: sum(
                (monthly[aggregation.add_months(start, i)] for i in range(length)),
                Decimal(0),
            )
            for start in starts
        }

        # Distinct orders in each period (an order may span several months)
        monthly_orders = history.monthly_orders()

        orders = {
            start: len(
                set().union(
                    *(
                        monthly_orders.get(aggregation.add_months(start, i), set())
                        for i in range(length)
                    )
                )
            )
            for start in starts
        }

        previous_periods = [totals[start] for start in starts[:-1]]
        previous_orders = [orders[start] for start in starts[:-1]]

        # Same period last year (identical to the previous period for years)
        last_year = None

        if period != aggregation.PERIOD_YEAR:
            last_year = totals.get(aggregation.add_months(selected, -12))

        current = self.aggregator_class(selected, selected_end, history.currency)

        by_company = self.company_breakdown(
            current.totals_by(aggregation.DIMENSION_COMPANY)
        )
        by_part = self.part_breakdown(current.totals_by(aggregation.DIMENSION_PART))

        missing_rates = sorted(history.missing_rates | current.missing_rates)

        return Response({
            "currency": history.currency,
            "period": period,
            "year": selected.year,
            "month": selected.month,
            "total": money(totals[selected]),
            "previous_total": money(totals[starts[-2]]),
            "last_year_total": None if last_year is None else money(last_year),
            "average": money(sum(previous_periods, Decimal(0)) / count),
            "average_orders": round(sum(previous_orders) / count, 2),
            "average_periods": count,
            # The `count` most recent periods (ending with the selected one),
            # oldest first. Each is identified by its first month.
            "history": [
                {
                    "start": start.strftime("%Y-%m"),
                    "total": money(totals[start]),
                    "orders": orders[start],
                }
                for start in starts[1:]
            ],
            "by_company": by_company,
            "by_part": by_part,
            "warnings": {
                "missing_rates": missing_rates,
                "unpriced_lines": current.unpriced_line_count(),
            },
        })

    @staticmethod
    def company_breakdown(totals: dict) -> list:
        """Convert {company_pk: total} into a sorted list with company names."""
        from company.models import Company

        names = dict(
            Company.objects.filter(pk__in=[k for k in totals if k]).values_list(
                "pk", "name"
            )
        )

        rows = [
            {"pk": pk, "name": names.get(pk) if pk else None, "total": money(total)}
            for pk, total in totals.items()
            if total
        ]

        return sorted(rows, key=lambda row: row["total"], reverse=True)

    @staticmethod
    def part_breakdown(totals: dict) -> list:
        """Convert {part_pk: total} into a sorted list with part names.

        The key None represents rows not linked to a part (e.g. extra lines).
        """
        from part.models import Part

        parts = {
            part.pk: part
            for part in Part.objects.filter(pk__in=[k for k in totals if k])
        }

        rows = []

        for pk, total in totals.items():
            if not total:
                continue

            part = parts.get(pk)

            rows.append({
                "pk": pk,
                "name": part.full_name if part else None,
                "IPN": part.IPN if part else None,
                "total": money(total),
            })

        return sorted(rows, key=lambda row: row["total"], reverse=True)


class MonthlySalesView(MonthlyReportView):
    """Monthly sales summary (shipped basis)."""

    aggregator_class = aggregation.SalesAggregator
    role_required = RuleSetEnum.SALES_ORDER


class MonthlyPurchasingView(MonthlyReportView):
    """Monthly purchasing summary (order placed basis)."""

    aggregator_class = aggregation.PurchaseAggregator
    role_required = RuleSetEnum.PURCHASE_ORDER
