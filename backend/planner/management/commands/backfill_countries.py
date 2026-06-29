"""Engångsuppdatering: fyll i landskoder + landsuppdelning för redan
beräknade etapper (så att flaggor och 'Länder på resan' fungerar för
befintlig data).

Kör:  python manage.py backfill_countries
"""
import time

from django.core.management.base import BaseCommand

from planner.models import Stage
from planner.services import country_breakdown, reverse_place


class Command(BaseCommand):
    help = 'Fyller i landskoder och landsuppdelning för befintliga etapper.'

    def handle(self, *args, **options):
        updated = 0
        stages = Stage.objects.all()
        for stage in stages:
            wps = stage.waypoints or []
            if not wps:
                continue

            changed = False

            if not stage.from_country:
                name, cc = reverse_place(wps[0][1], wps[0][0])
                if cc:
                    stage.from_country = cc
                    changed = True
                if name and not stage.from_point:
                    stage.from_point = name
                time.sleep(1)  # respektera Nominatims hastighetsgräns

            if not stage.to_country:
                name, cc = reverse_place(wps[-1][1], wps[-1][0])
                if cc:
                    stage.to_country = cc
                    changed = True
                if name and not stage.to_point:
                    stage.to_point = name
                time.sleep(1)

            if not stage.countries and stage.route_geometry:
                try:
                    breakdown = country_breakdown(stage.route_geometry)
                    if breakdown:
                        stage.countries = breakdown
                        changed = True
                except Exception:  # noqa: BLE001 – bonusdata, aldrig fatal
                    pass

            if changed:
                stage.save()
                updated += 1
                msg = (
                    f'Etapp {stage.id}: {stage.from_country} '
                    f'{stage.from_point} -> {stage.to_country} {stage.to_point}'
                )
                # Windows-konsolen (cp1252) kan sakna vissa tecken – låt aldrig
                # utskriften stoppa uppdateringen.
                try:
                    self.stdout.write(msg)
                except UnicodeEncodeError:
                    self.stdout.write(f'Etapp {stage.id}: uppdaterad')

        self.stdout.write(self.style.SUCCESS(
            f'Klart. {updated} etapper uppdaterade.'
        ))
