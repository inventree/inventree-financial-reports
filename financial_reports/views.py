"""API views for the FinancialReports plugin."""

import datetime
from decimal import Decimal
from typing import cast

from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from users.permissions import check_user_role
from users.ruleset import RuleSetEnum

from . import sales
from .serializers import MonthlyReportRequestSerializer


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


class MonthlySalesView(APIView):
    """Monthly sales summary.

    Returns, for the requested month:
    - Total shipped sales value (in the default currency)
    - Monthly totals for the 12 months ending at the requested month
    - Average monthly sales for the 12 months *before* the requested month
    - Breakdown by customer and by part
    """

    permission_classes = [FinancialReportPermission]
    role_required = RuleSetEnum.SALES_ORDER

    # Set via as_view(plugin=...) in FinancialReports.setup_urls
    plugin = None

    def get(self, request, *args, **kwargs):
        """Return the monthly sales summary."""
        serializer = MonthlyReportRequestSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        params = cast(dict, serializer.validated_data)

        selected = datetime.date(params["year"], params["month"], 1)
        selected_end = sales.add_months(selected, 1)

        # Include 12 months *prior* to the selected month (for the average),
        # so the window covers 13 months in total
        history_start = sales.add_months(selected, -12)

        history = sales.SalesAggregator(history_start, selected_end)
        monthly = history.monthly_totals()

        previous_months = [
            monthly[sales.add_months(selected, -i)] for i in range(1, 13)
        ]

        current = sales.SalesAggregator(selected, selected_end, history.currency)

        by_customer = self.customer_breakdown(
            current.totals_by(sales.DIMENSION_CUSTOMER)
        )
        by_part = self.part_breakdown(current.totals_by(sales.DIMENSION_PART))

        missing_rates = sorted(history.missing_rates | current.missing_rates)

        return Response({
            "currency": history.currency,
            "year": selected.year,
            "month": selected.month,
            "total": money(monthly[selected]),
            "previous_month_total": money(monthly[sales.add_months(selected, -1)]),
            "last_year_total": money(monthly[history_start]),
            "average": money(sum(previous_months, Decimal(0)) / 12),
            # 12 most recent months, oldest first
            "history": [
                {"month": month.strftime("%Y-%m"), "total": money(total)}
                for month, total in sorted(monthly.items())
                if month > history_start
            ],
            "by_customer": by_customer,
            "by_part": by_part,
            "warnings": {
                "missing_rates": missing_rates,
                "unpriced_allocations": current.unpriced_allocation_count(),
            },
        })

    @staticmethod
    def customer_breakdown(totals: dict) -> list:
        """Convert {customer_pk: total} into a sorted list with customer names."""
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

        The key None represents extra line items (not linked to a part).
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
