import SwiftUI

struct ContentView: View {
    @StateObject private var vm = GameViewModel()
    @StateObject private var loginCoordinator = LoginCoordinator()
    @State private var showSettings = false
    @State private var showCookieDebug = false

    var body: some View {
        NavigationView {
            List {
                Section {
                    HStack {
                        Circle()
                            .fill(vm.isLoggedIn ? Color.green : Color.orange)
                            .frame(width: 10, height: 10)
                        Text(vm.isLoggedIn ? "Connecté" : "Non connecté")
                        Spacer()
                        Button(vm.isLoggedIn ? "Se reconnecter" : "Se connecter") {
                            loginCoordinator.start { vm.onLoginFinished() }
                        }
                        .font(.footnote)
                    }
                }

                if let win = vm.gameWon {
                    Section {
                        Label("Trouvé : « \(win.title) » — rang \(win.rank)", systemImage: "trophy.fill")
                            .foregroundColor(.green)
                            .fontWeight(.bold)
                    }
                }

                Section("Critères détectés") {
                    if vm.criteria.isEmpty {
                        Text("Aucun critère confirmé pour l'instant.")
                            .foregroundColor(.secondary)
                    } else {
                        ForEach(vm.criteria, id: \.self) { c in
                            Text(c).font(.footnote)
                        }
                    }
                }

                Section {
                    Text(vm.statusMessage).font(.footnote).foregroundColor(.secondary)
                }

                Section("Résultats") {
                    ForEach(vm.results) { movie in
                        MovieRow(
                            movie: movie,
                            resultText: vm.guessResultText[movie.id],
                            inFlight: vm.guessInFlight.contains(movie.id)
                        ) {
                            Task { await vm.submitGuess(movie) }
                        }
                    }
                }
            }
            .navigationTitle("Killer Search")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Réglages") { showSettings = true }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button("Actualiser") { Task { await vm.refreshGame() } }
                        Button("Nouvelle partie", role: .destructive) { vm.resetGame() }
                        Button("Nouvelle identité anonyme", role: .destructive) { vm.resetAnonymousIdentity() }
                        Button("Diagnostic cookies") { showCookieDebug = true }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsSheet(apiKey: $vm.apiKey)
            }
            .sheet(isPresented: $showCookieDebug) {
                NavigationView { CookieDebugView() }
            }
            .task { await vm.start() }
        }
    }
}

private struct MovieRow: View {
    let movie: TMDBMovie
    let resultText: String?
    let inFlight: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 10) {
                AsyncImage(url: TMDBService.shared.posterURL(for: movie.posterPath)) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: {
                    Color.gray.opacity(0.2)
                }
                .frame(width: 46, height: 69)
                .clipShape(RoundedRectangle(cornerRadius: 6))

                VStack(alignment: .leading, spacing: 4) {
                    Text(movie.displayTitle).font(.subheadline).fontWeight(.semibold)
                    if let date = movie.releaseDate, !date.isEmpty {
                        Text(date).font(.caption).foregroundColor(.secondary)
                    }
                    if inFlight {
                        Text("Envoi…").font(.caption).foregroundColor(.secondary)
                    } else if let resultText {
                        Text(resultText).font(.caption).foregroundColor(.green)
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }
}

private struct SettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var apiKey: String
    @State private var draft: String = ""

    var body: some View {
        NavigationView {
            Form {
                Section("Clé API TMDB") {
                    SecureField("Clé TMDB", text: $draft)
                    Text("Stockée uniquement sur cet appareil.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("Réglages")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Enregistrer") {
                        apiKey = draft
                        dismiss()
                    }
                }
            }
            .onAppear { draft = apiKey }
        }
    }
}
