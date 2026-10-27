# Killer Search — extension Chrome (beta)

## Installation

1. Ouvrir `chrome://extensions`.
2. Activer le **mode développeur** (en haut à droite).
3. Cliquer **Charger l'extension non empaquetée** et sélectionner le dossier `extension/`.
4. Cliquer sur l'icône de l'extension dans la barre d'outils : le panneau latéral (side panel) s'ouvre.
5. Dans **Réglages**, coller ta clé API TMDB, puis **Enregistrer**.

## Utilisation

1. Ouvrir une partie sur `https://1jour1film.fr` dans un onglet — le bandeau en haut du panneau passe à "Partie détectée ✓" dès que la page fait son premier appel réseau vers l'API du jeu.
2. Remplir les filtres et lancer une recherche.
3. **Un seul résultat** → la proposition est envoyée automatiquement à 1jour1film.fr, et le résultat de comparaison (acteurs/genres/pays communs, rang si trouvé) s'affiche sous la fiche.
4. **Plusieurs résultats** → cliquer sur une fiche pour l'envoyer comme proposition.

## Limites connues de cette beta

- Nécessite Chrome 111+ (pour l'injection en `world: "MAIN"`).
- La détection de partie dépend d'un appel réseau déjà émis par la page elle-même (`/api/movies/{id}/matrice` ou `/answers`) — s'il n'y en a pas eu depuis le chargement de l'onglet, le statut reste "en attente".
- La clé TMDB est stockée en clair dans `chrome.storage.local` (locale à ce navigateur, jamais transmise ailleurs qu'à `api.themoviedb.org`).
- Pas encore de remplissage automatique des filtres à partir de la `matrice` cumulée du jeu (acteurs/genres/années déjà validés) — prévu pour une prochaine itération.
