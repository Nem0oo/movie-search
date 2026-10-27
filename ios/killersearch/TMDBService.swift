import Foundation

enum TMDBError: Error { case http(Int), badResponse }

final class TMDBService {
    static let shared = TMDBService()
    private let base = "https://api.themoviedb.org/3"
    private let imageBase = "https://image.tmdb.org/t/p/w185"

    private var genreNameToId: [String: Int] = [:]
    private var personIdCache: [String: Int?] = [:]
    private var companyIdCache: [String: Int?] = [:]

    private var apiKey: String { Store.tmdbApiKey }

    func posterURL(for path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        return URL(string: imageBase + path)
    }

    private func get<T: Decodable>(_ path: String, query: [String: String]) async throws -> T {
        var components = URLComponents(string: base + path)!
        var items = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        items.append(URLQueryItem(name: "api_key", value: apiKey))
        components.queryItems = items
        let (data, response) = try await URLSession.shared.data(from: components.url!)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw TMDBError.http(code)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func ensureGenreMap() async {
        guard !apiKey.isEmpty, genreNameToId.isEmpty else { return }
        if let resp: TMDBGenreListResponse = try? await get("/genre/movie/list", query: ["language": "fr-FR"]) {
            for g in resp.genres { genreNameToId[g.name] = g.id }
        }
    }

    func resetCaches() {
        genreNameToId.removeAll()
    }

    func genreId(for name: String) -> Int? { genreNameToId[name] }

    func resolvePersonId(_ name: String) async -> Int? {
        let key = name.lowercased()
        if let cached = personIdCache[key] { return cached }
        let result: Int? = (try? await get("/search/person", query: ["query": name]) as TMDBSearchResponse)?.results.first?.id
        personIdCache[key] = result
        return result
    }

    // TMDB héberge parfois des doublons de compagnies (ex: "Paramount pictures"
    // minuscule, sans logo, non rattaché à aucun film) classés AVANT la vraie
    // entrée dans /search/company — prendre le premier résultat brut peut donc
    // pointer vers un id fantôme et faire renvoyer 0 résultat à /discover/movie
    // (cas réel observé sur "Sueurs froides" / Vertigo). On préfère un résultat
    // dont le nom matche exactement (casse comprise) et qui a un logo, signes
    // d'une fiche "réelle" plutôt qu'un doublon.
    private func pickBestNamedResult(_ results: [TMDBNamedResult], queriedName: String) -> TMDBNamedResult? {
        results.max { a, b in score(a, queriedName) < score(b, queriedName) }
    }

    private func score(_ result: TMDBNamedResult, _ queriedName: String) -> Int {
        var score = 0
        if result.name == queriedName { score += 2 }
        if let logo = result.logoPath, !logo.isEmpty { score += 1 }
        return score
    }

    func resolveCompanyId(_ name: String) async -> Int? {
        let key = name.lowercased()
        if let cached = companyIdCache[key] { return cached }
        let results = (try? await get("/search/company", query: ["query": name]) as TMDBSearchResponse)?.results ?? []
        let result = pickBestNamedResult(results, queriedName: name)?.id
        companyIdCache[key] = result
        return result
    }

    func discover(params: [String: String], page: Int) async throws -> TMDBDiscoverResponse {
        var query = params
        query["language"] = "fr-FR"
        query["page"] = String(page)
        if query["sort_by"] == nil { query["sort_by"] = "popularity.desc" }
        return try await get("/discover/movie", query: query)
    }

    func movieTemplate(id: Int) async -> TemplateCounts? {
        guard let detail: TMDBMovieDetail = try? await get("/movie/\(id)", query: ["append_to_response": "credits"]) else {
            return nil
        }
        var counts = TemplateCounts()
        counts.cast = detail.credits?.cast?.count ?? 0
        counts.crew = detail.credits?.crew?.filter { $0.job == "Director" }.count ?? 0
        counts.genres = detail.genres?.count ?? 0
        counts.countries = detail.productionCountries?.count ?? 0
        counts.languages = detail.spokenLanguages?.count ?? 0
        counts.companies = detail.productionCompanies?.count ?? 0
        return counts
    }
}
