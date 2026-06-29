"""API-routning för planner-appen."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register('projects', views.ProjectViewSet, basename='project')
router.register('days', views.DayViewSet, basename='day')
router.register('stages', views.StageViewSet, basename='stage')
router.register('costs', views.CostViewSet, basename='cost')
router.register('logs', views.LogEntryViewSet, basename='log')

urlpatterns = [
    path('auth/csrf/', views.csrf_view, name='csrf'),
    path('auth/login/', views.login_view, name='login'),
    path('auth/logout/', views.logout_view, name='logout'),
    path('auth/me/', views.me_view, name='me'),
    path('route/', views.route_view, name='route'),
    path('', include(router.urls)),
]
