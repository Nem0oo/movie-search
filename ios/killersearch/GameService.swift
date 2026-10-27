import Foundation

enum GameError: Error { case http(Int), empty }

final class GameService {
    static let shared = GameService()
    private let base = "https://1jour1film.fr"

    private func request(_ path: String, method: String = "GET", body: Data? = nil) -> URLRequest {
        var req = URLRequest(url: URL(string: base + path)!)
        req.httpMethod = method
        req.setValue(Store.mmuid, forHTTPHeaderField: "mmuid")
        if body != nil {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
        }
        return req
    }

    // Public, ne nécessite pas de connexion : trié par jour décroissant.
    func fetchTodayId() async throws -> String {
        let req = request("/api/movies?skip=0&take=1")
        let (data, response) = try await URLSession.shared.data(for: req)
        try Self.check(response)
        let items = try JSONDecoder().decode([GameListItem].self, from: data)
        guard let first = items.first else { throw GameError.empty }
        return first.id
    }

    func fetchMatrice(id: String) async throws -> MatriceResponse {
        let req = request("/api/movies/\(id)/matrice")
        let (data, response) = try await URLSession.shared.data(for: req)
        try Self.check(response)
        return try JSONDecoder().decode(MatriceResponse.self, from: data)
    }

    func submitAnswer(id: String, externalId: String) async throws -> AnswerResponse {
        let body = try JSONSerialization.data(withJSONObject: ["externalId": externalId])
        let req = request("/api/movies/\(id)/answers", method: "POST", body: body)
        let (data, response) = try await URLSession.shared.data(for: req)
        try Self.check(response)
        return try JSONDecoder().decode(AnswerResponse.self, from: data)
    }

    private static func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw GameError.http(code)
        }
    }
}
