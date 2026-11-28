FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html icon.png home.webp adblock.webp scan.webp play-home.webp play-webguard.webp eum-security-pro-full-1.0.0.apk /srv/
