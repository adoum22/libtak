from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    DailyReportView, 
    WeeklyReportView,
    MonthlyReportView,
    StatsView, 
    ReportSettingsView,
    ReportLogViewSet,
    ExportReportView
)

router = DefaultRouter()
router.register(r'logs', ReportLogViewSet)

urlpatterns = [
    path('daily/', DailyReportView.as_view(), name='daily_report'),
    path('weekly/', WeeklyReportView.as_view(), name='weekly_report'),
    path('monthly/', MonthlyReportView.as_view(), name='monthly_report'),
    path('stats/', StatsView.as_view(), name='stats'),
    path('settings/', ReportSettingsView.as_view(), name='report_settings'),
    path('export_pdf/', ExportReportView.as_view(), name='export_report_pdf'),
    path('', include(router.urls)),
]
