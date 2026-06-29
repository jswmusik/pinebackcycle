"""Datamodell för cykelsemesterplaneraren.

Hierarki: User -> Project -> Day -> (Stage, Cost)
"""
from django.contrib.auth.models import AbstractUser
from django.db import models


# --- Svårighetsskala ---------------------------------------------------------
# Nivå 0-6 baserat på stigning per km. Varje nivå sänker snitthastigheten 2 km/h.
DIFFICULTY_SPEED_KMH = {0: 20, 1: 18, 2: 16, 3: 14, 4: 12, 5: 10, 6: 8}

# Kumulativ stigning (meter per km) -> svårighetsnivå.
# ORS summerar ALL stigning längs rutten, så även "platta" rutter får några
# m/km. Trösklarna är därför satta efter hur cykling faktiskt känns:
#   < 8   m/km  Nivå 0  Platt (cykelbanor, sjönära, dalgångar)   20 km/h
#   8-15  m/km  Nivå 1  Lätt (svagt böljande landsbygd)          18 km/h
#   15-22 m/km  Nivå 2  Lätt-medel (böljande)                    16 km/h
#   22-32 m/km  Nivå 3  Medel (kuperat)                          14 km/h
#   32-45 m/km  Nivå 4  Medel-tung (rejält kuperat)              12 km/h
#   45-60 m/km  Nivå 5  Tung (bergigt)                           10 km/h
#   > 60  m/km  Nivå 6  Mycket tung (alpint)                      8 km/h
DIFFICULTY_THRESHOLDS_M_PER_KM = [8, 15, 22, 32, 45, 60]


def difficulty_from_climb(ascent_m, distance_km):
    """Räkna ut svårighetsnivå (0-6) från total stigning och distans."""
    if not distance_km or distance_km <= 0:
        return 0
    climb_per_km = (ascent_m or 0) / distance_km
    level = 0
    for threshold in DIFFICULTY_THRESHOLDS_M_PER_KM:
        if climb_per_km >= threshold:
            level += 1
        else:
            break
    return level


def speed_for_level(level):
    """Snitthastighet (km/h) för en given svårighetsnivå."""
    return DIFFICULTY_SPEED_KMH.get(level, DIFFICULTY_SPEED_KMH[6])


# --- Kaloriberäkning ---------------------------------------------------------
# MET (Metabolic Equivalent of Task) per svårighetsnivå för lastad turcykling.
# Högre nivå = brantare/tyngre = högre MET, trots lägre fart.
# kcal = MET × vikt(kg) × tid(timmar).
CALORIE_MET_BY_LEVEL = {0: 6.5, 1: 7.0, 2: 7.5, 3: 8.5, 4: 9.5, 5: 11.0, 6: 13.0}

# Faktor för vardagsaktivitet utanför cykeln (lätt aktiv på semester).
OFF_BIKE_ACTIVITY_FACTOR = 1.3


def met_for_level(level):
    return CALORIE_MET_BY_LEVEL.get(level, CALORIE_MET_BY_LEVEL[6])


class User(AbstractUser):
    """Användare med en roll. Superadmin skapar vanliga användare."""

    class Role(models.TextChoices):
        SUPERADMIN = 'SUPERADMIN', 'Superadmin'
        USER = 'USER', 'Användare'

    role = models.CharField(
        max_length=20, choices=Role.choices, default=Role.USER
    )

    def __str__(self):
        return self.get_full_name() or self.username


class Project(models.Model):
    """En cykelsemester."""

    class Gender(models.TextChoices):
        MALE = 'M', 'Man'
        FEMALE = 'F', 'Kvinna'
        OTHER = 'O', 'Annat / vill ej ange'

    owner = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='projects'
    )
    title = models.CharField(max_length=200)
    budget = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text='Total budget för hela semestern (kr).'
    )
    start_date = models.DateField()
    end_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    # Cyklistprofil för kaloriberäkning (per resa).
    rider_gender = models.CharField(
        max_length=1, choices=Gender.choices, blank=True
    )
    rider_age = models.PositiveIntegerField(null=True, blank=True)
    rider_height_cm = models.PositiveIntegerField(null=True, blank=True)
    rider_weight_kg = models.FloatField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title

    # --- Beräkningar ---------------------------------------------------------
    @property
    def total_distance_km(self):
        return round(sum(d.distance_km for d in self.days.all()), 2)

    @property
    def total_cost(self):
        return sum((d.total_cost for d in self.days.all()), 0)

    @property
    def budget_remaining(self):
        return self.budget - self.total_cost

    @property
    def day_count(self):
        return self.days.count()

    @property
    def has_calorie_profile(self):
        """Minst vikt krävs för att beräkna cykelförbränning."""
        return bool(self.rider_weight_kg)

    @property
    def bmr(self):
        """Basförbränning (kcal/dygn) enligt Mifflin-St Jeor.

        Kräver vikt, längd och ålder. Returnerar None om något saknas.
        """
        if not (self.rider_weight_kg and self.rider_height_cm
                and self.rider_age):
            return None
        base = (10 * float(self.rider_weight_kg)
                + 6.25 * self.rider_height_cm - 5 * self.rider_age)
        if self.rider_gender == self.Gender.MALE:
            return round(base + 5)
        if self.rider_gender == self.Gender.FEMALE:
            return round(base - 161)
        return round(base - 78)  # genomsnitt om kön ej angetts

    @property
    def stats(self):
        """Samlad statistik/KPI:er för hela resan."""
        days = list(self.days.all())
        stages = [s for d in days for s in d.stages.all()]

        total_km = round(sum(s.distance_km or 0 for s in stages), 2)
        total_ascent = round(sum(s.ascent_m or 0 for s in stages))
        total_descent = round(sum(s.descent_m or 0 for s in stages))
        total_minutes = sum(s.estimated_duration_minutes for s in stages)

        rest_days = sum(1 for d in days if d.is_rest_day)
        cycling_days = sum(1 for d in days if not d.is_rest_day)

        # Distansviktad genomsnittlig svårighetsgrad.
        if total_km > 0:
            weighted = sum(
                s.difficulty_level * (s.distance_km or 0) for s in stages
            )
            avg_difficulty = round(weighted / total_km, 1)
        else:
            avg_difficulty = 0

        day_distances = [(d, d.distance_km) for d in days]
        longest = max(day_distances, key=lambda t: t[1], default=(None, 0))
        total_cost = self.total_cost

        # Högsta punkt över havet ur ruttgeometrin.
        highest = 0
        for s in stages:
            geom = s.route_geometry or {}
            for c in geom.get('coordinates', []):
                if len(c) >= 3 and c[2] > highest:
                    highest = c[2]

        # Landsstatistik: km, andel, etapper och (proportionell) stigning.
        countries = {}
        for s in stages:
            stage_km = sum(c['km'] for c in (s.countries or [])) or 1
            for c in (s.countries or []):
                entry = countries.setdefault(c['code'], {
                    'code': c['code'], 'name': c['name'],
                    'km': 0, 'stage_count': 0, 'ascent_m': 0,
                })
                entry['km'] += c['km']
                entry['stage_count'] += 1
                entry['ascent_m'] += (s.ascent_m or 0) * (c['km'] / stage_km)
        country_list = []
        for c in sorted(countries.values(), key=lambda x: -x['km']):
            country_list.append({
                'code': c['code'],
                'name': c['name'],
                'km': round(c['km'], 1),
                'stage_count': c['stage_count'],
                'ascent_m': round(c['ascent_m']),
                'percent': round(c['km'] / total_km * 100) if total_km else 0,
            })

        # Kalorier
        total_cycling_cal = sum(d.cycling_calories for d in days)
        if self.bmr is not None:
            total_cal = sum(d.total_calories for d in days)
        else:
            total_cal = None

        # Verkligt utfall (loggat under resan)
        actual_cost = sum((d.actual_cost for d in days), 0)
        actual_distance = round(
            sum(d.actual_distance_km or 0 for d in days), 2
        )
        actual_duration = sum(d.actual_duration_minutes or 0 for d in days)

        return {
            'total_distance_km': total_km,
            'total_ascent_m': total_ascent,
            'total_descent_m': total_descent,
            'total_duration_minutes': total_minutes,
            'cycling_day_count': cycling_days,
            'rest_day_count': rest_days,
            'avg_km_per_cycling_day': (
                round(total_km / cycling_days, 1) if cycling_days else 0
            ),
            'avg_difficulty': avg_difficulty,
            'longest_day_km': round(longest[1], 2),
            'longest_day_date': longest[0].date if longest[0] else None,
            'highest_point_m': round(highest),
            'stage_count': len(stages),
            'cost_per_km': (
                round(float(total_cost) / total_km, 1) if total_km else 0
            ),
            'avg_cost_per_day': (
                round(float(total_cost) / len(days), 0) if days else 0
            ),
            'countries': country_list,
            'country_count': len(country_list),
            # Kalorier
            'has_calorie_profile': self.has_calorie_profile,
            'bmr': self.bmr,
            'total_cycling_calories': total_cycling_cal,
            'avg_cycling_calories_per_cycling_day': (
                round(total_cycling_cal / cycling_days) if cycling_days else 0
            ),
            'total_calories': total_cal,
            # Planerat vs verkligt
            'planned_total_cost': float(total_cost),
            'actual_total_cost': float(actual_cost),
            'planned_duration_minutes': total_minutes,
            'actual_duration_minutes': actual_duration,
            'actual_distance_km': actual_distance,
        }


class Day(models.Model):
    """En dag i semestern med boende och kostnader."""

    class Accommodation(models.TextChoices):
        VILDCAMP = 'VILDCAMP', 'Vildcamping (gratis)'
        CAMPING = 'CAMPING', 'Camping (betald)'
        HOTELL = 'HOTELL', 'Hotell (betald)'
        VANDRARHEM = 'VANDRARHEM', 'Vandrarhem (betald)'
        VANNER = 'VANNER', 'Hos vänner (gratis)'

    # Boendetyper som inte kostar något.
    FREE_ACCOMMODATION = {Accommodation.VILDCAMP, Accommodation.VANNER}

    project = models.ForeignKey(
        Project, on_delete=models.CASCADE, related_name='days'
    )
    date = models.DateField()
    is_rest_day = models.BooleanField(
        default=False, help_text='Vilodag – ingen cykling denna dag.'
    )
    accommodation_type = models.CharField(
        max_length=20, choices=Accommodation.choices, blank=True
    )
    accommodation_link = models.URLField(blank=True)
    notes = models.TextField(blank=True)

    # Verkligt utfall (loggas under cykeldagen i cykelläget).
    actual_distance_km = models.FloatField(null=True, blank=True)
    actual_start_time = models.TimeField(null=True, blank=True)
    actual_end_time = models.TimeField(null=True, blank=True)
    # Inspelat GPS-spår: lista av [lng, lat]-punkter.
    actual_track = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ['date']
        unique_together = ['project', 'date']

    def __str__(self):
        return f'{self.project.title} – {self.date}'

    @property
    def weekday(self):
        """Veckodag på svenska."""
        names = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag',
                 'Fredag', 'Lördag', 'Söndag']
        return names[self.date.weekday()]

    @property
    def is_accommodation_free(self):
        return self.accommodation_type in self.FREE_ACCOMMODATION

    @property
    def distance_km(self):
        return round(sum(s.distance_km or 0 for s in self.stages.all()), 2)

    @property
    def total_cost(self):
        return sum((c.amount for c in self.costs.all()), 0)

    @property
    def cycling_calories(self):
        """Kalorier förbrända på cykeln denna dag (0 på vilodagar)."""
        if self.is_rest_day:
            return 0
        return sum(s.calories for s in self.stages.all())

    @property
    def total_calories(self):
        """Total dagsförbränning: BMR × vardagsfaktor + cykling.

        None om cyklistprofilen (vikt/längd/ålder) är ofullständig.
        """
        bmr = self.project.bmr
        if bmr is None:
            return None
        return round(bmr * OFF_BIKE_ACTIVITY_FACTOR + self.cycling_calories)

    # --- Verkligt utfall -----------------------------------------------------
    @property
    def planned_duration_minutes(self):
        return sum(s.estimated_duration_minutes for s in self.stages.all())

    @property
    def actual_cost(self):
        """Summa av loggade utgifter under dagen."""
        return sum(
            (e.amount for e in self.logs.all()
             if e.amount and e.kind == LogEntry.Kind.EXPENSE),
            0,
        )

    @property
    def actual_duration_minutes(self):
        """Faktisk cykeltid ur loggade start/sluttider (hanterar midnatt)."""
        if not (self.actual_start_time and self.actual_end_time):
            return None
        from datetime import date as _date, datetime
        start = datetime.combine(_date.min, self.actual_start_time)
        end = datetime.combine(_date.min, self.actual_end_time)
        diff = (end - start).total_seconds() / 60
        if diff < 0:
            diff += 24 * 60
        return round(diff)

    @property
    def prev_day_id(self):
        prev = (self.project.days.filter(date__lt=self.date)
                .order_by('-date').first())
        return prev.id if prev else None

    @property
    def next_day_id(self):
        nxt = (self.project.days.filter(date__gt=self.date)
               .order_by('date').first())
        return nxt.id if nxt else None


class Stage(models.Model):
    """En etapp inom en dag (från -> till, eventuellt via stopp)."""

    class Profile(models.TextChoices):
        REGULAR = 'regular', 'Vanlig cykel'
        ROAD = 'road', 'Landsväg'
        MOUNTAIN = 'mountain', 'Mountainbike'
        ELECTRIC = 'electric', 'Elcykel'

    day = models.ForeignKey(
        Day, on_delete=models.CASCADE, related_name='stages'
    )
    order = models.PositiveIntegerField(default=0)
    from_point = models.CharField(max_length=200, blank=True)
    to_point = models.CharField(max_length=200, blank=True)
    # Landskod (ISO-2) för start- respektive slutpunkt – för att visa flagga.
    from_country = models.CharField(max_length=2, blank=True)
    to_country = models.CharField(max_length=2, blank=True)
    # Senast autofyllda ortnamn – används för att veta om användaren skrivit
    # ett eget namn (då rör vi det inte) eller om vi får uppdatera det.
    auto_from = models.CharField(max_length=200, blank=True)
    auto_to = models.CharField(max_length=200, blank=True)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    profile = models.CharField(
        max_length=20, choices=Profile.choices, default=Profile.REGULAR
    )

    # GeoJSON-koordinatlista [[lng, lat], ...] för rutten som ritats på kartan.
    waypoints = models.JSONField(default=list, blank=True)

    # Hämtas från OpenRouteService.
    distance_km = models.FloatField(null=True, blank=True)
    ascent_m = models.FloatField(null=True, blank=True)
    descent_m = models.FloatField(null=True, blank=True)
    route_geometry = models.JSONField(null=True, blank=True)
    # Sväng-för-sväng-instruktioner: [{instruction, name, distance, type, way_point}].
    route_steps = models.JSONField(default=list, blank=True)
    # Km per land längs etappen: [{code, name, km}].
    countries = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f'{self.from_point} → {self.to_point}'

    @property
    def difficulty_level(self):
        return difficulty_from_climb(self.ascent_m, self.distance_km)

    @property
    def climb_per_km(self):
        """Kumulativ stigning per km – grunden för svårighetsnivån."""
        if not self.distance_km or self.distance_km <= 0:
            return 0
        return round((self.ascent_m or 0) / self.distance_km, 1)

    @property
    def average_speed_kmh(self):
        return speed_for_level(self.difficulty_level)

    @property
    def estimated_duration_minutes(self):
        """Beräknad cykeltid i minuter utifrån distans och svårighet."""
        if not self.distance_km:
            return 0
        hours = self.distance_km / self.average_speed_kmh
        return round(hours * 60)

    @property
    def calories(self):
        """Förbrända kalorier på etappen: MET × vikt × timmar."""
        weight = self.day.project.rider_weight_kg
        if not weight or not self.distance_km:
            return 0
        hours = self.estimated_duration_minutes / 60
        return round(met_for_level(self.difficulty_level) * float(weight) * hours)


class Cost(models.Model):
    """En kostnadspost för en dag."""

    class Category(models.TextChoices):
        RESA = 'RESA', 'Resa'
        BOENDE = 'BOENDE', 'Boende'
        SERVICE = 'SERVICE', 'Service'
        NOJE = 'NOJE', 'Nöje'
        FRUKOST = 'FRUKOST', 'Frukost'
        LUNCH = 'LUNCH', 'Lunch'
        MIDDAG = 'MIDDAG', 'Middag'
        KVALLSMAT = 'KVALLSMAT', 'Kvällsmat'
        MELLANMAL = 'MELLANMAL', 'Mellanmål'
        DRICKA = 'DRICKA', 'Dricka'

    day = models.ForeignKey(
        Day, on_delete=models.CASCADE, related_name='costs'
    )
    category = models.CharField(max_length=20, choices=Category.choices)
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        ordering = ['category']

    def __str__(self):
        return f'{self.get_category_display()}: {self.amount} kr'


class LogEntry(models.Model):
    """En tidsstämplad loggpost som registreras under cykeldagen."""

    class Kind(models.TextChoices):
        EXPENSE = 'EXPENSE', 'Utgift'
        NOTE = 'NOTE', 'Anteckning'
        INCIDENT = 'INCIDENT', 'Händelse'

    day = models.ForeignKey(
        Day, on_delete=models.CASCADE, related_name='logs'
    )
    kind = models.CharField(
        max_length=10, choices=Kind.choices, default=Kind.NOTE
    )
    text = models.CharField(max_length=300, blank=True)
    # Endast för utgifter:
    category = models.CharField(
        max_length=20, choices=Cost.Category.choices, blank=True
    )
    amount = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        verbose_name_plural = 'log entries'

    def __str__(self):
        return f'{self.get_kind_display()} {self.created_at:%H:%M}'
