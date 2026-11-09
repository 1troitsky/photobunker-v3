FROM composer:2 AS composer
FROM php:8.4.27-cli-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpq-dev libonig-dev libzip-dev libxml2-dev libsqlite3-dev libcurl4-openssl-dev unzip \
 && docker-php-ext-install -j2 pdo_pgsql pdo_sqlite mbstring dom xml xmlwriter curl zip \
 && rm -rf /var/lib/apt/lists/*
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
WORKDIR /app
