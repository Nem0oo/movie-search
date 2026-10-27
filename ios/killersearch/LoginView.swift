import SwiftUI
import AuthenticationServices

// La connexion Google passe par le flux NextAuth existant du site, rejoué tel
// quel. Une simple WKWebView ne fonctionne pas : Google bloque activement
// "Sign in with Google" dans les WebView embarquées (détection anti-phishing
// côté Google, indépendante de ce site). ASWebAuthenticationSession est le
// contexte que Google reconnaît comme légitime.
//
// Pas de WebKit du tout ici (ni WKWebView, ni WKWebsiteDataStore) : ça crashe
// (pointer authentication trap dans WKWebsiteDataStore.defaultDataStore())
// dans les environnements qui hébergent l'app sans process/bundle propre
// (ex. LiveContainer) — WebKit a besoin de cette identité pour son
// architecture multi-process. ASWebAuthenticationSession en mode non-éphémère
// partage déjà ses cookies directement avec HTTPCookieStorage.shared au
// niveau système, donc inutile de passer par WebKit pour les récupérer.
enum CookieBridge {
    // NextAuth nomme systématiquement son cookie de session avec
    // "session-token" dedans (parfois découpé en .0/.1/... s'il est
    // volumineux) — signal plus fiable qu'un nom exact jamais confirmé sur ce
    // site, et plus précis que "n'importe quel nouveau cookie" (essayé puis
    // abandonné : déclenché à tort par des cookies analytics/expérimentation
    // posés dès le chargement de /login, avant même Google).
    static func hasSessionCookie() -> Bool {
        guard let url = URL(string: "https://1jour1film.fr") else { return false }
        let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
        return cookies.contains { $0.name.lowercased().contains("session-token") }
    }
}

@MainActor
final class LoginCoordinator: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var pollTimer: Timer?
    private var onFinished: (() -> Void)?

    func start(onFinished: @escaping () -> Void) {
        self.onFinished = onFinished

        // Le site ne redirige jamais vers ce schéma : on ne compte pas sur le
        // callback pour savoir que c'est fini, seulement sur le polling des
        // cookies ci-dessous (+ la fermeture manuelle par l'utilisateur).
        let session = ASWebAuthenticationSession(
            url: URL(string: "https://1jour1film.fr/login")!,
            callbackURLScheme: "killersearch"
        ) { [weak self] _, _ in
            self?.finish()
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        session.start()

        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            if CookieBridge.hasSessionCookie() {
                self?.session?.cancel()
            }
        }
    }

    private func finish() {
        pollTimer?.invalidate()
        pollTimer = nil
        onFinished?()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
