# Killer Search

A web app to search for movies using the [TMDB API](https://www.themoviedb.org/), served by Apache HTTPd in a Docker container.

## Why

I play a game with my coworker where we need to find a movie name by guessing other movie names. Each try can help us find the movie by telling us if the movie we are looking for has the same actor, is shorter/longer, was released before/after, has the same styles... Looking up online was a long and painful task. I decided this needed a good search engine...
The game can be found here : [1jour1film](https://1jour1film.fr)

## What it does

- Filter by country, release year (exact or range), and duration
- Genre selection loaded dynamically from the API
- Multi-select autocomplete for actors and production companies
- Results displayed in a floating panel (top 10)
- Click a movie → copies the title to clipboard
- Live preview of the TMDB query

## Prerequisites

- Docker
- A TMDB API key (free at [themoviedb.org](https://www.themoviedb.org/settings/api))

## Run locally

```bash
docker run -d \
  -e TMDB_API_KEY=<your_key> \
  -p 8080:80 \
  nem0oo/killer-search:latest
```

Open `http://localhost:8080`.

The API key is injected at runtime via `envsubst` — it is not baked into the image.

⚠️ Do not expose this container publicly without adding an authentication layer — the TMDB API key would be visible in the browser. ⚠️

## Build from source
docker build --build-arg SHA=$(git rev-parse HEAD) -t killer-search .
docker run -d -e TMDB_API_KEY=<your_key> -p 8080:80 killer-search

## Stack

| Component  | Technology |
|------------|------------|
| Frontend   | HTML / CSS / Vanilla JavaScript |
| Server     | Apache HTTPd (Docker image `httpd:alpine`) |
| CI/CD      | GitHub Actions |
| Registry   | Docker Hub |
| Deployment | n8n (webhook → Watchtower) |

## CI/CD

### Pull Request → `main`

1. Build the Docker image
2. Start the container
3. Verify that `/version.txt` contains the correct commit SHA

### Push to `main`

1. Tag the current `latest` image as `previous` (for rollback)
2. Build and push the new `latest` image to Docker Hub
3. Trigger deployment via n8n webhook

> Production is protected by htpasswd — no automated production check.

### Required secrets

| Secret | Description |
|--------|-------------|
| `DOCKERHUB_USERNAME` | Docker Hub username |
| `DOCKERHUB_TOKEN`    | Docker Hub access token |
| `N8N_WEBHOOK_ID`     | n8n webhook ID triggering the redeployment |
