// Pont entre le script injecté (world MAIN) et le reste de l'extension.
let currentMmuid = null;

// Certaines pages (/history/{id}, /challenge/{id}) portent l'id directement
// dans l'URL : pas besoin d'attendre une requête interceptée pour le connaître.
const PATH_ID_RE = /\/(history|challenge)\/([a-zA-Z0-9]{15,40})(?:[/?#]|$)/;
const pathMatch = window.location.pathname.match(PATH_ID_RE);
let currentGameId = pathMatch ? pathMatch[2] : null;
const isDailyPage = !pathMatch; // heuristique : ni /history/ ni /challenge/

async function bootstrapTodayId() {
  try {
    const res = await fetch('https://1jour1film.fr/api/movies?skip=0&take=1');
    if (!res.ok) return null;
    const data = await res.json();
    return (Array.isArray(data) && data[0] && data[0].id) || null;
  } catch {
    return null;
  }
}

window.addEventListener('killer-search:update', (event) => {
  const detail = event.detail || {};
  if (detail.id) currentGameId = detail.id;
  chrome.runtime.sendMessage({ type: 'KS_GAME_UPDATE', ...detail }).catch(() => {});
});

window.addEventListener('killer-search:mmuid', (event) => {
  if (event.detail && event.detail.mmuid) currentMmuid = event.detail.mmuid;
});

function gameHeaders(extra) {
  const headers = { ...extra };
  if (currentMmuid) headers.mmuid = currentMmuid;
  return headers;
}

function fetchMatrice(id) {
  return fetch(`https://1jour1film.fr/api/movies/${id}/matrice`, {
    credentials: 'include',
    headers: gameHeaders(),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'KS_GET_STATE') {
    (async () => {
      if (!currentGameId && isDailyPage) currentGameId = await bootstrapTodayId();
      if (!currentGameId) {
        sendResponse({ ok: false });
        return;
      }
      try {
        const data = await fetchMatrice(currentGameId);
        sendResponse({ ok: true, id: currentGameId, responseBody: data });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // réponse asynchrone
  }

  if (message.type !== 'KS_DO_SUBMIT') return;

  (async () => {
    if (!currentGameId && isDailyPage) currentGameId = await bootstrapTodayId();
    if (!currentGameId) {
      sendResponse({ ok: false, error: "Aucune partie détectée sur cette page." });
      return;
    }

    fetch(`https://1jour1film.fr/api/movies/${currentGameId}/answers`, {
      method: 'POST',
      credentials: 'include',
      headers: gameHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ externalId: message.externalId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        // Notre propre fetch ne passe pas par window.fetch (world MAIN),
        // donc il faut rediffuser nous-mêmes la mise à jour de la matrice.
        chrome.runtime.sendMessage({
          type: 'KS_GAME_UPDATE',
          id: currentGameId,
          endpoint: 'answers',
          requestBody: { externalId: message.externalId },
          responseBody: data,
        }).catch(() => {});
        sendResponse({ ok: true, data });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
  })();

  return true; // réponse asynchrone
});
