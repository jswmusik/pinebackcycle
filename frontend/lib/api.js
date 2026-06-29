// Liten API-klient mot Django-backenden.
// Hanterar session-cookies (credentials) och CSRF-token för mutationer.

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000/api';

function getCookie(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return match ? decodeURIComponent(match.pop()) : null;
}

// Hämtar csrftoken-cookien (sätts av /auth/csrf/ vid uppstart).
export async function ensureCsrf() {
  if (!getCookie('csrftoken')) {
    await fetch(`${BASE}/auth/csrf/`, { credentials: 'include' });
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (method !== 'GET') {
    await ensureCsrf();
    const token = getCookie('csrftoken');
    if (token) headers['X-CSRFToken'] = token;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* tomt svar */
  }

  if (!res.ok) {
    const message = data?.detail || `Fel ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' }),
};

// --- Bekvämlighetsfunktioner -------------------------------------------------
export const auth = {
  me: () => api.get('/auth/me/'),
  login: (username, password) =>
    api.post('/auth/login/', { username, password }),
  logout: () => api.post('/auth/logout/', {}),
};
