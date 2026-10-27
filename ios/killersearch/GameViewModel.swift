import Foundation

struct WinInfo { let title: String; let rank: Int }

@MainActor
final class GameViewModel: ObservableObject {
    @Published var criteria: [String] = []
    @Published var results: [TMDBMovie] = []
    @Published var guessResultText: [Int: String] = [:]
    @Published var guessInFlight: Set<Int> = []
    @Published var statusMessage: String = "En attente…"
    @Published var gameWon: WinInfo?
    @Published var isLoggedIn: Bool = false
    @Published var apiKey: String = Store.tmdbApiKey {
        didSet {
            Store.tmdbApiKey = apiKey
            TMDBService.shared.resetCaches()
        }
    }

    private var currentGameId: String?
    private var guessedIds: Set<Int> = []
    private var searchSeq = 0
    private let maxPages = 5
    private let maxMatches = 10

    func start() async {
        isLoggedIn = CookieBridge.hasSessionCookie()
        if !apiKey.isEmpty { await TMDBService.shared.ensureGenreMap() }
        await refreshGame()
    }

    func onLoginFinished() {
        isLoggedIn = CookieBridge.hasSessionCookie()
    }

    func resetGame() {
        searchSeq += 1
        currentGameId = nil
        guessedIds.removeAll()
        gameWon = nil
        criteria = []
        results = []
        guessResultText.removeAll()
        statusMessage = "En attente…"
        Task { await refreshGame() }
    }

    // Régénère l'identité anonyme (mmuid) — utile pour retester le
    // fonctionnement sans attendre le film du lendemain, en particulier après
    // avoir déjà trouvé la réponse avec l'identité précédente.
    func resetAnonymousIdentity() {
        Store.regenerateMmuid()
        resetGame()
    }

    func refreshGame() async {
        guard gameWon == nil else { return }
        do {
            let id = try await GameService.shared.fetchTodayId()
            if id != currentGameId {
                currentGameId = id
                guessedIds.removeAll()
                gameWon = nil
            }
            let matrice = try await GameService.shared.fetchMatrice(id: id)
            await process(FilterBuilder.matriceCorrection(fromMatrice: matrice))
        } catch {
            statusMessage = "Erreur : \(error.localizedDescription)"
        }
    }

    private func process(_ mc: MovieCorrection) async {
        guard gameWon == nil else { return }
        await TMDBService.shared.ensureGenreMap()
        let built = await FilterBuilder.build(from: mc)
        criteria = built.criteria
        await runDiscoverSearch(params: built.params, expectedCounts: built.expectedCounts)
    }

    private func runDiscoverSearch(params: [String: String], expectedCounts: TemplateCounts) async {
        searchSeq += 1
        let mySeq = searchSeq

        guard !apiKey.isEmpty else {
            statusMessage = "Renseigne ta clé API TMDB dans les réglages."
            results = []
            return
        }

        statusMessage = "Recherche…"
        let hasTemplate = expectedCounts.cast > 0 || expectedCounts.crew > 0 || expectedCounts.genres > 0
            || expectedCounts.countries > 0 || expectedCounts.languages > 0 || expectedCounts.companies > 0

        var matched: [TMDBMovie] = []
        var rawMatched: [TMDBMovie] = []
        var page = 1
        var totalPages = 1
        var checked = 0

        while page <= totalPages && page <= maxPages && matched.count < maxMatches {
            guard let response = try? await TMDBService.shared.discover(params: params, page: page) else { break }
            if mySeq != searchSeq { return }

            totalPages = response.totalPages ?? 1
            let pageCandidates = (response.results ?? []).filter { !guessedIds.contains($0.id) }
            checked += pageCandidates.count
            if rawMatched.count < maxMatches { rawMatched.append(contentsOf: pageCandidates) }

            if !hasTemplate {
                matched.append(contentsOf: pageCandidates)
            } else {
                var toCheck = pageCandidates
                if expectedCounts.genres > 0 {
                    let filtered = toCheck.filter { ($0.genreIds ?? []).count == expectedCounts.genres }
                    if !filtered.isEmpty { toCheck = filtered }
                }
                // Vérifs en parallèle (comme Promise.all côté extension Chrome) —
                // les faire une par une ici doublait inutilement le temps de
                // recherche.
                let templates: [TemplateCounts?] = await withTaskGroup(of: (Int, TemplateCounts?).self) { group in
                    for (idx, movie) in toCheck.enumerated() {
                        group.addTask { (idx, await TMDBService.shared.movieTemplate(id: movie.id)) }
                    }
                    var out = [TemplateCounts?](repeating: nil, count: toCheck.count)
                    for await (idx, counts) in group { out[idx] = counts }
                    return out
                }
                if mySeq != searchSeq { return }
                for (movie, counts) in zip(toCheck, templates) {
                    guard let counts else {
                        matched.append(movie) // échec réseau : on garde par précaution
                        continue
                    }
                    if FilterBuilder.templateMatches(counts, expected: expectedCounts) {
                        matched.append(movie)
                    }
                }
            }
            page += 1
        }

        let usedFallback = hasTemplate && matched.isEmpty && !rawMatched.isEmpty
        let finalResults = Array((usedFallback ? rawMatched : matched).prefix(maxMatches))
        results = finalResults

        if finalResults.isEmpty {
            statusMessage = "Aucun film candidat restant."
        } else if usedFallback {
            statusMessage = "Aucun film ne correspond exactement au gabarit sur \(checked) résultats — candidats non filtrés, à affiner."
        } else {
            statusMessage = "\(finalResults.count) candidat(s)."
        }

        // Envoi auto même en mode repli s'il ne reste qu'un seul candidat :
        // s'il n'y en a qu'un, il n'y a de toute façon rien d'autre à lui
        // préférer — le gabarit peut être trompé par une donnée TMDB qui a
        // bougé depuis, pas de raison de bloquer la progression.
        if finalResults.count == 1 {
            await submitGuess(finalResults[0])
        }
    }

    func submitGuess(_ movie: TMDBMovie) async {
        guard let gameId = currentGameId else {
            statusMessage = "Aucune partie détectée."
            return
        }
        guessedIds.insert(movie.id)
        guessInFlight.insert(movie.id)
        defer { guessInFlight.remove(movie.id) }

        do {
            let answer = try await GameService.shared.submitAnswer(id: gameId, externalId: String(movie.id))
            guessResultText[movie.id] = Self.renderGuessResult(answer)

            if let rank = answer.rank {
                gameWon = WinInfo(title: answer.movieCorrection.title ?? "?", rank: rank)
                return
            }

            let mc = FilterBuilder.matriceCorrection(fromAnswer: answer)
            await process(mc)
        } catch {
            guessResultText[movie.id] = "Erreur : \(error.localizedDescription)"
        }
    }

    private static func renderGuessResult(_ answer: AnswerResponse) -> String {
        let c = answer.movieCorrection
        var lines: [String] = []

        func validNames(_ list: [ClueItem]?) -> [String] {
            (list ?? []).filter { $0.status == "valid" && !($0.name ?? "").isEmpty }.map { $0.name! }
        }

        let cast = validNames(c.mainList)
        if !cast.isEmpty { lines.append("Acteurs communs : " + cast.joined(separator: ", ")) }
        let crew = validNames(c.secondaryList)
        if !crew.isEmpty { lines.append("Réalisateur(s) commun(s) : " + crew.joined(separator: ", ")) }
        let genres = validNames(c.genres)
        if !genres.isEmpty { lines.append("Genre(s) commun(s) : " + genres.joined(separator: ", ")) }
        let countries = validNames(c.countries)
        if !countries.isEmpty { lines.append("Pays commun(s) : " + countries.joined(separator: ", ")) }
        let companies = validNames(c.productions)
        if !companies.isEmpty { lines.append("Compagnie(s) commune(s) : " + companies.joined(separator: ", ")) }
        let providers = validNames(c.providers)
        if !providers.isEmpty { lines.append("Plateforme(s) commune(s) : " + providers.joined(separator: ", ")) }

        if let year = c.year, let comparison = year.comparison, comparison != "none" {
            let value = year.value?.doubleValue.map { String(Int($0)) } ?? "?"
            lines.append("Année : \(value) (cible \(ComparisonLabel.label(comparison)))")
        }
        if let runtime = c.runtime, let comparison = runtime.comparison, comparison != "none" {
            let value = runtime.value?.doubleValue.map { String(Int($0)) } ?? "?"
            lines.append("Durée : \(value) min (cible \(ComparisonLabel.label(comparison)))")
        }

        return lines.isEmpty ? "Aucune correspondance." : lines.joined(separator: "\n")
    }
}
