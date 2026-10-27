# Killer Search — Extension Chrome — Notes de suivi

Dernière mise à jour : 2026-09-04.

## Objectif

Extension Chrome (side panel) qui aide à jouer à https://1jour1film.fr (jeu où l'on
devine un film via des indices comparatifs — acteurs, genres, année, durée...).

Principe : intercepter les requêtes réseau que le site fait lui-même pour connaître
l'état cumulé de la partie ("matrice"), en déduire des filtres TMDB, chercher les
films candidats, et renvoyer une proposition au jeu (auto si un seul candidat, au clic
sinon) — sans jamais avoir à remplir un formulaire de recherche à la main.

## Architecture (dossier `extension/`)

- `manifest.json` — MV3, side panel, host permissions TMDB + 1jour1film.fr, deux
  content scripts sur `1jour1film.fr/*` (`injected.js` en `world: "MAIN"`,
  `content.js` en isolated world).
- `injected.js` (world MAIN, tourne dans le contexte JS réel de la page) —
  surcharge `window.fetch` pour :
  - repérer les appels vers `/api/movies/{id}/(matrice|answers)` et diffuser leur
    contenu via `CustomEvent('killer-search:update', {detail:{id, endpoint, requestBody, responseBody}})`.
  - capter l'en-tête custom `mmuid` (identifiant anonyme du site, PAS un cookie) sur
    n'importe quelle requête de la page, + lecture de secours dans
    `localStorage`/`sessionStorage` au chargement. Diffusé via
    `CustomEvent('killer-search:mmuid', {detail:{mmuid}})`.
- `content.js` (isolated world, pont) —
  - écoute les deux CustomEvents ci-dessus, retransmet vers le reste de l'extension
    via `chrome.runtime.sendMessage({type:'KS_GAME_UPDATE', ...})`.
  - répond à `KS_GET_STATE` (utilisé par le side panel au démarrage / bouton
    "Actualiser") en refaisant un `GET /matrice` frais.
  - répond à `KS_DO_SUBMIT` (envoi d'une proposition) en faisant lui-même le
    `POST /answers` — **avec `credentials:'include'` (cookies) ET l'en-tête `mmuid`**
    (les deux sont nécessaires, voir "Pièges" ci-dessous). Rediffuse ensuite la
    réponse en `KS_GAME_UPDATE` (voir pourquoi ci-dessous).
- `background.js` — juste `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})`.
- `sidepanel.html/css/js` — l'UI. Pas de formulaire manuel : un bloc "Critères
  détectés" (lecture seule) + la liste de résultats TMDB.
  - `sidepanel.js` reçoit les `KS_GAME_UPDATE`, extrait la "matrice" cumulée
    (`extractMatriceCorrection`), la traduit en query params TMDB `discover/movie`
    (`buildDiscoverParams`), affiche les critères, relance la recherche (debounce
    300 ms), affiche les résultats et gère l'envoi des propositions.

## Flux de données important à retenir

`GET /matrice` renvoie directement `{movieCorrection: {...}}` = état cumulé.
`POST /answers` renvoie `{rank, movieCorrection: <comparaison de CE guess>, matrice: {movieCorrection: {...}}}`
— c'est `responseBody.matrice.movieCorrection` qu'il faut utiliser pour les filtres
cumulés, pas le `movieCorrection` de premier niveau (qui ne concerne que le film
proposé à l'instant T).

Le site accumule déjà les bornes (ex: `year.max`/`year.min`) au fil des essais — pas
besoin de merger côté extension.

## Mapping matrice → filtres TMDB (`buildDiscoverParams` dans sidepanel.js)

- `mainList` (acteurs) valides → noms résolus en id TMDB via `search/person` →
  `with_cast`.
- `secondaryList` (réalisateurs) valides → même résolution → `with_crew`.
- `genres` valides/invalides (noms déjà en fr-FR, comme la liste TMDB) →
  `with_genres` / `without_genres`.
- `productions` (compagnies) valides → noms résolus en id TMDB via
  `search/company` → `with_companies` (AND, comme cast/crew/genres). La
  résolution ne prend plus le premier résultat brut (`pickBestNamedResult`,
  voir piège 7) : TMDB héberge des doublons fantômes classés avant la vraie
  fiche.
- `countries` valides → `with_origin_country`, **toutes** les valeurs confirmées
  jointes par virgule (hypothèse non 100% vérifiée sur la sémantique AND/OR de ce
  paramètre côté TMDB pour plusieurs valeurs — à surveiller si un pays écarte des
  résultats attendus).
- `spokenLanguages` valide → `with_original_language` (TMDB n'accepte qu'UNE
  seule valeur ici, donc seule la première confirmée est prise).
- `providers` valides → **affiché en indicatif uniquement dans les critères,
  jamais envoyé comme filtre `discover`** (plus de `ensureProviderMap`/table
  provider→id, retirés — code mort une fois le filtre supprimé). Testé et
  retiré : les droits de streaming/VOD changent dans le temps, la donnée
  "valide" de la partie peut être obsolète par rapport à TMDB en direct — voir
  piège 8.
- `certification` valide → **affiché en indicatif uniquement dans les critères,
  jamais envoyé comme filtre `discover`**. Testé et retiré : c'est un filtre
  "tout ou rien" côté TMDB (exclut tout film sans métadonnée de classification
  FR renseignée, donnée notoirement incomplète sur TMDB), qui a vidé la liste
  alors que le bon film correspondait à tous les autres critères — voir "Pièges".
- `year` / `runtime` : bornes **exclusives** (`comparison:"lower"` sur un guess à
  2019 ⇒ cible < 2019 ⇒ `lte = 2018`). `year` converti en dates
  `YYYY-01-01`/`YYYY-12-31` pour `primary_release_date.gte/lte`.
- `tmdbRating` : bornes **inclusives** (float) → `vote_average.gte/lte`. Cas `status:"valid"`
  avec une `value` exacte (ex: 7.6) : **tolérance ±0.5** appliquée (`applyFloatRange`,
  4ᵉ argument), sinon égalité stricte sur un float qui bouge en direct (les votes
  s'accumulent sur TMDB) ⇒ quasiment aucun candidat ne matche jamais, et comme la
  requête `discover` elle-même ne renvoie plus rien, le filet de repli n'a même
  rien à proposer (bug observé et corrigé, voir "Pièges").
- `budget` : **non mappable**, TMDB `discover` n'a pas de filtre budget. Ignoré.

### Filtre "gabarit" (post-discover, hors params TMDB)

La taille des listes `mainList`/`secondaryList`/`genres`/`countries`/`spokenLanguages`/
`productions` est fixée dès le début de la partie (même avant toute proposition) —
c'est le nombre réel d'acteurs/réalisateurs/genres/pays/langues/compagnies du film
cible. `discover/movie` ne permet pas de filtrer là-dessus.

`runDiscoverSearch` boucle maintenant sur les pages `discover` (jusqu'à
`MAX_PAGES = 5`, jusqu'à `MAX_MATCHES = 10` candidats retenus) :
1. pré-filtre gratuit sur `genre_ids.length` (déjà présent dans la réponse `discover`,
   évite un appel supplémentaire pour les films clairement hors gabarit) ;
2. pour les candidats restants de la page, un appel
   `GET /movie/{id}?append_to_response=credits` par film (`fetchMovieTemplate`) pour
   compter `credits.cast.length`, `credits.crew` filtré sur `job === "Director"`,
   `genres.length`, `production_countries.length`, `spoken_languages.length`,
   `production_companies.length` — comparés aux tailles attendues
   (`templateMatches`) ;
3. passe à la page suivante tant qu'il manque des candidats et qu'il reste des
   pages TMDB.
- **Repli explicite si vide** : si aucun candidat ne correspond au gabarit sur les
  pages parcourues (`matched` vide), on retombe sur les 10 premiers candidats qui
  matchent les filtres de recherche normaux (`with_cast`, genres, années...) sans
  contrainte de gabarit — affichés avec un message dédié. **Envoi auto même en
  repli s'il n'en reste qu'un** (revu depuis la version précédente qui
  bloquait l'envoi auto en repli quel que soit le nombre de candidats) : cas
  réel rencontré où le seul candidat matchant tous les autres critères
  échouait le gabarit (donnée TMDB qui a bougé, cf. pièges 7/8) — dans ce cas
  affiner davantage ne fait que réduire le même ensemble à zéro, il n'y a
  jamais d'alternative à proposer, donc pas de raison de bloquer sur un clic
  manuel. La règle "pas d'envoi auto en repli" ne garde son intérêt que quand
  plusieurs candidats non filtrés restent en lice (ambigu, choix à faire).
- `searchSeq` (compteur global) protège contre les races : si une nouvelle
  recherche démarre pendant qu'une ancienne boucle encore sur les pages, l'ancienne
  s'arrête dès qu'elle constate ne plus être la plus récente.
- Champ à 0 dans le gabarit = pas de contrainte appliquée sur ce champ (au cas où
  ce serait un flou de données plutôt qu'un vrai 0).
- Hypothèse non vérifiée en profondeur : `mainList` du jeu == `credits.cast` de
  TMDB au nombre près. Marche sur l'exemple observé (Cloud Atlas, 53 acteurs) mais
  à surveiller si le bon film n'apparaît jamais dans la liste.

## Pièges déjà rencontrés (ne pas re-découvrir)

1. **En-tête `mmuid` obligatoire sur les requêtes vers 1jour1film.fr**, en plus des
   cookies (`credentials:'include'`). Ce n'est pas un cookie, c'est un header
   custom posé par le JS du site. Capté passivement (voir `injected.js`).
2. **Le `fetch` que fait `content.js` pour envoyer une proposition ne passe PAS par
   `window.fetch` intercepté** (celui-ci n'existe que dans le monde MAIN de
   `injected.js` — deux `fetch` différents). Sans rediffusion manuelle, la matrice
   mise à jour après notre propre envoi n'atteignait jamais le side panel → les
   critères et la liste de résultats ne se rafraîchissaient pas après un clic.
   Fix : `content.js` rediffuse lui-même un `KS_GAME_UPDATE` après un `KS_DO_SUBMIT`
   réussi.
3. **`window.location.reload()` de l'onglet du jeu après un envoi = essayé puis
   retiré** ("casse tout le fonctionnement en l'état", cause exacte non
   diagnostiquée). Ne pas réintroduire un reload automatique de la page du jeu.
4. **Note TMDB exacte trop stricte** : un exemple réel (`type:"CHALLENGE"`) avait
   `tmdbRating.status:"valid"` avec `value:7.6` → filtrait `vote_average` en égalité
   stricte, donc plus aucun résultat `discover` du tout (même pas de repli possible).
   Fix : tolérance ±0.5 sur ce champ uniquement. Vu aussi à cette occasion : le champ
   `comparison` peut valoir `"between"` (avec `min` ET `max` simultanément, ex.
   année 2003-2005) — déjà géré correctement par la logique existante puisqu'elle
   traite `min`/`max` indépendamment du libellé `comparison`.
5. **Victoire non affichée** : quand un guess est correct (`responseBody.rank` présent
   sur la réponse `/answers`), la rediffusion `KS_GAME_UPDATE` déclenchait quand même
   une nouvelle recherche TMDB qui effaçait la liste (et le film gagnant, exclu par
   `guessedIds`) avant que l'utilisateur ait pu voir la confirmation. Fix : détection
   de victoire dans `handleGameEvent` (variable `gameWon`), bannière persistante dans
   `#criteria-list`, et `processMatrice` s'arrête tant que `gameWon` est set. Ne
   détecte pas encore une victoire déjà acquise si on rouvre le panneau après coup
   (`GET /matrice` ne renvoie pas de `rank` au niveau racine).
5bis. **`certification` en filtre `discover` = risque de faux zéro** : diagnostiqué
   via l'URL `discover` réellement générée (collée par l'utilisateur) —
   `certification=U&certification_country=FR` combiné à d'autres critères déjà
   serrés (année exacte, durée max, plage de note, provider+région) suffisait à
   vider `data.results` côté TMDB lui-même (donc même le repli "10 premiers sans
   gabarit" n'avait rien à proposer, puisqu'il vient de la même requête `discover`).
   Fix : classification affichée en indicatif dans les critères mais plus jamais
   envoyée comme paramètre `discover`. Repéré aussi à cette occasion : `budget` et
   `tmdbRating` peuvent porter un champ `targetValue` (valeur exacte de la cible,
   ex. 115000000 / 7.9) constant sur plusieurs essais différents — présent sur le
   `movieCorrection` de premier niveau d'une réponse `answers` individuelle, pas
   encore vu sur la matrice cumulée. Piste d'amélioration non implémentée :
   utiliser ce `targetValue` (budget notamment) dans le filtre "gabarit" post-discover
   pour un match exact, plus fiable que la narrowing par bornes.
6. **Anti-boucle** : `guessedIds` (Set côté sidepanel, réinitialisé si l'id de
   partie change, ou manuellement via le bouton "Nouvelle partie") exclut les
   films déjà proposés des résultats suivants, sinon un même mauvais candidat
   pourrait reboucler indéfiniment si les filtres TMDB ne suffisent pas à
   l'éliminer.
7. **`with_companies` peut pointer vers un id fantôme** (cas réel : "Sueurs
   froides"/Vertigo). `TMDB /search/company?query=Paramount Pictures` renvoie
   DEUX entrées : un doublon vide (`id 309902`, "Paramount pictures" en
   minuscule, `logo_path: null`, non rattaché à aucun film) classé **avant**
   la vraie entrée (`id 4`, celle réellement attachée au film, avec logo).
   `resolveCompanyId` prenait le premier résultat brut → `with_companies=309902`
   → 0 résultat `discover` garanti, quels que soient les autres critères. Fix
   (`pickBestNamedResult` dans `sidepanel.js`, même logique en Swift dans
   `TMDBService.swift`) : score chaque résultat (+2 si le nom matche exactement
   la casse du nom recherché, +1 si `logo_path` est renseigné) et garde le
   meilleur plutôt que le premier. Vérifié : sur "Paramount Pictures" ça
   sélectionne bien `id 4`. Le même risque existe en théorie sur
   `resolvePersonId` (pas de doublon connu observé à ce jour, donc non modifié).
8. **`with_watch_providers` = même famille de piège que `certification`**
   (cas réel : "Les Heures retrouvées", id TMDB 364220). En retirant juste ce
   paramètre de la requête `discover`, le bon film ressortait. Vérifié en
   direct : même en élargissant à `with_watch_monetization_types=flatrate|rent|buy`,
   aucun des fournisseurs marqués "valid" par la partie (Disney Plus, HBO Max,
   HBO Max Amazon Channel) n'est réellement associé au film sur TMDB
   aujourd'hui — il n'est dispo en France qu'en achat/location ailleurs (Apple
   TV, Google Play, Amazon Video...). Les droits de streaming/VOD changent
   dans le temps ; la donnée "valide" enregistrée par la partie peut donc être
   obsolète par rapport à TMDB en direct. Fix : plateformes affichées en
   indicatif uniquement, jamais envoyées comme filtre `discover` (même
   traitement que `certification`, piège 5bis). `ensureProviderMap`/
   `providerNameToId`/`providerId` (table provider→id) retirés du code — plus
   utilisés une fois le filtre supprimé.

## État actuel (testé par l'utilisateur)

- Détection de partie ✓, POST de proposition ✓ (avec mmuid + cookies), affichage du
  résultat de comparaison sous la fiche ✓, rafraîchissement automatique des
  critères + de la liste après un envoi ✓ (via la rediffusion manuelle du point 2).
- Filtre "gabarit" paginé + repli + retrait du filtre `certification` du `discover`
  testés sur un vrai cas de 0-résultat, corrigés.
- Pas de format "je pense que c'est ce film-ci" en dehors des candidats TMDB —
  pas encore testé sur une partie entière jusqu'à la victoire.

## Bug "Aucune partie détectée" sur film passé — fix appliqué (probable, pas 100% confirmé)

Contexte : en rejouant un **film passé** (page `https://1jour1film.fr/history/{id}`,
ex. `cmo7dyr4j001r06mn5pfvvhc1`), l'utilisateur a eu "Aucune partie détectée" au clic
sur une proposition. Le bug ne s'est jamais reproduit de façon fiable (donc pas de
requête réseau capturée pour confirmer la cause exacte), mais l'analyse du code
source du site (bundles JS publics de `/jouer/aujourd-hui`, téléchargés et inspectés
sans compte) donne deux leviers concrets, tous les deux implémentés dans `content.js` :

1. **L'id est directement dans l'URL de la page** pour `/history/{id}` et
   `/challenge/{id}` — `content.js` l'extrait maintenant immédiatement au chargement
   via `PATH_ID_RE`, sans attendre une requête interceptée. Couvre le cas où la page
   n'a pas encore refait son propre appel `/matrice` au moment du clic (souci de
   synchro le plus probable).
2. **`GET https://1jour1film.fr/api/movies?skip=0&take=1`** (public, sans cookies)
   renvoie le film du jour en cours, trié par `day` décroissant — vérifié en direct
   (`day` = date du jour). `bootstrapTodayId()` l'utilise en filet de secours
   uniquement sur les pages "daily" (ni `/history/` ni `/challenge/`, cf. `isDailyPage`)
   si `currentGameId` est encore `null` au moment d'un `KS_GET_STATE`/`KS_DO_SUBMIT` —
   jamais utilisé sur une page d'historique pour ne pas risquer de soumettre au
   mauvais film.

Le bouton "Nouvelle partie" (`#reset-game`) reste un palliatif manuel complémentaire.

## Idées pour la suite (non commencées)

- Afficher un historique des essais dans le side panel (au lieu de tout recalculer
  à chaque fois depuis la matrice).
- Gérer les cas où `with_origin_country`/`with_original_language` ont plusieurs
  valeurs valides (TMDB ne prend qu'une valeur — voir s'il y a un contournement,
  ou juste documenter la limite plus visiblement dans l'UI).
- Utiliser `budget.targetValue`/`tmdbRating.targetValue` (valeur exacte de la
  cible, vue sur le `movieCorrection` de premier niveau d'une réponse `answers`)
  dans le filtre "gabarit" post-discover pour un match plus précis que les bornes
  actuelles — voir piège 5bis.
- Icônes de l'extension (actuellement aucune — Chrome utilise l'icône par défaut).
- Réfléchir à un vrai "refresh" de l'affichage du jeu sans reload complet (cf.
  piège n°3) si le besoin revient.
- **Portage iOS évoqué par l'utilisateur** (usage hors domicile) : pas de Chrome
  extensions sur iOS (Apple interdit les moteurs/extensions tiers). Piste retenue
  après discussion : app native (Swift/`URLSession`, pas de WKWebView pour les
  appels réseau → évite complètement les soucis de CORS qu'un `fetch` cross-origin
  depuis une page web rencontrerait) qui reproduit `sidepanel.js` presque tel quel
  (idéalement rechargé dans une WebView locale avec juste la "plomberie réseau"
  pontée vers du natif) + un pont HTTP direct vers l'API du site et TMDB, sans
  jamais avoir à afficher/rendre la vraie page du jeu. Deux inconnues bloquantes
  ont été levées en inspectant le code source public du site (bundles JS de
  `/jouer/aujourd-hui`, sans compte) :
  - **`mmuid` est 100% généré côté client** : `localStorage.getItem("_mm_0x7a3f")`,
    sinon un uuid v4 généré puis stocké sous cette clé. Aucun enregistrement
    serveur → l'app iOS peut générer son propre UUID sans jamais passer par une
    WebView de connexion pour ça.
  - **`GET /api/movies?skip=0&take=1` donne l'id du film du jour** (public, sans
    cookies, trié par `day` décroissant) — vérifié en direct, voir section bug
    ci-dessus. Reste à éclaircir : le comportement pour les films passés/history
    et challenge nécessiterait probablement une vraie session utilisateur (les
    ids d'historique ne sont pas listés par cet endpoint public de la même façon).
  - Surface d'API confirmée à cette occasion : `/api/movies/{id}`,
    `/api/movies/{id}/matrice`, `/api/movies/{id}/answers` (GET liste + POST),
    `/api/movies/{id}/rarity`, `/api/movies/{id}/history-access` (POST),
    `/api/movies` (liste paginée `skip`/`take`), `/api/movies/search`,
    `/api/user/{id}/rating/history`.
  - **Jouer en anonyme (sans compte) ne nécessite aucune connexion**, testé en
    direct : `POST /api/movies/{id}/answers` sans aucun cookie, juste l'en-tête
    `mmuid`, répond HTTP 200 avec une comparaison complète et normale (partie
    `type:"DAILY"` — nouveau type de partie vu à cette occasion, en plus de
    `SOLO`/`CHALLENGE`).
  - **Mais l'utilisateur veut jouer avec son compte** (progression/stats liées
    au compte, pas à un `mmuid` anonyme, connexion via **Google**) → géré via
    `ASWebAuthenticationSession` (pas une WKWebView classique : Google bloque
    activement "Sign in with Google" dans les WebView embarquées, testé en
    conditions réelles — voir `ios/README.md` pour le détail du bug et du fix).

  **App codée, buildée et testée sur un vrai appareil** dans `ios/killersearch/`
  (Theos, iOS 16.5). Plusieurs bugs réels rencontrés et corrigés en cours de
  route (crash au lancement par ABI arm64e incompatible, blocage Google dans
  WKWebView) — **voir `ios/README.md`, c'est la référence à jour pour l'app
  iOS**, ne pas dupliquer son contenu ici plus en détail pour éviter que les
  deux notes divergent.

  Scope volontairement limité par l'utilisateur au film du jour (pas
  d'historique) — écarte la question de l'accès premium à l'historique.

## Pour tester

`chrome://extensions` → mode développeur → recharger l'extension (icône ↻) après
chaque modification de fichier → rouvrir le side panel.
