"""API serializers for the FinancialReports plugin."""

from rest_framework import serializers

from InvenTree.helpers import current_date

from .aggregation import PERIOD_MONTH, PERIOD_MONTHS


class ReportRequestSerializer(serializers.Serializer):
    """Query parameters for a periodic report.

    The report covers the calendar period (month, quarter or year) which
    contains the given year and month. If not specified, the current month
    is used.
    """

    period = serializers.ChoiceField(
        choices=list(PERIOD_MONTHS.keys()),
        default=PERIOD_MONTH,
        label="Period",
    )

    year = serializers.IntegerField(
        required=False, min_value=1900, max_value=9999, label="Year"
    )

    month = serializers.IntegerField(
        required=False, min_value=1, max_value=12, label="Month"
    )

    def validate(self, attrs):
        """Fill in defaults, and prevent requests for future periods."""
        attrs = super().validate(attrs)

        today = current_date()

        attrs.setdefault("year", today.year)
        attrs.setdefault("month", today.month)

        if (attrs["year"], attrs["month"]) > (today.year, today.month):
            raise serializers.ValidationError("Cannot report on a future period")

        return attrs
