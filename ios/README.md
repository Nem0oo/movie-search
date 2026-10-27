# Killer Search — app iOS (beta, Theos)

App SwiftUI native (iOS 16.5+) qui fait la même chose que l'extension Chrome
(`extension/`) : récupère le film du jour sur https://1jour1film.fr, en déduit
des filtres TMDB, propose des candidats, et envoie les propositions au jeu.
Contrairement à l'extension, il n'y a pas de page web du jeu à afficher — tous
les appels (site + TMDB) se font en natif (`URLSession`).

## Build

```bash
cd ios/killersearch
docker run --rm -v "$PWD":/home/builder/code -w /home/builder/code \
  docker.io/nem0oo/theos \
  make package PACKAGE_FORMAT=ipa
```

Produit `packages/com.nem0oo.killersearch_<version>_<build>+debug.ipa`.
**Testé et vérifié** : ce build compile et package sans erreur avec cette
commande exacte (SDK iPhoneOS16.5 fourni par l'image `nem0oo/theos`).

## Installer sur un iPhone

Ce `.ipa` n'est **pas signé pour un vrai appareil** (juste `ldid`, suffisant
pour compiler mais pas pour installer directement). L'utilisateur installe via
**LiveContainer** (confirmé par les rapports de crash — un outil qui héberge
plusieurs apps non signées dans un seul process, sans compte développeur).
**Attention** : LiveContainer ne supporte pas WebKit (voir piège n°4
ci-dessous) — ce projet évite désormais délibérément tout usage de WebKit pour
rester compatible. AltStore/Sideloadly (re-signature avec un Apple ID, app
réinstallée tous les 7 jours en compte gratuit) restent des alternatives non
testées ici.

## Historique des bugs déjà rencontrés (ne pas re-découvrir)

1. **`dlopen` au lancement : "cpu type/subtype in slice (arm64e.old) does not
   match fat header (arm64e)"** — le toolchain Theos produit un slice arm64e
   avec une ABI incompatible avec les iPhone récents. Fix : `ARCHS = arm64`
   dans le `Makefile` (retire complètement arm64e du build, arm64 seul
   fonctionne sur tous les iPhone 64-bit).
2. **Connexion Google impossible dans une WKWebView classique** — Google
   bloque activement "Sign in with Google" dans les WebView embarquées
   (détection anti-phishing côté Google, rien à voir avec ce site). Fix :
   `ASWebAuthenticationSession` (`LoginView.swift`) à la place — contexte que
   Google reconnaît comme légitime. Comme le site ne redirige jamais vers un
   schéma d'URL personnalisé (il n'a aucune raison de connaître l'app), la
   détection de fin de connexion ne peut pas s'appuyer sur le callback de
   l'API : elle se fait par polling des cookies (`LoginCoordinator`, toutes
   les 1,5 s) le temps que la session est affichée.
3. **Faux positif "connecté" instantané** — la détection "n'importe quel
   cookie en plus de `csrf-token`/`callback-url`" se déclenchait dès le
   chargement de `/login`, avant même Google (le site pose d'autres cookies —
   analytics, expérimentations — indépendamment du login). Fix : revenu à une
   détection sur le nom du cookie contenant `"session-token"`
   (`CookieBridge.hasSessionCookie`), convention NextAuth stable même si le
   token est découpé en plusieurs cookies (`.0`, `.1`...).
4. **Crash instantané sur "Se connecter"** — diagnostiqué via un vrai rapport
   de crash (`EXC_BREAKPOINT` / "pointer authentication trap" dans
   `+[WKWebsiteDataStore defaultDataStore]`, appelé depuis notre propre
   `CookieBridge`). Cause : l'app tourne sous **LiveContainer** (plusieurs apps
   non signées hébergées dans un seul process) — WebKit a besoin d'une
   identité de process/bundle propre pour son architecture multi-process, que
   ce type d'environnement ne fournit pas, et son initialisation plante.
   Fix : suppression complète de `import WebKit`/`WKWebsiteDataStore` — plus
   aucun appel à WebKit nulle part dans le projet. `ASWebAuthenticationSession`
   en mode non-éphémère (`prefersEphemeralWebBrowserSession = false`) partage
   déjà ses cookies directement avec `HTTPCookieStorage.shared` au niveau
   système, donc ce pont n'était de toute façon pas nécessaire.
5. **`with_companies`/`with_watch_providers` pointant vers des données
   TMDB fantômes ou obsolètes** (cas réels : "Sueurs froides"/Vertigo pour les
   compagnies, "Les Heures retrouvées" pour les plateformes) — mêmes causes et
   fix que côté extension Chrome, voir `extension/NOTES.md` pièges 7 et 8
   (résolution de compagnie qui ne prend plus le premier résultat brut de
   recherche ; plateformes retirées du filtre `discover`, indicatif seulement).
6. **Vérification du gabarit trop lente** — `GameViewModel.runDiscoverSearch`
   interrogeait TMDB séquentiellement (un film après l'autre) pour vérifier le
   nombre d'acteurs/genres/etc. de chaque candidat, contrairement à la version
   extension Chrome qui le fait déjà en parallèle (`Promise.all`). Fix :
   `withTaskGroup` pour paralléliser ces appels (voir `runDiscoverSearch`).

## Ce qui n'est pas vérifié (pas testable sans un vrai appareil + compte)

- **Détection de fin de connexion** (`CookieBridge.hasSessionCookie`) : basée
  sur la présence d'un cookie dont le nom contient `"session-token"`
  (convention NextAuth). Le nom exact/complet n'a jamais été confirmé sur ce
  site précis (seuls `__Host-next-auth.csrf-token` et
  `__Secure-next-auth.callback-url` ont été observés jusqu'ici), donc cette
  détection reste une hypothèse raisonnable, pas une certitude. Filet de
  secours : `showCookieDebug` (menu `···` → "Diagnostic cookies") permet de
  vérifier directement ce qui a été posé si la détection auto échoue.
- **Comportement du backend une fois connecté** : pas vérifié si les cookies
  recopiés depuis la session de login vers `URLSession` (via
  `HTTPCookieStorage.shared`) suffisent à faire compter les réponses sur le
  compte de l'utilisateur, plutôt que sur le `mmuid` anonyme. Techniquement ça
  devrait fonctionner (simples cookies HTTP, le serveur ne peut pas savoir
  qu'ils viennent d'un natif plutôt que d'un navigateur), mais jamais observé
  en conditions réelles.
- **Aucune icône d'app** — utilise l'icône par défaut.
- Le mode "jouer un film passé/history" n'est **pas implémenté** (scope limité
  au film du jour, cf. `extension/NOTES.md` section "Portage iOS").

## Diagnostiquer la connexion

Menu `···` → **"Diagnostic cookies"** : liste en direct les cookies réellement
posés pour `1jour1film.fr` (nom, valeur tronquée, expiration). Après une
tentative de connexion, ouvrir cet écran et rapporter ce qui y apparaît permet
de savoir précisément ce qui se passe (nom réel du cookie de session, etc.)
au lieu de deviner depuis l'extérieur.

## Tester en anonyme

Sans toucher à "Se connecter", l'app fonctionne directement en anonyme (comme
un vrai joueur anonyme du site, via le `mmuid` généré et persisté en local).
Ce `mmuid` persiste volontairement entre les lancements (même logique que le
`localStorage` du site) — donc si l'identité anonyme a déjà trouvé le film du
jour, rouvrir l'app retombe sur cet état "déjà trouvé". Pour retester depuis
zéro : menu `···` → **"Nouvelle identité anonyme"** (régénère le `mmuid`).

## Structure

Fichiers Swift à plat à la racine du projet Theos (`ios/killersearch/`), pas de
`.xcodeproj` — tout est piloté par le `Makefile` Theos. Logique portée
quasiment 1:1 depuis `extension/sidepanel.js` (mêmes règles : bornes
exclusives/inclusives, tolérance ±0.5 sur la note TMDB, classification jamais
envoyée comme filtre `discover`, pagination + repli du filtre "gabarit",
anti-boucle sur les films déjà proposés). Voir `extension/NOTES.md` pour le
détail de chaque règle et pourquoi elle existe.

- `KillerSearchApp.swift` / `ContentView.swift` — UI SwiftUI.
- `LoginView.swift` — connexion via `ASWebAuthenticationSession` + pont cookies.
- `GameViewModel.swift` — orchestration (équivalent de `sidepanel.js`).
- `FilterBuilder.swift` — traduction matrice → filtres TMDB (équivalent de
  `buildDiscoverParams`).
- `TMDBService.swift` / `GameService.swift` — appels réseau.
- `Models.swift` — structures `Codable` (avec `FlexibleNumber` pour les champs
  que l'API renvoie tantôt en string, tantôt en nombre).
- `Persistence.swift` — `mmuid` (UUID généré une fois) + clé API TMDB, dans
  `UserDefaults`.
