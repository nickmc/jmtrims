# Hatchbox reads this to learn the app has a web process. Without a `web:` entry
# it treats the app as a static site and generates a Caddy config with no
# reverse_proxy, so every request 404s regardless of the Caddyfile setting.
#
# `docker compose up` runs in the foreground so systemd supervises the container
# directly (Restart=always). deploy/hatchbox-build.sh only pulls the image; this
# owns the container lifecycle.
web: docker compose up
