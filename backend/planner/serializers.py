"""DRF-serializers för API:et."""
from rest_framework import serializers

from .models import Cost, Day, LogEntry, Project, Stage


class LogEntrySerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(
        source='get_kind_display', read_only=True
    )

    class Meta:
        model = LogEntry
        fields = ['id', 'day', 'kind', 'kind_display', 'text',
                  'category', 'amount', 'created_at']
        read_only_fields = ['created_at']


class CostSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(
        source='get_category_display', read_only=True
    )

    class Meta:
        model = Cost
        fields = ['id', 'day', 'category', 'category_display', 'amount']


class StageSerializer(serializers.ModelSerializer):
    difficulty_level = serializers.IntegerField(read_only=True)
    average_speed_kmh = serializers.IntegerField(read_only=True)
    estimated_duration_minutes = serializers.IntegerField(read_only=True)
    climb_per_km = serializers.FloatField(read_only=True)
    calories = serializers.IntegerField(read_only=True)
    # Etapper skapas tomma och fylls i efterhand -> tillåt blanka namn.
    from_point = serializers.CharField(allow_blank=True, required=False)
    to_point = serializers.CharField(allow_blank=True, required=False)

    class Meta:
        model = Stage
        fields = [
            'id', 'day', 'order', 'from_point', 'to_point',
            'from_country', 'to_country',
            'start_time', 'end_time', 'waypoints', 'profile',
            'distance_km', 'ascent_m', 'descent_m', 'route_geometry',
            'route_steps', 'countries', 'difficulty_level',
            'average_speed_kmh', 'estimated_duration_minutes',
            'climb_per_km', 'calories',
        ]
        # Dessa beräknas/hämtas från ORS, inte direkt från klienten.
        read_only_fields = ['distance_km', 'ascent_m', 'descent_m',
                            'route_geometry', 'route_steps', 'countries',
                            'from_country', 'to_country']


class DaySerializer(serializers.ModelSerializer):
    weekday = serializers.CharField(read_only=True)
    distance_km = serializers.FloatField(read_only=True)
    total_cost = serializers.DecimalField(
        max_digits=10, decimal_places=2, read_only=True
    )
    is_accommodation_free = serializers.BooleanField(read_only=True)
    cycling_calories = serializers.IntegerField(read_only=True)
    total_calories = serializers.IntegerField(read_only=True, allow_null=True)
    planned_duration_minutes = serializers.IntegerField(read_only=True)
    actual_duration_minutes = serializers.IntegerField(
        read_only=True, allow_null=True
    )
    actual_cost = serializers.DecimalField(
        max_digits=10, decimal_places=2, read_only=True
    )
    prev_day_id = serializers.IntegerField(read_only=True, allow_null=True)
    next_day_id = serializers.IntegerField(read_only=True, allow_null=True)
    stages = StageSerializer(many=True, read_only=True)
    costs = CostSerializer(many=True, read_only=True)
    logs = LogEntrySerializer(many=True, read_only=True)

    class Meta:
        model = Day
        fields = [
            'id', 'project', 'date', 'weekday', 'is_rest_day',
            'accommodation_type', 'accommodation_link', 'notes',
            'is_accommodation_free', 'distance_km', 'total_cost',
            'cycling_calories', 'total_calories',
            'planned_duration_minutes', 'actual_duration_minutes',
            'actual_distance_km', 'actual_start_time', 'actual_end_time',
            'actual_track', 'actual_cost', 'prev_day_id', 'next_day_id',
            'stages', 'costs', 'logs',
        ]


class ProjectListSerializer(serializers.ModelSerializer):
    total_distance_km = serializers.FloatField(read_only=True)
    total_cost = serializers.DecimalField(
        max_digits=10, decimal_places=2, read_only=True
    )
    day_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Project
        fields = [
            'id', 'title', 'budget', 'start_date', 'end_date',
            'total_distance_km', 'total_cost', 'day_count', 'created_at',
            'rider_gender', 'rider_age', 'rider_height_cm', 'rider_weight_kg',
        ]
        read_only_fields = ['created_at']


class ProjectDetailSerializer(ProjectListSerializer):
    days = DaySerializer(many=True, read_only=True)
    budget_remaining = serializers.DecimalField(
        max_digits=10, decimal_places=2, read_only=True
    )
    daily_budgets = serializers.SerializerMethodField()
    stats = serializers.ReadOnlyField()

    class Meta(ProjectListSerializer.Meta):
        fields = ProjectListSerializer.Meta.fields + [
            'days', 'budget_remaining', 'daily_budgets', 'stats',
        ]

    def get_daily_budgets(self, project):
        """Dynamisk dagsbudget: kvarvarande budget / kvarvarande dagar.

        Räknas om löpande dag för dag. Spenderar man under en dags budget
        ökar budgeten för resterande dagar, och tvärtom.
        """
        days = list(project.days.all())  # sorterade på datum
        remaining_budget = project.budget
        remaining_days = len(days)
        result = []

        for day in days:
            if remaining_days <= 0:
                break
            day_budget = remaining_budget / remaining_days
            spent = day.total_cost
            result.append({
                'day_id': day.id,
                'date': day.date,
                'budget': round(day_budget, 2),
                'spent': spent,
                'diff': round(day_budget - spent, 2),
                'over_budget': spent > day_budget,
            })
            remaining_budget -= spent
            remaining_days -= 1

        return result
