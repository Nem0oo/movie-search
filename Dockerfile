FROM httpd:alpine3.21
RUN apk add --no-cache gettext  # pour envsubst

COPY ./src/ /usr/local/apache2/htdocs/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]