import SwiftUI

// Écran de diagnostic : affiche les cookies réellement posés pour
// 1jour1film.fr dans HTTPCookieStorage.shared, pour vérifier concrètement
// (plutôt que deviner) ce que la connexion Google a effectivement posé.
struct CookieDebugView: View {
    @State private var cookies: [HTTPCookie] = []

    var body: some View {
        List {
            if cookies.isEmpty {
                Text("Aucun cookie pour 1jour1film.fr pour l'instant.")
                    .foregroundColor(.secondary)
            } else {
                ForEach(cookies, id: \.name) { cookie in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(cookie.name).font(.footnote).fontWeight(.semibold)
                        Text("valeur : \(truncated(cookie.value))")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        if let expires = cookie.expiresDate {
                            Text("expire : \(expires.formatted())")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        } else {
                            Text("expire : session")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Cookies (diagnostic)")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Actualiser") { refresh() }
            }
        }
        .onAppear { refresh() }
    }

    private func refresh() {
        cookies = HTTPCookieStorage.shared.cookies(for: URL(string: "https://1jour1film.fr")!) ?? []
    }

    private func truncated(_ value: String) -> String {
        value.count > 40 ? String(value.prefix(40)) + "…" : value
    }
}
