ARG BUSYBOX=busybox:1.37.0@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec

FROM --platform=$BUILDPLATFORM ${BUSYBOX} AS www

COPY --from=site . /src
RUN cd /src \
    && rm -rf og reel.mp4 reel.jpg _headers \
    && find . -name '*.html' ! -name index.html ! -name 404.html | while read -r page; do \
        dir="${page%.html}"; mkdir -p "$dir"; mv "$page" "$dir/index.html"; \
    done \
    && printf '<!doctype html><meta charset="utf-8"><title>Docker Compose Maker</title><script>location.replace("/compose/"+location.search+location.hash)</script><noscript><meta http-equiv="refresh" content="0;url=/compose/"></noscript>\n' > index.html

COPY --chmod=644 LICENSE /src/LICENSE-Apache-2.0.txt
COPY --chmod=644 dcm/LICENSE /src/LICENSE-AGPL-3.0.txt

ARG REVISION=unknown
RUN printf 'Docker Compose Maker is free software under the GNU AGPL-3.0-only (LICENSE-AGPL-3.0.txt).\nThe rest of this image is Apache-2.0 (LICENSE-Apache-2.0.txt).\n\nCorresponding source: https://github.com/ajnart/self-host\nCommit: %s\n' "$REVISION" > /src/SOURCE.txt

FROM ${BUSYBOX}

COPY --from=www --chmod=a+rX /src /www
COPY --chmod=644 dcm/httpd.conf /etc/httpd.conf

EXPOSE 7576

USER 65534:65534

CMD ["httpd", "-f", "-v", "-p", "7576", "-h", "/www", "-c", "/etc/httpd.conf"]
