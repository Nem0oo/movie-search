const BASE_URL = 'https://api.themoviedb.org/3';
let TMDB_API_KEY = '';
let currentGameId = null;
let guessedIds = new Set();
let gameWon = null;
let searchSeq = 0;
const genreNameToId = new Map();
const personIdCache = new Map();
const templateCache = new Map();
const companyIdCache = new Map();

const qs = (sel, el = document) => el.querySelector(sel);
const escHtml = str => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function debounce(fn, delay = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// ---------- Réglages : clé API ----------

async function loadApiKey() {
  const stored = await chrome.storage.local.get('tmdbApiKey');
  TMDB_API_KEY = stored.tmdbApiKey || '';
  return TMDB_API_KEY;
}

async function ensureGenreMap() {
  if (!TMDB_API_KEY || genreNameToId.size) return;
  try {
    const url = `${BASE_URL}/genre/movie/list?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=fr-FR`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    (data.genres || []).forEach(g => genreNameToId.set(g.name, g.id));
  } catch { /* la recherche par genre sera simplement ignorée */ }
}

qs('#tmdb-key-save').addEventListener('click', async () => {
  const value = qs('#tmdb-key-input').value.trim();
  await chrome.storage.local.set({ tmdbApiKey: value });
  TMDB_API_KEY = value;
  genreNameToId.clear();
  const status = qs('#tmdb-key-status');
  status.textContent = value ? 'Clé enregistrée.' : 'Clé effacée.';
  setTimeout(() => { status.textContent = ''; }, 2000);
  if (value) {
    await ensureGenreMap();
    requestState();
  }
});

// ---------- Statut de la partie 1jour1film.fr ----------

function setGameStatus(connected) {
  const el = qs('#game-status');
  el.classList.toggle('connected', connected);
  qs('#game-status-text').textContent = connected
    ? 'Partie 1jour1film.fr détectée ✓'
    : "En attente d'une partie 1jour1film.fr…";
}

async function findGameTab() {
  const tabs = await chrome.tabs.query({ url: 'https://1jour1film.fr/*' });
  return tabs[0] || null;
}

async function requestState() {
  const tab = await findGameTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: 'KS_GET_STATE' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) return;
    handleGameEvent({ id: response.id, endpoint: 'matrice', responseBody: response.responseBody });
  });
}

// ---------- Traduction matrice → critères TMDB ----------

function extractMatriceCorrection(event) {
  if (event.endpoint === 'matrice') return event.responseBody && event.responseBody.movieCorrection;
  if (event.endpoint === 'answers') {
    const body = event.responseBody || {};
    return (body.matrice && body.matrice.movieCorrection) || body.movieCorrection;
  }
  return null;
}

// TMDB héberge parfois des doublons de compagnies (ex: "Paramount pictures"
// minuscule, sans logo, non rattaché à aucun film) classés AVANT la vraie
// entrée dans /search/company — prendre le premier résultat brut peut donc
// pointer vers un id fantôme et faire renvoyer 0 résultat à /discover/movie.
// On préfère un résultat dont le nom matche exactement (casse comprise) et
// qui a un logo, signes d'une fiche "réelle" plutôt qu'un doublon.
function pickBestNamedResult(results, queriedName) {
  if (!results || !results.length) return null;
  let best = results[0];
  let bestScore = -1;
  for (const r of results) {
    let score = 0;
    if (r.name === queriedName) score += 2;
    if (r.logo_path) score += 1;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

async function resolvePersonId(name) {
  const key = name.trim().toLowerCase();
  if (personIdCache.has(key)) return personIdCache.get(key);
  try {
    const url = `${BASE_URL}/search/person?api_key=${encodeURIComponent(TMDB_API_KEY)}&query=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const id = (data.results && data.results[0] && data.results[0].id) || null;
    personIdCache.set(key, id);
    return id;
  } catch {
    personIdCache.set(key, null);
    return null;
  }
}

async function resolveCompanyId(name) {
  const key = name.trim().toLowerCase();
  if (companyIdCache.has(key)) return companyIdCache.get(key);
  try {
    const url = `${BASE_URL}/search/company?api_key=${encodeURIComponent(TMDB_API_KEY)}&query=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const best = pickBestNamedResult(data.results, name);
    const id = best ? best.id : null;
    companyIdCache.set(key, id);
    return id;
  } catch {
    companyIdCache.set(key, null);
    return null;
  }
}

function applyYearRange(params, criteria, year) {
  if (!year) return;
  if (year.status === 'valid' && year.value != null) {
    params.set('primary_release_year', String(year.value));
    criteria.push(`Année = ${year.value}`);
    return;
  }
  if (year.max != null) {
    const bound = Number(year.max) - 1;
    params.set('primary_release_date.lte', `${bound}-12-31`);
    criteria.push(`Année ≤ ${bound}`);
  }
  if (year.min != null) {
    const bound = Number(year.min) + 1;
    params.set('primary_release_date.gte', `${bound}-01-01`);
    criteria.push(`Année ≥ ${bound}`);
  }
}

function applyIntRange(params, criteria, field, gteKey, lteKey, label) {
  if (!field) return;
  if (field.status === 'valid' && field.value != null) {
    params.set(gteKey, String(field.value));
    params.set(lteKey, String(field.value));
    criteria.push(`${label} = ${field.value}`);
    return;
  }
  if (field.max != null) {
    const bound = Number(field.max) - 1;
    params.set(lteKey, String(bound));
    criteria.push(`${label} ≤ ${bound}`);
  }
  if (field.min != null) {
    const bound = Number(field.min) + 1;
    params.set(gteKey, String(bound));
    criteria.push(`${label} ≥ ${bound}`);
  }
}

function applyFloatRange(params, criteria, field, gteKey, lteKey, label, tolerance = 0) {
  if (!field) return;
  if (field.status === 'valid' && field.value != null) {
    const v = Number(field.value);
    params.set(gteKey, String(v - tolerance));
    params.set(lteKey, String(v + tolerance));
    criteria.push(tolerance ? `${label} ≈ ${v}` : `${label} = ${v}`);
    return;
  }
  if (field.max != null) { params.set(lteKey, String(field.max)); criteria.push(`${label} ≤ ${field.max}`); }
  if (field.min != null) { params.set(gteKey, String(field.min)); criteria.push(`${label} ≥ ${field.min}`); }
}

async function buildDiscoverParams(mc) {
  const params = new URLSearchParams();
  const criteria = [];

  const validCast = (mc.mainList || []).filter(x => x.status === 'valid' && x.name);
  if (validCast.length) {
    const ids = (await Promise.all(validCast.map(a => resolvePersonId(a.name)))).filter(Boolean);
    if (ids.length) {
      params.set('with_cast', ids.join(','));
      criteria.push(`Acteurs : ${validCast.map(a => a.name).join(', ')}`);
    }
  }

  const validCrew = (mc.secondaryList || []).filter(x => x.status === 'valid' && x.name);
  if (validCrew.length) {
    const ids = (await Promise.all(validCrew.map(a => resolvePersonId(a.name)))).filter(Boolean);
    if (ids.length) {
      params.set('with_crew', ids.join(','));
      criteria.push(`Réalisateur(s) : ${validCrew.map(a => a.name).join(', ')}`);
    }
  }

  const validGenres = (mc.genres || []).filter(g => g.status === 'valid' && g.name);
  const invalidGenres = (mc.genres || []).filter(g => g.status === 'invalid' && g.name);
  if (validGenres.length) {
    const ids = validGenres.map(g => genreNameToId.get(g.name)).filter(Boolean);
    if (ids.length) { params.set('with_genres', ids.join(',')); criteria.push(`Genres inclus : ${validGenres.map(g => g.name).join(', ')}`); }
  }
  if (invalidGenres.length) {
    const ids = invalidGenres.map(g => genreNameToId.get(g.name)).filter(Boolean);
    if (ids.length) { params.set('without_genres', ids.join(',')); criteria.push(`Genres exclus : ${invalidGenres.map(g => g.name).join(', ')}`); }
  }

  const validCompanies = (mc.productions || []).filter(p => p.status === 'valid' && p.name);
  if (validCompanies.length) {
    const ids = (await Promise.all(validCompanies.map(p => resolveCompanyId(p.name)))).filter(Boolean);
    if (ids.length) {
      params.set('with_companies', ids.join(','));
      criteria.push(`Compagnie(s) : ${validCompanies.map(p => p.name).join(', ')}`);
    }
  }

  const validCountries = (mc.countries || []).filter(c => c.status === 'valid' && c.name);
  if (validCountries.length) {
    params.set('with_origin_country', validCountries.map(c => c.name).join(','));
    criteria.push(`Pays : ${validCountries.map(c => c.name).join(', ')}`);
  }

  const validLang = (mc.spokenLanguages || []).find(l => l.status === 'valid' && l.name);
  if (validLang) { params.set('with_original_language', validLang.name); criteria.push(`Langue : ${validLang.name}`); }

  // Plateformes volontairement non envoyées comme filtre discover : les
  // droits de streaming/VOD changent dans le temps, la donnée "valide" de la
  // partie peut être obsolète par rapport à TMDB en direct (cas réel observé :
  // "Les Heures retrouvées", 0 résultat avec le filtre alors que le film est
  // le bon, il n'est simplement plus dispo sur les plateformes en question
  // aujourd'hui). Même traitement que `certification`.
  const validProviders = (mc.providers || []).filter(p => p.status === 'valid' && p.name);
  if (validProviders.length) {
    criteria.push(`Plateforme(s) (indicatif, non filtré) : ${validProviders.map(p => p.name).join(', ')}`);
  }

  if (mc.certification && mc.certification.status === 'valid' && mc.certification.name) {
    // Pas envoyé comme filtre discover : les données de classification par pays
    // sont trop incomplètes sur TMDB (beaucoup de films n'ont aucune entrée FR),
    // ce filtre "tout ou rien" videait la liste même quand le film cherché
    // correspondait à tous les autres critères. Affiché à titre indicatif.
    criteria.push(`Classification (indicatif, non filtré) : ${mc.certification.name}`);
  }

  applyYearRange(params, criteria, mc.year);
  applyIntRange(params, criteria, mc.runtime, 'with_runtime.gte', 'with_runtime.lte', 'Durée (min)');
  applyFloatRange(params, criteria, mc.tmdbRating, 'vote_average.gte', 'vote_average.lte', 'Note TMDB', 0.5);

  // La taille de ces listes est fixée dès le début de la partie (gabarit du film
  // cible), même sans aucune proposition valide : on peut s'en servir pour éliminer
  // des candidats TMDB dont le nombre d'acteurs/genres/pays/etc. ne correspond pas.
  const expectedCounts = {
    cast: (mc.mainList || []).length,
    crew: (mc.secondaryList || []).length,
    genres: (mc.genres || []).length,
    countries: (mc.countries || []).length,
    languages: (mc.spokenLanguages || []).length,
    companies: (mc.productions || []).length,
  };
  if (expectedCounts.cast) criteria.push(`Casting complet : ${expectedCounts.cast} acteurs`);
  if (expectedCounts.crew) criteria.push(`Réalisateur(s) (nombre) : ${expectedCounts.crew}`);
  if (expectedCounts.genres) criteria.push(`Genres (nombre) : ${expectedCounts.genres}`);
  if (expectedCounts.countries) criteria.push(`Pays (nombre) : ${expectedCounts.countries}`);
  if (expectedCounts.languages) criteria.push(`Langues (nombre) : ${expectedCounts.languages}`);
  if (expectedCounts.companies) criteria.push(`Compagnies (nombre) : ${expectedCounts.companies}`);

  return { params, criteria, expectedCounts };
}

async function fetchMovieTemplate(id) {
  if (templateCache.has(id)) return templateCache.get(id);
  try {
    const url = `${BASE_URL}/movie/${id}?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=fr-FR&append_to_response=credits`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const template = {
      cast: ((data.credits && data.credits.cast) || []).length,
      crew: ((data.credits && data.credits.crew) || []).filter(c => c.job === 'Director').length,
      genres: (data.genres || []).length,
      countries: (data.production_countries || []).length,
      languages: (data.spoken_languages || []).length,
      companies: (data.production_companies || []).length,
    };
    templateCache.set(id, template);
    return template;
  } catch {
    return null;
  }
}

function templateMatches(counts, expected) {
  return Object.keys(expected).every((key) => {
    const exp = expected[key];
    if (!exp) return true; // pas de contrainte connue sur ce champ
    return counts[key] === exp;
  });
}

function renderCriteria(criteria) {
  const el = qs('#criteria-list');
  if (!criteria.length) {
    el.innerHTML = '<span class="help">Aucun critère confirmé pour l\'instant.</span>';
    return;
  }
  el.innerHTML = criteria.map(c => `<div class="crit">${escHtml(c)}</div>`).join('');
}

// ---------- Résultats TMDB & envoi de propositions ----------

const IMG_BASE = 'https://image.tmdb.org/t/p/w185';
const COMPARISON_LABEL = { lower: 'plus bas', higher: 'plus haut', equal: 'identique', none: '' };

function renderGuessResult(container, data) {
  const c = data.movieCorrection || {};
  const parts = [];

  if (data.rank) parts.push(`<div class="rank">🏆 Trouvé ! Rang ${escHtml(data.rank)}</div>`);

  const validNames = (list) => (list || []).filter(x => x.status === 'valid' && x.name).map(x => x.name);

  const cast = validNames(c.mainList);
  if (cast.length) parts.push(`<div><span class="valid">Acteurs communs :</span> ${escHtml(cast.join(', '))}</div>`);

  const crew = validNames(c.secondaryList);
  if (crew.length) parts.push(`<div><span class="valid">Réalisateur(s) commun(s) :</span> ${escHtml(crew.join(', '))}</div>`);

  const genres = validNames(c.genres);
  if (genres.length) parts.push(`<div><span class="valid">Genre(s) commun(s) :</span> ${escHtml(genres.join(', '))}</div>`);

  const countries = validNames(c.countries);
  if (countries.length) parts.push(`<div><span class="valid">Pays commun(s) :</span> ${escHtml(countries.join(', '))}</div>`);

  const companies = validNames(c.productions);
  if (companies.length) parts.push(`<div><span class="valid">Compagnie(s) commune(s) :</span> ${escHtml(companies.join(', '))}</div>`);

  const providers = validNames(c.providers);
  if (providers.length) parts.push(`<div><span class="valid">Plateforme(s) commune(s) :</span> ${escHtml(providers.join(', '))}</div>`);

  if (c.certification && c.certification.status === 'valid' && c.certification.name) {
    parts.push(`<div><span class="valid">Classification commune :</span> ${escHtml(c.certification.name)}</div>`);
  }

  if (c.year && c.year.comparison && c.year.comparison !== 'none') {
    parts.push(`<div>Année : ${escHtml(c.year.value ?? '?')} (cible ${escHtml(COMPARISON_LABEL[c.year.comparison] || c.year.comparison)})</div>`);
  }
  if (c.runtime && c.runtime.comparison && c.runtime.comparison !== 'none') {
    parts.push(`<div>Durée : ${escHtml(c.runtime.value ?? '?')} min (cible ${escHtml(COMPARISON_LABEL[c.runtime.comparison] || c.runtime.comparison)})</div>`);
  }

  if (!parts.length) parts.push('<div class="pending">Aucune correspondance.</div>');

  container.innerHTML = parts.join('');
}

async function submitGuess(movie, resultEl) {
  guessedIds.add(movie.id);
  resultEl.innerHTML = '<div class="pending">Envoi…</div>';

  const tab = await findGameTab();
  if (!tab) {
    guessedIds.delete(movie.id);
    resultEl.innerHTML = '<div class="error">Aucun onglet 1jour1film.fr ouvert.</div>';
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'KS_DO_SUBMIT', externalId: String(movie.id) }, (response) => {
    if (chrome.runtime.lastError) {
      guessedIds.delete(movie.id);
      resultEl.innerHTML = `<div class="error">${escHtml(chrome.runtime.lastError.message)}</div>`;
      return;
    }
    if (!response || !response.ok) {
      guessedIds.delete(movie.id);
      resultEl.innerHTML = `<div class="error">${escHtml((response && response.error) || "Échec de l'envoi.")}</div>`;
      return;
    }
    renderGuessResult(resultEl, response.data);
  });
}

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
      <div class="guess-result"></div>
    </div>
  `;
  const resultEl = el.querySelector('.guess-result');
  el.addEventListener('click', () => submitGuess(m, resultEl));
  return el;
}

const MAX_MATCHES = 10;
const MAX_PAGES = 5;

async function fetchDiscoverPage(params, page) {
  params.set('page', String(page));
  const url = `${BASE_URL}/discover/movie?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=fr-FR&${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { url, data: await res.json() };
}

async function runDiscoverSearch(params, expectedCounts = {}) {
  const mySeq = ++searchSeq;

  if (!TMDB_API_KEY) {
    qs('#results-list').innerHTML = '<div class="help">Renseigne ta clé API TMDB dans les réglages.</div>';
    qs('#results-float').classList.remove('is-hidden');
    return;
  }

  if (!params.has('sort_by')) params.set('sort_by', 'popularity.desc');
  const hasTemplate = Object.values(expectedCounts).some(v => v > 0);

  const panel = qs('#results-float');
  const list = qs('#results-list');
  panel.classList.remove('is-hidden');
  list.innerHTML = '<div class="help">Recherche…</div>';

  try {
    const matched = [];
    const rawMatched = []; // sans le filtre de gabarit, pour repli si "matched" reste vide
    let page = 1;
    let totalPages = 1;
    let checked = 0;

    while (page <= totalPages && page <= MAX_PAGES && matched.length < MAX_MATCHES) {
      const { url, data } = await fetchDiscoverPage(params, page);
      if (mySeq !== searchSeq) return; // une recherche plus récente a pris le relais
      if (page === 1) qs('#preview').textContent = url;

      totalPages = data.total_pages || 1;
      const pageCandidates = (Array.isArray(data.results) ? data.results : []).filter(m => !guessedIds.has(m.id));
      checked += pageCandidates.length;
      if (rawMatched.length < MAX_MATCHES) rawMatched.push(...pageCandidates);

      if (!hasTemplate) {
        matched.push(...pageCandidates);
      } else {
        let toCheck = pageCandidates;
        if (expectedCounts.genres) {
          toCheck = toCheck.filter(m => Array.isArray(m.genre_ids) && m.genre_ids.length === expectedCounts.genres);
        }
        if (toCheck.length) {
          const templates = await Promise.all(toCheck.map(m => fetchMovieTemplate(m.id)));
          if (mySeq !== searchSeq) return;
          matched.push(...toCheck.filter((m, i) => !templates[i] || templateMatches(templates[i], expectedCounts)));
        }
      }

      page += 1;
    }

    const usedFallback = hasTemplate && !matched.length && rawMatched.length > 0;
    const results = (usedFallback ? rawMatched : matched).slice(0, MAX_MATCHES);

    if (!results.length) {
      list.innerHTML = '<div class="help">Aucun film candidat restant.</div>';
    } else {
      list.innerHTML = usedFallback
        ? `<div class="help">Aucun film ne correspond exactement au gabarit sur les ${checked} premiers résultats — voici les candidats qui matchent les autres critères, à affiner.</div>`
        : '';
      results.forEach(m => list.appendChild(createMovieItem(m)));
    }

    // Envoi auto même en mode repli s'il ne reste qu'un seul candidat : s'il
    // n'y en a qu'un, il n'y a de toute façon rien d'autre à lui préférer —
    // le gabarit peut être trompé par une donnée TMDB qui a bougé depuis
    // (cast/compagnie/plateforme, voir pièges 7/8), pas de raison de bloquer
    // la progression dans ce cas précis.
    if (results.length === 1) {
      const only = list.querySelector('.movie-item');
      submitGuess(results[0], only.querySelector('.guess-result'));
    }
  } catch (err) {
    if (mySeq !== searchSeq) return;
    list.innerHTML = `<div class="help" style="color:#ffb3b3;">Erreur : ${escHtml(err.message)}</div>`;
  }
}

const scheduleSearch = debounce((params, expectedCounts) => runDiscoverSearch(params, expectedCounts), 300);

async function processMatrice(mc) {
  if (!mc || gameWon) return;
  await ensureGenreMap();
  const { params, criteria, expectedCounts } = await buildDiscoverParams(mc);
  renderCriteria(criteria);
  scheduleSearch(params, expectedCounts);
}

function renderWinBanner() {
  qs('#criteria-list').innerHTML = `<div class="crit win">🏆 Trouvé : « ${escHtml(gameWon.title || '?')} » — rang ${escHtml(gameWon.rank)}</div>`;
  qs('#preview').textContent = '(partie gagnée)';
}

// ---------- Réception des événements du jeu ----------

function handleGameEvent(event) {
  if (event.id && event.id !== currentGameId) {
    currentGameId = event.id;
    guessedIds = new Set();
    gameWon = null;
  }
  if (event.id) setGameStatus(true);

  if (event.endpoint === 'answers' && event.responseBody && event.responseBody.rank) {
    gameWon = { rank: event.responseBody.rank, title: event.responseBody.movieCorrection && event.responseBody.movieCorrection.title };
    renderWinBanner();
    return;
  }

  const mc = extractMatriceCorrection(event);
  if (mc) processMatrice(mc);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'KS_GAME_UPDATE') handleGameEvent(message);
});

qs('#refresh-criteria').addEventListener('click', () => requestState());

qs('#reset-game').addEventListener('click', () => {
  searchSeq += 1; // annule toute recherche en cours
  currentGameId = null;
  guessedIds = new Set();
  gameWon = null;
  setGameStatus(false);
  renderCriteria([]);
  qs('#preview').textContent = '(vide)';
  qs('#results-float').classList.add('is-hidden');
  qs('#results-list').innerHTML = '';
  requestState();
});

qs('#results-close').addEventListener('click', () => {
  qs('#results-float').classList.add('is-hidden');
  qs('#results-list').innerHTML = '';
});

// ---------- Démarrage ----------

(async function init() {
  const key = await loadApiKey();
  qs('#tmdb-key-input').value = key;
  if (!key) {
    qs('.settings').open = true;
  } else {
    await ensureGenreMap();
  }
  requestState();
})();
