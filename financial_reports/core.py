"""Generate monthly financial reports for InvenTree"""

from plugin import InvenTreePlugin

from plugin.mixins import SettingsMixin, UrlsMixin, UserInterfaceMixin

from users.permissions import check_user_role
from users.ruleset import RuleSetEnum

from . import PLUGIN_VERSION


class FinancialReports(
    SettingsMixin,
    UrlsMixin,
    UserInterfaceMixin,
    InvenTreePlugin,
):
    """FinancialReports - custom InvenTree plugin."""

    # Plugin metadata
    TITLE = "Financial Reports"
    NAME = "FinancialReports"
    SLUG = "financial-reports"
    DESCRIPTION = "Generate monthly financial reports for InvenTree"
    VERSION = PLUGIN_VERSION

    # Additional project information
    AUTHOR = "Oliver Walters"
    WEBSITE = "https://github.com/inventree/inventree-financial-reports"
    LICENSE = "MIT"

    MIN_VERSION = "1.0.0"

    # Plugin settings (from SettingsMixin)
    SETTINGS = {
        "USER_GROUP": {
            "name": "Allowed Group",
            "description": "Restrict financial reports to members of this group (leave blank to allow any user with the relevant order permissions)",
            "model": "auth.group",
        },
    }

    def user_has_access(self, user) -> bool:
        """Check whether the user is allowed to view financial reports at all.

        Role-specific checks (e.g. sales order 'view') are applied separately.
        """
        if not user or not user.is_authenticated:
            return False

        if group := self.get_setting("USER_GROUP"):
            return user.groups.filter(pk=group).exists()

        return True

    # Monthly reports: each provides an API endpoint and a panel on the target page
    MONTHLY_REPORTS = [
        {
            "path": "sales/monthly/",
            "view": "MonthlySalesView",
            "target": "sales",
            "role": RuleSetEnum.SALES_ORDER,
            "key": "financial-reports-monthly-sales",
            "title": "Monthly Sales",
            "description": "Monthly sales summary",
            "render": "RenderMonthlySalesPanel",
        },
        {
            "path": "purchasing/monthly/",
            "view": "MonthlyPurchasingView",
            "target": "purchasing",
            "role": RuleSetEnum.PURCHASE_ORDER,
            "key": "financial-reports-monthly-purchasing",
            "title": "Monthly Purchasing",
            "description": "Monthly purchasing summary",
            "render": "RenderMonthlyPurchasingPanel",
        },
    ]

    # Custom URL endpoints (from UrlsMixin)
    def setup_urls(self):
        """Configure custom URL endpoints for this plugin."""
        from django.urls import path

        from . import views

        return [
            path(
                report["path"],
                getattr(views, report["view"]).as_view(plugin=self),
                name=report["key"],
            )
            for report in self.MONTHLY_REPORTS
        ]

    # User interface elements (from UserInterfaceMixin)
    def get_ui_panels(self, request, context: dict, **kwargs):
        """Return custom panels for the 'sales' and 'purchasing' index pages."""
        user = request.user

        if not self.user_has_access(user):
            return []

        target = (context or {}).get("target_model")

        return [
            {
                "key": report["key"],
                "title": report["title"],
                "description": report["description"],
                "icon": "ti:report-money:outline",
                "source": self.plugin_static_file(f"Panels.js:{report['render']}"),
                "context": {
                    "api_url": f"/{self.base_url}{report['path']}",
                },
            }
            for report in self.MONTHLY_REPORTS
            if report["target"] == target
            and check_user_role(user, report["role"], "view")
        ]
