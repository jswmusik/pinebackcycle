"""Engångsuppdatering: hämta sväng-för-sväng-instruktioner för redan
beräknade etapper (så navigatorn kan visa svängar utan att man räknar om
manuellt).

Kör:  python manage.py backfill_steps
"""
import time

from django.core.management.base import BaseCommand

from planner.models import Stage
from planner.services import ORSError, get_route


class Command(BaseCommand):
    help = 'Hämtar sväng-instruktioner (route_steps) för befintliga etapper.'

    def handle(self, *args, **options):
        updated = 0
        for stage in Stage.objects.all():
            wps = stage.waypoints or []
            if len(wps) < 2 or stage.route_steps:
                continue
            try:
                route = get_route(wps, profile=stage.profile)
            except ORSError as exc:
                self.stdout.write(f'Etapp {stage.id}: hoppar ({exc})')
                continue
            stage.route_geometry = route['geometry']
            stage.route_steps = route['steps']
            stage.distance_km = route['distance_km']
            stage.ascent_m = route['ascent_m']
            stage.descent_m = route['descent_m']
            stage.save()
            updated += 1
            try:
                self.stdout.write(
                    f'Etapp {stage.id}: {len(route["steps"])} svängar'
                )
            except UnicodeEncodeError:
                self.stdout.write(f'Etapp {stage.id}: uppdaterad')
            time.sleep(1)  # respektera ORS

        self.stdout.write(self.style.SUCCESS(
            f'Klart. {updated} etapper fick sväng-instruktioner.'
        ))
