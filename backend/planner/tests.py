"""Tester för beräkningslogiken och budgetfördelningen."""
from datetime import date, time
from decimal import Decimal

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import (
    Cost, Day, Project, Stage, User,
    difficulty_from_climb, speed_for_level,
)
from .serializers import ProjectDetailSerializer


class DifficultyTests(TestCase):
    def test_flat_route_is_level_0(self):
        # 0 m/km stigning -> nivå 0 -> 20 km/h
        self.assertEqual(difficulty_from_climb(0, 50), 0)
        self.assertEqual(speed_for_level(0), 20)

    def test_increasing_climb_raises_level(self):
        # Trösklar [8,15,22,32,45,60] m/km.
        # m/km: 4, 11, 18, 27, 38, 50, 70 -> nivå 0,1,2,3,4,5,6
        self.assertEqual(difficulty_from_climb(4 * 10, 10), 0)
        self.assertEqual(difficulty_from_climb(11 * 10, 10), 1)
        self.assertEqual(difficulty_from_climb(18 * 10, 10), 2)
        self.assertEqual(difficulty_from_climb(27 * 10, 10), 3)
        self.assertEqual(difficulty_from_climb(38 * 10, 10), 4)
        self.assertEqual(difficulty_from_climb(50 * 10, 10), 5)
        self.assertEqual(difficulty_from_climb(70 * 10, 10), 6)

    def test_flatish_real_route_is_level_0(self):
        # Mora–Orsa i rök-testet: ~87 m på ~17 km = 5,1 m/km -> ska bli nivå 0.
        self.assertEqual(difficulty_from_climb(87, 17), 0)

    def test_speed_scale(self):
        self.assertEqual(
            [speed_for_level(n) for n in range(7)],
            [20, 18, 16, 14, 12, 10, 8],
        )

    def test_zero_distance_is_safe(self):
        self.assertEqual(difficulty_from_climb(100, 0), 0)


class StageDurationTests(TestCase):
    def test_duration_matches_speed(self):
        user = User.objects.create_user('a', password='x')
        project = Project.objects.create(
            owner=user, title='Test', budget=0,
            start_date=date(2026, 7, 1), end_date=date(2026, 7, 1),
        )
        day = Day.objects.create(project=project, date=date(2026, 7, 1))
        # 40 km, platt -> 20 km/h -> 2 h -> 120 min
        stage = Stage.objects.create(
            day=day, from_point='A', to_point='B',
            distance_km=40, ascent_m=0,
        )
        self.assertEqual(stage.difficulty_level, 0)
        self.assertEqual(stage.estimated_duration_minutes, 120)


class BudgetRedistributionTests(TestCase):
    def test_underspending_increases_later_budget(self):
        user = User.objects.create_user('b', password='x')
        project = Project.objects.create(
            owner=user, title='Tur', budget=Decimal('3000'),
            start_date=date(2026, 7, 1), end_date=date(2026, 7, 3),
        )
        d1 = Day.objects.create(project=project, date=date(2026, 7, 1))
        Day.objects.create(project=project, date=date(2026, 7, 2))
        Day.objects.create(project=project, date=date(2026, 7, 3))

        # Dag 1 budget = 3000/3 = 1000. Spendera 400 -> 600 kvar fördelas.
        Cost.objects.create(day=d1, category=Cost.Category.LUNCH,
                            amount=Decimal('400'))

        data = ProjectDetailSerializer(project).data
        budgets = data['daily_budgets']
        self.assertEqual(budgets[0]['budget'], Decimal('1000.00'))
        self.assertEqual(budgets[0]['spent'], Decimal('400'))
        # Dag 2: (3000-400)/2 = 1300 -> ökat från 1000.
        self.assertEqual(budgets[1]['budget'], Decimal('1300.00'))
        # Dag 2 spenderar inget, så återstoden rullar vidare:
        # dag 3 = (2600-0)/1 = 2600.
        self.assertEqual(budgets[2]['budget'], Decimal('2600.00'))


class StatsTests(TestCase):
    def test_rest_days_excluded_from_cycling_average(self):
        user = User.objects.create_user('s', password='x')
        project = Project.objects.create(
            owner=user, title='Tur', budget=0,
            start_date=date(2026, 7, 1), end_date=date(2026, 7, 3),
        )
        d1 = Day.objects.create(project=project, date=date(2026, 7, 1))
        # Dag 2 = vilodag.
        Day.objects.create(project=project, date=date(2026, 7, 2),
                           is_rest_day=True)
        d3 = Day.objects.create(project=project, date=date(2026, 7, 3))

        Stage.objects.create(day=d1, from_point='A', to_point='B',
                             distance_km=40, ascent_m=100, descent_m=50)
        Stage.objects.create(day=d3, from_point='C', to_point='D',
                             distance_km=60, ascent_m=200, descent_m=80)

        stats = project.stats
        self.assertEqual(stats['rest_day_count'], 1)
        self.assertEqual(stats['cycling_day_count'], 2)
        self.assertEqual(stats['total_distance_km'], 100)
        self.assertEqual(stats['total_ascent_m'], 300)
        # 100 km / 2 cykeldagar = 50.
        self.assertEqual(stats['avg_km_per_cycling_day'], 50)
        self.assertEqual(stats['longest_day_km'], 60)


class CalorieTests(TestCase):
    def test_cycling_and_total_calories(self):
        user = User.objects.create_user('c', password='x')
        project = Project.objects.create(
            owner=user, title='Tur', budget=0,
            start_date=date(2026, 7, 1), end_date=date(2026, 7, 1),
            rider_gender=Project.Gender.MALE, rider_age=40,
            rider_height_cm=180, rider_weight_kg=80,
        )
        day = Day.objects.create(project=project, date=date(2026, 7, 1))
        # 40 km platt -> nivå 0 -> 20 km/h -> 2 h. MET 6.5.
        Stage.objects.create(day=day, from_point='A', to_point='B',
                             distance_km=40, ascent_m=0)

        # kcal = 6.5 * 80 * 2 = 1040
        self.assertEqual(day.cycling_calories, 1040)
        # BMR (man) = 10*80 + 6.25*180 - 5*40 + 5 = 1730
        self.assertEqual(project.bmr, 1730)
        # total = 1730*1.3 + 1040 = 3289
        self.assertEqual(day.total_calories, 3289)

    def test_no_profile_means_zero_and_none(self):
        user = User.objects.create_user('d', password='x')
        project = Project.objects.create(
            owner=user, title='Tur', budget=0,
            start_date=date(2026, 7, 1), end_date=date(2026, 7, 1),
        )
        day = Day.objects.create(project=project, date=date(2026, 7, 1))
        Stage.objects.create(day=day, from_point='A', to_point='B',
                             distance_km=40, ascent_m=0)
        self.assertEqual(day.cycling_calories, 0)
        self.assertIsNone(project.bmr)
        self.assertIsNone(day.total_calories)


class RideOutcomeTests(TestCase):
    def test_actual_cost_duration_and_navigation(self):
        from datetime import time as _t
        from .models import LogEntry
        user = User.objects.create_user('r', password='x')
        project = Project.objects.create(
            owner=user, title='Tur', budget=0,
            start_date=date(2026, 7, 1), end_date=date(2026, 7, 2),
        )
        d1 = Day.objects.create(project=project, date=date(2026, 7, 1),
                                actual_start_time=_t(9, 0),
                                actual_end_time=_t(12, 30))
        d2 = Day.objects.create(project=project, date=date(2026, 7, 2))

        LogEntry.objects.create(day=d1, kind=LogEntry.Kind.EXPENSE,
                                category='LUNCH', amount=Decimal('145'))
        LogEntry.objects.create(day=d1, kind=LogEntry.Kind.EXPENSE,
                                category='DRICKA', amount=Decimal('35'))
        LogEntry.objects.create(day=d1, kind=LogEntry.Kind.NOTE,
                                text='Punktering')

        self.assertEqual(d1.actual_cost, Decimal('180'))
        self.assertEqual(d1.actual_duration_minutes, 210)  # 09:00-12:30
        # Navigation mellan dagar.
        self.assertEqual(d1.next_day_id, d2.id)
        self.assertIsNone(d1.prev_day_id)
        self.assertEqual(d2.prev_day_id, d1.id)


class ApiFlowTests(TestCase):
    """End-to-end-test av API:et som frontenden använder."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user('cyklist', password='hemligt')
        self.client.force_authenticate(self.user)

    def test_create_project_generates_days(self):
        resp = self.client.post('/api/projects/', {
            'title': 'Sommartur',
            'budget': '3000',
            'start_date': '2026-07-01',
            'end_date': '2026-07-03',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        pid = resp.data['id']
        # 3 datum -> 3 dagar genererade automatiskt.
        self.assertEqual(Day.objects.filter(project_id=pid).count(), 3)

    def test_full_day_flow_and_budget(self):
        project = Project.objects.create(
            owner=self.user, title='Tur', budget=Decimal('3000'),
            start_date=date(2026, 7, 1), end_date=date(2026, 7, 2),
        )
        day = Day.objects.create(project=project, date=date(2026, 7, 1))

        # Lägg till en kostnad via API.
        resp = self.client.post('/api/costs/', {
            'day': day.id, 'category': 'LUNCH', 'amount': '250',
        }, format='json')
        self.assertEqual(resp.status_code, 201)

        # Projektdetaljen visar summering och dagsbudget.
        detail = self.client.get(f'/api/projects/{project.id}/').data
        self.assertEqual(str(detail['total_cost']), '250.00')
        self.assertEqual(len(detail['daily_budgets']), 1)

    def test_create_empty_stage(self):
        # Etapper skapas tomma och fylls i efterhand -> ska ge 201, inte 400.
        project = Project.objects.create(
            owner=self.user, title='Tur', budget=0,
            start_date=date(2026, 7, 1), end_date=date(2026, 7, 1),
        )
        day = Day.objects.create(project=project, date=date(2026, 7, 1))
        resp = self.client.post('/api/stages/', {
            'day': day.id, 'order': 0,
            'from_point': '', 'to_point': '', 'waypoints': [],
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_cannot_see_other_users_projects(self):
        other = User.objects.create_user('annan', password='x')
        Project.objects.create(
            owner=other, title='Hemlig', budget=0,
            start_date=date(2026, 7, 1), end_date=date(2026, 7, 1),
        )
        resp = self.client.get('/api/projects/')
        self.assertEqual(len(resp.data), 0)

    @override_settings(ORS_API_KEY='')
    def test_calculate_without_ors_key_returns_clear_error(self):
        project = Project.objects.create(
            owner=self.user, title='Tur', budget=0,
            start_date=date(2026, 7, 1), end_date=date(2026, 7, 1),
        )
        day = Day.objects.create(project=project, date=date(2026, 7, 1))
        stage = Stage.objects.create(
            day=day, from_point='A', to_point='B',
            waypoints=[[15.0, 60.0], [15.5, 60.5]],
        )
        resp = self.client.post(f'/api/stages/{stage.id}/calculate/', {}, format='json')
        # Utan API-nyckel ska felet vara tydligt, inte en krasch.
        self.assertEqual(resp.status_code, 400)
        self.assertIn('ORS_API_KEY', resp.data['detail'])
