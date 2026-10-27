import Foundation

// L'API du jeu renvoie parfois des nombres sous forme de string ("min": "1997")
// et parfois sous forme numérique ("min": 1999) pour le même champ selon les cas.
enum FlexibleNumber: Codable {
    case number(Double)
    case string(String)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let d = try? container.decode(Double.self) {
            self = .number(d)
            return
        }
        if let s = try? container.decode(String.self) {
            self = .string(s)
            return
        }
        throw DecodingError.typeMismatch(
            FlexibleNumber.self,
            .init(codingPath: decoder.codingPath, debugDescription: "Ni nombre ni string")
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .number(let d): try container.encode(d)
        case .string(let s): try container.encode(s)
        }
    }

    var doubleValue: Double? {
        switch self {
        case .number(let d): return d
        case .string(let s): return Double(s)
        }
    }
}

// ---------- Jeu 1jour1film.fr ----------

struct ClueItem: Codable {
    let name: String?
    let status: String
    let order: Int?
    let picture: String?
}

struct Certification: Codable {
    let name: String?
    let status: String
}

struct RangeField: Codable {
    let status: String
    let value: FlexibleNumber?
    let min: FlexibleNumber?
    let max: FlexibleNumber?
    let comparison: String?
    let targetValue: FlexibleNumber?
}

struct MovieCorrection: Codable {
    let title: String?
    let poster: String?
    let mainList: [ClueItem]?
    let secondaryList: [ClueItem]?
    let genres: [ClueItem]?
    let countries: [ClueItem]?
    let spokenLanguages: [ClueItem]?
    let productions: [ClueItem]?
    let providers: [ClueItem]?
    let certification: Certification?
    let year: RangeField?
    let runtime: RangeField?
    let budget: RangeField?
    let tmdbRating: RangeField?
}

struct MatriceResponse: Codable {
    let id: String?
    let movieCorrection: MovieCorrection
    let day: String?
    let type: String?
}

struct AnswerResponse: Codable {
    let rank: Int?
    let status: String
    let externalId: String
    let movieCorrection: MovieCorrection
    let matrice: MatriceResponse?
}

struct GameListItem: Codable {
    let id: String
    let day: String?
}

// ---------- TMDB ----------

struct TMDBMovie: Codable, Identifiable {
    let id: Int
    let title: String?
    let name: String?
    let overview: String?
    let posterPath: String?
    let releaseDate: String?
    let voteAverage: Double?
    let voteCount: Int?
    let genreIds: [Int]?

    enum CodingKeys: String, CodingKey {
        case id, title, name, overview
        case posterPath = "poster_path"
        case releaseDate = "release_date"
        case voteAverage = "vote_average"
        case voteCount = "vote_count"
        case genreIds = "genre_ids"
    }

    var displayTitle: String { title ?? name ?? "(Sans titre)" }
}

struct TMDBDiscoverResponse: Codable {
    let results: [TMDBMovie]?
    let totalPages: Int?

    enum CodingKeys: String, CodingKey {
        case results
        case totalPages = "total_pages"
    }
}

struct TMDBGenre: Codable {
    let id: Int
    let name: String
}

struct TMDBGenreListResponse: Codable {
    let genres: [TMDBGenre]
}

struct TMDBNamedResult: Codable {
    let id: Int
    let name: String
    // Absent sur /search/person, présent sur /search/company — sert de signe
    // de "fiche réelle" pour départager les doublons de compagnies (voir
    // TMDBService.pickBestNamedResult).
    let logoPath: String?

    enum CodingKeys: String, CodingKey {
        case id, name
        case logoPath = "logo_path"
    }
}

struct TMDBSearchResponse: Codable {
    let results: [TMDBNamedResult]
}

struct TMDBCrewMember: Codable {
    let job: String?
}

struct TMDBCredits: Codable {
    let cast: [TMDBNamedResult]?
    let crew: [TMDBCrewMember]?
}

struct TMDBCountryRef: Codable { let name: String? }
struct TMDBLanguageRef: Codable { let name: String? }
struct TMDBCompanyRef: Codable { let name: String? }

struct TMDBMovieDetail: Codable {
    let genres: [TMDBGenre]?
    let productionCountries: [TMDBCountryRef]?
    let spokenLanguages: [TMDBLanguageRef]?
    let productionCompanies: [TMDBCompanyRef]?
    let credits: TMDBCredits?

    enum CodingKeys: String, CodingKey {
        case genres
        case productionCountries = "production_countries"
        case spokenLanguages = "spoken_languages"
        case productionCompanies = "production_companies"
        case credits
    }
}

struct TemplateCounts {
    var cast = 0
    var crew = 0
    var genres = 0
    var countries = 0
    var languages = 0
    var companies = 0
}
