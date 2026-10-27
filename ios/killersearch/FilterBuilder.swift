import Foundation

struct BuiltFilters {
    var params: [String: String] = [:]
    var criteria: [String] = []
    var expectedCounts = TemplateCounts()
}

enum ComparisonLabel {
    static let map = ["lower": "plus bas", "higher": "plus haut", "equal": "identique"]
    static func label(_ raw: String?) -> String {
        guard let raw else { return "" }
        return map[raw] ?? raw
    }
}

enum FilterBuilder {
    // Réponse GET /matrice : movieCorrection est déjà l'état cumulé.
    // Réponse POST /answers : movieCorrection de premier niveau ne concerne que
    // CE guess, l'état cumulé est dans matrice.movieCorrection.
    static func matriceCorrection(fromMatrice matrice: MatriceResponse) -> MovieCorrection {
        matrice.movieCorrection
    }

    static func matriceCorrection(fromAnswer answer: AnswerResponse) -> MovieCorrection {
        answer.matrice?.movieCorrection ?? answer.movieCorrection
    }

    static func build(from mc: MovieCorrection) async -> BuiltFilters {
        var result = BuiltFilters()
        let tmdb = TMDBService.shared

        let validCast = (mc.mainList ?? []).filter { $0.status == "valid" && !($0.name ?? "").isEmpty }
        if !validCast.isEmpty {
            var ids: [Int] = []
            for c in validCast { if let id = await tmdb.resolvePersonId(c.name!) { ids.append(id) } }
            if !ids.isEmpty {
                result.params["with_cast"] = ids.map(String.init).joined(separator: ",")
                result.criteria.append("Acteurs : " + validCast.map { $0.name! }.joined(separator: ", "))
            }
        }

        let validCrew = (mc.secondaryList ?? []).filter { $0.status == "valid" && !($0.name ?? "").isEmpty }
        if !validCrew.isEmpty {
            var ids: [Int] = []
            for c in validCrew { if let id = await tmdb.resolvePersonId(c.name!) { ids.append(id) } }
            if !ids.isEmpty {
                result.params["with_crew"] = ids.map(String.init).joined(separator: ",")
                result.criteria.append("Réalisateur(s) : " + validCrew.map { $0.name! }.joined(separator: ", "))
            }
        }

        let validGenres = (mc.genres ?? []).filter { $0.status == "valid" && !($0.name ?? "").isEmpty }
        let invalidGenres = (mc.genres ?? []).filter { $0.status == "invalid" && !($0.name ?? "").isEmpty }
        if !validGenres.isEmpty {
            let ids = validGenres.compactMap { tmdb.genreId(for: $0.name!) }
            if !ids.isEmpty {
                result.params["with_genres"] = ids.map(String.init).joined(separator: ",")
                result.criteria.append("Genres inclus : " + validGenres.map { $0.name! }.joined(separator: ", "))
            }
        }
        if !invalidGenres.isEmpty {
            let ids = invalidGenres.compactMap { tmdb.genreId(for: $0.name!) }
            if !ids.isEmpty {
                result.params["without_genres"] = ids.map(String.init).joined(separator: ",")
                result.criteria.append("Genres exclus : " + invalidGenres.map { $0.name! }.joined(separator: ", "))
            }
        }

        let validCompanies = (mc.productions ?? []).filter { $0.status == "valid" && !($0.name ?? "").isEmpty }
        if !validCompanies.isEmpty {
            var ids: [Int] = []
            for c in validCompanies { if let id = await tmdb.resolveCompanyId(c.name!) { ids.append(id) } }
            if !ids.isEmpty {
                result.params["with_companies"] = ids.map(String.init).joined(separator: ",")
                result.criteria.append("Compagnie(s) : " + validCompanies.map { $0.name! }.joined(separator: ", "))
            }
        }

        let validCountries = (mc.countries ?? []).filter { $0.status == "valid" && !($0.name ?? "").isEmpty }
        if !validCountries.isEmpty {
            result.params["with_origin_country"] = validCountries.map { $0.name! }.joined(separator: ",")
            result.criteria.append("Pays : " + validCountries.map { $0.name! }.joined(separator: ", "))
        }

        if let validLang = (mc.spokenLanguages ?? []).first(where: { $0.status == "valid" && !($0.name ?? "").isEmpty }) {
            result.params["with_original_language"] = validLang.name!
            result.criteria.append("Langue : \(validLang.name!)")
        }

        // Plateformes volontairement non envoyées comme filtre discover : les
        // droits de streaming/VOD changent dans le temps, la donnée "valide" de
        // la partie peut être obsolète par rapport à TMDB en direct (cas réel
        // observé : "Les Heures retrouvées", 0 résultat avec le filtre alors
        // que le film est le bon, il n'est simplement plus dispo sur les
        // plateformes en question aujourd'hui). Même traitement que
        // `certification`.
        let validProviders = (mc.providers ?? []).filter { $0.status == "valid" && !($0.name ?? "").isEmpty }
        if !validProviders.isEmpty {
            result.criteria.append("Plateforme(s) (indicatif, non filtré) : " + validProviders.map { $0.name! }.joined(separator: ", "))
        }

        // Classification volontairement non envoyée comme filtre discover : les
        // données de classification par pays sont trop incomplètes sur TMDB, ce
        // filtre "tout ou rien" videait la liste même quand le bon film matchait
        // tous les autres critères (voir NOTES.md côté extension Chrome).
        if let cert = mc.certification, cert.status == "valid", let name = cert.name, !name.isEmpty {
            result.criteria.append("Classification (indicatif, non filtré) : \(name)")
        }

        applyYearRange(mc.year, &result)
        applyIntRange(mc.runtime, gteKey: "with_runtime.gte", lteKey: "with_runtime.lte", label: "Durée (min)", &result)
        applyFloatRange(mc.tmdbRating, gteKey: "vote_average.gte", lteKey: "vote_average.lte", label: "Note TMDB", tolerance: 0.5, &result)

        result.expectedCounts = TemplateCounts(
            cast: mc.mainList?.count ?? 0,
            crew: mc.secondaryList?.count ?? 0,
            genres: mc.genres?.count ?? 0,
            countries: mc.countries?.count ?? 0,
            languages: mc.spokenLanguages?.count ?? 0,
            companies: mc.productions?.count ?? 0
        )
        if result.expectedCounts.cast > 0 { result.criteria.append("Casting complet : \(result.expectedCounts.cast) acteurs") }
        if result.expectedCounts.crew > 0 { result.criteria.append("Réalisateur(s) (nombre) : \(result.expectedCounts.crew)") }
        if result.expectedCounts.genres > 0 { result.criteria.append("Genres (nombre) : \(result.expectedCounts.genres)") }
        if result.expectedCounts.countries > 0 { result.criteria.append("Pays (nombre) : \(result.expectedCounts.countries)") }
        if result.expectedCounts.languages > 0 { result.criteria.append("Langues (nombre) : \(result.expectedCounts.languages)") }
        if result.expectedCounts.companies > 0 { result.criteria.append("Compagnies (nombre) : \(result.expectedCounts.companies)") }

        return result
    }

    private static func applyYearRange(_ field: RangeField?, _ result: inout BuiltFilters) {
        guard let field else { return }
        if field.status == "valid", let v = field.value?.doubleValue {
            let year = Int(v)
            result.params["primary_release_year"] = String(year)
            result.criteria.append("Année = \(year)")
            return
        }
        if let maxV = field.max?.doubleValue {
            let bound = Int(maxV) - 1
            result.params["primary_release_date.lte"] = "\(bound)-12-31"
            result.criteria.append("Année ≤ \(bound)")
        }
        if let minV = field.min?.doubleValue {
            let bound = Int(minV) + 1
            result.params["primary_release_date.gte"] = "\(bound)-01-01"
            result.criteria.append("Année ≥ \(bound)")
        }
    }

    private static func applyIntRange(_ field: RangeField?, gteKey: String, lteKey: String, label: String, _ result: inout BuiltFilters) {
        guard let field else { return }
        if field.status == "valid", let v = field.value?.doubleValue {
            let iv = Int(v)
            result.params[gteKey] = String(iv)
            result.params[lteKey] = String(iv)
            result.criteria.append("\(label) = \(iv)")
            return
        }
        if let maxV = field.max?.doubleValue {
            let bound = Int(maxV) - 1
            result.params[lteKey] = String(bound)
            result.criteria.append("\(label) ≤ \(bound)")
        }
        if let minV = field.min?.doubleValue {
            let bound = Int(minV) + 1
            result.params[gteKey] = String(bound)
            result.criteria.append("\(label) ≥ \(bound)")
        }
    }

    private static func applyFloatRange(_ field: RangeField?, gteKey: String, lteKey: String, label: String, tolerance: Double, _ result: inout BuiltFilters) {
        guard let field else { return }
        if field.status == "valid", let v = field.value?.doubleValue {
            result.params[gteKey] = String(v - tolerance)
            result.params[lteKey] = String(v + tolerance)
            result.criteria.append(tolerance > 0 ? "\(label) ≈ \(v)" : "\(label) = \(v)")
            return
        }
        if let maxV = field.max?.doubleValue {
            result.params[lteKey] = String(maxV)
            result.criteria.append("\(label) ≤ \(maxV)")
        }
        if let minV = field.min?.doubleValue {
            result.params[gteKey] = String(minV)
            result.criteria.append("\(label) ≥ \(minV)")
        }
    }

    static func templateMatches(_ counts: TemplateCounts, expected: TemplateCounts) -> Bool {
        func ok(_ exp: Int, _ got: Int) -> Bool { exp == 0 || exp == got }
        return ok(expected.cast, counts.cast)
            && ok(expected.crew, counts.crew)
            && ok(expected.genres, counts.genres)
            && ok(expected.countries, counts.countries)
            && ok(expected.languages, counts.languages)
            && ok(expected.companies, counts.companies)
    }
}
