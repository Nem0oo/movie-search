const BASE_URL = 'https://api.themoviedb.org/3';

const qs = (sel, el = document) => el.querySelector(sel);
const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const escHtml = str => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function serializeForm(form) {
  const data = new Map();

  ['with_origin_country', 'primary_release_year', 'with_runtime.gte', 'with_runtime.lte']
    .forEach(name => {
      const el = qs(`[name="${CSS.escape(name)}"]`, form);
      if (el && el.value !== '') data.set(name, el.value);
    });

  // Bornes exclusives : l'API filtre par date exacte, pas par année
  const minEl = qs('[name="primary_release_date.gte"]', form);
  const maxEl = qs('[name="primary_release_date.lte"]', form);
  let yMin = minEl && minEl.value ? parseInt(minEl.value, 10) : null;
  let yMax = maxEl && maxEl.value ? parseInt(maxEl.value, 10) : null;
  if (Number.isInteger(yMin)) yMin = yMin + 1;
  if (Number.isInteger(yMax)) yMax = yMax - 1;
  if (Number.isInteger(yMin)) data.set('primary_release_date.gte', `${String(yMin).padStart(4, '0')}-01-01`);
  if (Number.isInteger(yMax)) data.set('primary_release_date.lte', `${String(yMax).padStart(4, '0')}-12-31`);
  if (Number.isInteger(yMin) && Number.isInteger(yMax) && yMin > yMax) {
    data.delete('primary_release_date.gte');
    data.delete('primary_release_date.lte');
  }

  const includedGenres = qsa('.genre-toggle[data-state="include"]', form).map(btn => btn.dataset.genreId);
  const excludedGenres = qsa('.genre-toggle[data-state="exclude"]', form).map(btn => btn.dataset.genreId);
  if (includedGenres.length) data.set('with_genres', includedGenres.join(','));
  if (excludedGenres.length) data.set('without_genres', excludedGenres.join(','));

  for (const key of ['with_cast', 'with_companies']) {
    const cont = qs(`.chips-input[data-name="${key}"]`, form);
    if (!cont) continue;
    const ids = (cont.dataset.ids || '').split(',').filter(Boolean);
    if (ids.length) data.set(key, ids.join(','));
  }

  const params = new URLSearchParams();
  for (const [k, v] of data) params.set(k, v);
  return params;
}

function debounce(fn, delay = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}
const autoSubmit = debounce(() => {
  const form = document.getElementById('search-form');
  if (form) form.requestSubmit();
}, 250);

function updatePreview() {
  const params = serializeForm(document.getElementById('search-form'));
  const base = `${BASE_URL}/discover/movie`;
  qs('#preview').textContent = params.toString() ? `${base}?${params.toString()}` : '(vide)';
}

function initChipsInput(containerId, { fetchSuggestions }) {
  const container = document.getElementById(containerId);
  const input = container.querySelector('input[type="text"]');
  const list = container.querySelector('.suggestions');
  container.dataset.ids = container.dataset.ids || '';

  function addChip(item) {
    const current = new Set((container.dataset.ids || '').split(',').filter(Boolean));
    if (current.has(String(item.id))) return;
    current.add(String(item.id));
    container.dataset.ids = Array.from(current).join(',');

    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.id = item.id;
    chip.innerHTML = `<span>${escHtml(item.name)}</span><button type="button" aria-label="Retirer ${escHtml(item.name)}">✕</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      chip.remove();
      const left = (container.dataset.ids || '').split(',').filter(Boolean).filter(id => id !== String(item.id));
      container.dataset.ids = left.join(',');
      updatePreview();
      autoSubmit();
    });
    container.insertBefore(chip, input);
    input.value = '';
    hideSuggestions();
    updatePreview();
    autoSubmit();
  }

  function showSuggestions(items) {
    list.innerHTML = '';
    items.forEach(it => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.innerHTML = `<span>${escHtml(it.name)}</span><span class="s-id">#${escHtml(it.id)}</span>`;
      li.addEventListener('click', () => addChip(it));
      list.appendChild(li);
    });
    list.classList.toggle('visible', items.length > 0);
    input.setAttribute('aria-expanded', String(items.length > 0));
  }

  function hideSuggestions() {
    list.classList.remove('visible');
    input.setAttribute('aria-expanded', 'false');
  }

  input.addEventListener('input', async () => {
    const q = input.value.trim();
    if (q.length < 2) { hideSuggestions(); return; }
    const items = await fetchSuggestions(q);
    showSuggestions(items);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') list.classList.remove('visible');
  });

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) list.classList.remove('visible');
  });

  return { addChip };
}

async function loadGenres() {
  const container = qs('#genres');
  try {
    const url = `${BASE_URL}/genre/movie/list?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=fr-FR`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data.genres) ? data.genres : [];
    container.innerHTML = '';
    if (!list.length) {
      container.innerHTML = '<div class="help" style="grid-column:1/-1;">Aucun genre reçu.</div>';
      return;
    }
    list.forEach(g => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'genre-toggle';
      btn.dataset.genreId = String(g.id);
      btn.dataset.name = g.name;
      btn.dataset.state = 'neutral';
      btn.textContent = g.name;
      btn.addEventListener('click', () => {
        const states = ['neutral', 'include', 'exclude'];
        const next = states[(states.indexOf(btn.dataset.state) + 1) % states.length];
        btn.dataset.state = next;
        const prefixes = { neutral: '', include: '+ ', exclude: '− ' };
        btn.textContent = prefixes[next] + btn.dataset.name;
        updatePreview();
        autoSubmit();
      });
      container.appendChild(btn);
    });
  } catch (err) {
    container.innerHTML = `<div class="help" style="grid-column:1/-1;color:#ffb3b3;">Erreur de chargement des genres : ${err.message}</div>`;
  }
}

const peopleCache = new Map();
async function tmdbPeopleSuggestions(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  if (peopleCache.has(key)) return peopleCache.get(key);

  const url = `${BASE_URL}/search/person?api_key=${encodeURIComponent(TMDB_API_KEY)}&query=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const out = (data.results || []).slice(0, 5).map(p => ({ id: p.id, name: p.name }));
    peopleCache.set(key, out);
    return out;
  } catch { return []; }
}

const companyCache = new Map();
async function tmdbCompanySuggestions(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  if (companyCache.has(key)) return companyCache.get(key);

  const url = `${BASE_URL}/search/company?api_key=${encodeURIComponent(TMDB_API_KEY)}&query=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const out = (data.results || []).slice(0, 5).map(c => ({ id: c.id, name: c.name }));
    companyCache.set(key, out);
    return out;
  } catch { return []; }
}

const IMG_BASE = 'https://image.tmdb.org/t/p/w185';

function createMovieItem(m) {
  const poster = m.poster_path ? `${IMG_BASE}${m.poster_path}` : '';
  const el = document.createElement('div');
  el.className = 'movie-item' + (poster ? '' : ' no-poster');
  el.innerHTML = `
    ${poster ? `<img class="movie-img" src="${escHtml(poster)}" alt="">` : ''}
    <div>
      <div class="movie-title">${escHtml(m.title || m.name || '(Sans titre)')}</div>
      <div class="movie-meta">
        ${m.release_date ? escHtml(m.release_date) : ''}${
          m.vote_average ? ` · ★ ${Number(m.vote_average).toFixed(1)} (${m.vote_count || 0})` : ''
        }
      </div>
      <p class="movie-overview">${escHtml(m.overview || '')}</p>
    </div>
  `;
  el.addEventListener('click', async () => {
    const title = m.title || m.name || '(Sans titre)';
    const ok = await copyToClipboard(title);
    if (ok) {
      el.classList.add('copied');
      const titleEl = el.querySelector('.movie-title');
      const old = titleEl ? titleEl.textContent : '';
      if (titleEl) {
        titleEl.textContent = `${old} ✓ Copié`;
        setTimeout(() => {
          titleEl.textContent = old;
          el.classList.remove('copied');
        }, 900);
      } else {
        setTimeout(() => el.classList.remove('copied'), 600);
      }
    }
  });

  return el;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
    return ok;
  }
}

async function runSearchFloat() {
  const form = document.getElementById('search-form');
  const params = serializeForm(form);
  if (!params.has('sort_by')) params.set('sort_by', 'popularity.desc');
  params.set('page', '1');

  const url = `${BASE_URL}/discover/movie?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=fr-FR&${params.toString()}`;
  qs('#preview').textContent = url;

  const panel = qs('#results-float');
  const list = qs('#results-list');
  panel.classList.remove('is-hidden');
  list.innerHTML = '<div class="help">Recherche…</div>';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results.slice(0, 10) : [];
    list.innerHTML = results.length ? '' : '<div class="help">Aucun film trouvé.</div>';
    results.forEach(m => list.appendChild(createMovieItem(m)));
  } catch (err) {
    list.innerHTML = `<div class="help" style="color:#ffb3b3;">Erreur : ${err.message}</div>`;
  }
}

const castChips = initChipsInput('cast', { fetchSuggestions: tmdbPeopleSuggestions });
const compChips = initChipsInput('companies', { fetchSuggestions: tmdbCompanySuggestions });

const form = document.getElementById('search-form');

form.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Enter') {
    if (document.querySelector('.suggestions.visible')) return;
    e.preventDefault();
    form.requestSubmit();
  }
});

document.getElementById('results-close').addEventListener('click', () => {
  qs('#results-float').classList.add('is-hidden');
  qs('#results-list').innerHTML = '';
});

form.addEventListener('input', updatePreview);
form.addEventListener('reset', () => {
  setTimeout(() => {
    qsa('.genre-toggle').forEach(btn => {
      btn.dataset.state = 'neutral';
      btn.textContent = btn.dataset.name;
    });
    updatePreview();
  }, 0);
  qs('#results-float').classList.add('is-hidden');
  qs('#results-list').innerHTML = '';
});
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await runSearchFloat();
});

document.getElementById('reject-unselected').addEventListener('click', () => {
  qsa('.genre-toggle[data-state="neutral"]').forEach(btn => {
    btn.dataset.state = 'exclude';
    btn.textContent = '− ' + btn.dataset.name;
  });
  updatePreview();
  autoSubmit();
});

loadGenres();
updatePreview();
