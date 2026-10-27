import Foundation

enum Store {
    private static let defaults = UserDefaults.standard
    private static let mmuidKey = "ks_mmuid"
    private static let apiKeyKey = "ks_tmdb_api_key"

    static var mmuid: String {
        if let existing = defaults.string(forKey: mmuidKey) {
            return existing
        }
        let generated = UUID().uuidString.lowercased()
        defaults.set(generated, forKey: mmuidKey)
        return generated
    }

    static var tmdbApiKey: String {
        get { defaults.string(forKey: apiKeyKey) ?? "" }
        set { defaults.set(newValue, forKey: apiKeyKey) }
    }

    // Nouvelle identité anonyme : pratique pour retester le fonctionnement
    // depuis zéro sans attendre un nouveau film du jour (le mmuid persistant
    // se comporte comme un vrai joueur anonyme récurrent, exactement comme le
    // localStorage du site — donc "déjà trouvé" reste vrai tant qu'on garde le
    // même mmuid, volontairement).
    @discardableResult
    static func regenerateMmuid() -> String {
        let generated = UUID().uuidString.lowercased()
        defaults.set(generated, forKey: mmuidKey)
        return generated
    }
}
