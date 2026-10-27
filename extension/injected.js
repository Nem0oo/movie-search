// S'exécute dans le contexte JS de la page (world: MAIN) pour pouvoir
// intercepter les appels fetch faits par 1jour1film.fr lui-même.
(function () {
  const ROUTE_RE = /\/api\/movies\/([^/]+)\/(matrice|answers)(?:[?#]|$)/;
  const originalFetch = window.fetch;
  let lastMmuid = null;

  function announceMmuid(mmuid) {
    if (!mmuid || mmuid === lastMmuid) return;
    lastMmuid = mmuid;
    window.dispatchEvent(new CustomEvent('killer-search:mmuid', { detail: { mmuid } }));
  }

  // Filet de sécurité : si le site stocke cet identifiant côté client,
  // on le récupère tout de suite sans attendre une requête observée.
  try {
    const stored = localStorage.getItem('mmuid') || sessionStorage.getItem('mmuid');
    if (stored) announceMmuid(stored);
  } catch {
    // stockage inaccessible, on se rabattra sur l'interception réseau
  }

  function extractHeader(input, init, name) {
    const lname = name.toLowerCase();
    const sources = [];
    if (init && init.headers) sources.push(init.headers);
    if (input && typeof input === 'object' && input.headers) sources.push(input.headers);

    for (const h of sources) {
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        const v = h.get(name);
        if (v != null) return v;
        continue;
      }
      if (Array.isArray(h)) {
        const found = h.find(([k]) => String(k).toLowerCase() === lname);
        if (found) return found[1];
        continue;
      }
      if (typeof h === 'object') {
        const key = Object.keys(h).find((k) => k.toLowerCase() === lname);
        if (key) return h[key];
      }
    }
    return null;
  }

  window.fetch = async function (input, init) {
    try {
      announceMmuid(extractHeader(input, init, 'mmuid'));
    } catch {
      // ignore
    }

    const response = await originalFetch.call(this, input, init);

    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const match = url.match(ROUTE_RE);
      if (match) {
        response
          .clone()
          .json()
          .then((responseBody) => {
            let requestBody = null;
            if (init && typeof init.body === 'string') {
              try { requestBody = JSON.parse(init.body); } catch { /* ignore */ }
            }
            window.dispatchEvent(new CustomEvent('killer-search:update', {
              detail: { id: match[1], endpoint: match[2], requestBody, responseBody },
            }));
          })
          .catch(() => {});
      }
    } catch {
      // ne jamais casser le fetch original de la page
    }

    return response;
  };
})();
