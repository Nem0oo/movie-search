#!/bin/sh
envsubst '${TMDB_API_KEY}' < /usr/local/apache2/htdocs/config.js > /tmp/config.js \
  && mv /tmp/config.js /usr/local/apache2/htdocs/config.js
exec httpd -D FOREGROUND