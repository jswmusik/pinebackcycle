"""API-vyer."""
from datetime import timedelta

from django.contrib.auth import authenticate, login, logout
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils.decorators import method_decorator
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import Cost, Day, LogEntry, Project, Stage
from .serializers import (
    CostSerializer,
    DaySerializer,
    LogEntrySerializer,
    ProjectDetailSerializer,
    ProjectListSerializer,
    StageSerializer,
)
from .services import (
    ORSError,
    country_breakdown,
    day_conditions,
    get_route,
    reverse_place,
)


# --- Autentisering -----------------------------------------------------------
@ensure_csrf_cookie
@api_view(['GET'])
@permission_classes([AllowAny])
def csrf_view(request):
    """Sätter csrftoken-cookien. Frontenden anropar denna vid uppstart."""
    return Response({'detail': 'CSRF-cookie satt.'})


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    username = request.data.get('username')
    password = request.data.get('password')
    user = authenticate(request, username=username, password=password)
    if user is None:
        return Response(
            {'detail': 'Fel användarnamn eller lösenord.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    login(request, user)
    return Response(_user_payload(user))


@api_view(['POST'])
def logout_view(request):
    logout(request)
    return Response({'detail': 'Utloggad.'})


@api_view(['GET'])
def me_view(request):
    return Response(_user_payload(request.user))


@api_view(['POST'])
def route_view(request):
    """Beräkna en ad-hoc-rutt (för auto-omräkning i navigatorn)."""
    coords = request.data.get('coordinates') or []
    profile = request.data.get('profile') or 'regular'
    try:
        route = get_route(coords, profile=profile)
    except ORSError as exc:
        return Response({'detail': str(exc)},
                        status=status.HTTP_400_BAD_REQUEST)
    return Response({
        'geometry': route['geometry'],
        'steps': route['steps'],
        'distance_km': route['distance_km'],
    })


def _user_payload(user):
    return {
        'id': user.id,
        'username': user.username,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'role': user.role,
        'is_superadmin': user.role == user.Role.SUPERADMIN or user.is_superuser,
    }


# --- Projekt -----------------------------------------------------------------
class ProjectViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # Varje användare ser bara sina egna projekt.
        return Project.objects.filter(owner=self.request.user)

    def get_serializer_class(self):
        if self.action == 'list':
            return ProjectListSerializer
        return ProjectDetailSerializer

    def perform_create(self, serializer):
        project = serializer.save(owner=self.request.user)
        self._generate_days(project)

    def _generate_days(self, project):
        """Skapa en Day per datum i intervallet start_date..end_date."""
        current = project.start_date
        while current <= project.end_date:
            Day.objects.get_or_create(project=project, date=current)
            current += timedelta(days=1)

    @action(detail=True, methods=['post'])
    def regenerate_days(self, request, pk=None):
        """Synka dagar mot (eventuellt ändrade) datum utan att förlora data."""
        project = self.get_object()
        wanted = set()
        current = project.start_date
        while current <= project.end_date:
            wanted.add(current)
            Day.objects.get_or_create(project=project, date=current)
            current += timedelta(days=1)
        # Ta bort dagar som hamnat utanför intervallet.
        project.days.exclude(date__in=wanted).delete()
        serializer = ProjectDetailSerializer(project)
        return Response(serializer.data)


# --- Dagar -------------------------------------------------------------------
class DayViewSet(viewsets.ModelViewSet):
    serializer_class = DaySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Day.objects.filter(project__owner=self.request.user)

    @action(detail=True, methods=['get'])
    def conditions(self, request, pk=None):
        """Dagens förutsättningar: väder + vind längs rutten + förväntad stat."""
        return Response(day_conditions(self.get_object()))


# --- Etapper -----------------------------------------------------------------
class StageViewSet(viewsets.ModelViewSet):
    serializer_class = StageSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Stage.objects.filter(day__project__owner=self.request.user)

    def perform_create(self, serializer):
        stage = serializer.save()
        # UX: en ny etapp startar där den föregående slutade (även över dagar).
        if not stage.waypoints:
            candidates = (
                Stage.objects
                .filter(day__project=stage.day.project)
                .exclude(id=stage.id)
                .select_related('day')
                .order_by('-day__date', '-order')
            )
            for prev in candidates:
                if (prev.day.date, prev.order) >= (stage.day.date, stage.order):
                    continue
                if prev.waypoints:
                    stage.waypoints = [prev.waypoints[-1]]
                    if prev.to_point and not stage.from_point:
                        stage.from_point = prev.to_point
                    stage.save()
                    break

    @action(detail=True, methods=['post'])
    def calculate(self, request, pk=None):
        """Hämta km/höjd från ORS utifrån etappens waypoints."""
        stage = self.get_object()
        # Använd etappens sparade profil, men tillåt override i anropet.
        profile = request.data.get('profile') or stage.profile
        try:
            route = get_route(stage.waypoints, profile=profile)
        except ORSError as exc:
            return Response({'detail': str(exc)},
                            status=status.HTTP_400_BAD_REQUEST)
        stage.distance_km = route['distance_km']
        stage.ascent_m = route['ascent_m']
        stage.descent_m = route['descent_m']
        stage.route_geometry = route['geometry']
        stage.route_steps = route.get('steps', [])
        # Autofyll Från/Till från kartans start/slut. Uppdatera om fältet är
        # tomt eller fortfarande matchar det vi autofyllde sist (dvs användaren
        # har inte skrivit ett eget namn). Egna namn lämnas orörda.
        wps = stage.waypoints or []
        if wps:
            new_from, from_cc = reverse_place(wps[0][1], wps[0][0])
            if from_cc:
                stage.from_country = from_cc
            if new_from:
                if not stage.from_point or stage.from_point == stage.auto_from:
                    stage.from_point = new_from
                stage.auto_from = new_from
            new_to, to_cc = reverse_place(wps[-1][1], wps[-1][0])
            if to_cc:
                stage.to_country = to_cc
            if new_to:
                if not stage.to_point or stage.to_point == stage.auto_to:
                    stage.to_point = new_to
                stage.auto_to = new_to
        # Landsuppslag är en bonus – låt aldrig det fälla beräkningen.
        try:
            stage.countries = country_breakdown(route['geometry'])
        except Exception:
            stage.countries = []
        stage.save()
        return Response(StageSerializer(stage).data)


# --- Kostnader ---------------------------------------------------------------
class CostViewSet(viewsets.ModelViewSet):
    serializer_class = CostSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Cost.objects.filter(day__project__owner=self.request.user)


# --- Loggbok -----------------------------------------------------------------
class LogEntryViewSet(viewsets.ModelViewSet):
    serializer_class = LogEntrySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return LogEntry.objects.filter(day__project__owner=self.request.user)
