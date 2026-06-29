from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Cost, Day, Project, Stage, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Superadmin skapar och hanterar användare härifrån."""
    list_display = ('username', 'email', 'first_name', 'last_name',
                    'role', 'is_staff')
    list_filter = BaseUserAdmin.list_filter + ('role',)
    fieldsets = BaseUserAdmin.fieldsets + (
        ('Roll', {'fields': ('role',)}),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ('Roll', {'fields': ('role',)}),
    )


class StageInline(admin.TabularInline):
    model = Stage
    extra = 0


class CostInline(admin.TabularInline):
    model = Cost
    extra = 0


class DayInline(admin.TabularInline):
    model = Day
    extra = 0


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ('title', 'owner', 'start_date', 'end_date',
                    'budget', 'total_distance_km', 'total_cost')
    list_filter = ('owner',)
    inlines = [DayInline]


@admin.register(Day)
class DayAdmin(admin.ModelAdmin):
    list_display = ('project', 'date', 'weekday', 'accommodation_type',
                    'distance_km', 'total_cost')
    list_filter = ('project', 'accommodation_type')
    inlines = [StageInline, CostInline]


admin.site.register(Stage)
admin.site.register(Cost)

admin.site.site_header = 'Cykelsemesterplaneraren'
admin.site.site_title = 'Cykelplanering'
admin.site.index_title = 'Administration'
