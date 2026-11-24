"""API serializers for the FinancialReports plugin."""

from rest_framework import serializers

from InvenTree.helpers import current_date


class MonthlyReportRequestSerializer(serializers.Serializer):
    """Query parameters for a monthly report.

    If not specified, the current month is used.
    """

    year = serializers.IntegerField(
        required=False, min_value=1900, max_value=9999, label="Year"
    )

    month = serializers.IntegerField(
        required=False, min_value=1, max_value=12, label="Month"
    )

    def validate(self, attrs):
        """Fill in defaults, and prevent requests for future months."""
        attrs = super().validate(attrs)

        today = current_date()

        attrs.setdefault("year", today.year)
        attrs.setdefault("month", today.month)

        if (attrs["year"], attrs["month"]) > (today.year, today.month):
            raise serializers.ValidationError("Cannot report on a future month")

        return attrs
