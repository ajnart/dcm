FROM --platform=$BUILDPLATFORM busybox:1.37.0 AS www

COPY --from=site . /src
RUN cd /src \
    && rm -rf og reel.mp4 reel.jpg _headers \
    && find . -name '*.html' ! -name index.html ! -name 404.html | while read -r page; do \
        dir="${page%.html}"; mkdir -p "$dir"; mv "$page" "$dir/index.html"; \
    done \
    && printf '<!doctype html><meta charset="utf-8"><title>Docker Compose Maker</title><script>location.replace("/compose"+location.search+location.hash)</script><noscript><meta http-equiv="refresh" content="0;url=/compose"></noscript>\n' > index.html

FROM busybox:1.37.0

COPY --from=www --chmod=a+rX /src /www
COPY --chmod=644 httpd.conf /etc/httpd.conf

EXPOSE 7576

USER 65534:65534

CMD ["httpd", "-f", "-v", "-p", "7576", "-h", "/www", "-c", "/etc/httpd.conf"]
