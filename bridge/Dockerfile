# My-Feedbacks Bridge — minimal containerized deployment
#
# Build :
#   docker build -t myfb-bridge .
#
# Run (HTTP only — put a TLS proxy in front for prod) :
#   docker run -d --name myfb-bridge -p 8080:80 \
#     -v $(pwd)/data:/var/www/html/data \
#     myfb-bridge
#
# Open http://localhost:8080/myfb-bridge.php once → setup wizard
# generates the secret and writes the config inside the bind-mounted
# /data volume.

FROM php:8.2-apache

# Install PDO drivers (MySQL by default ; uncomment pgsql if needed).
RUN docker-php-ext-install pdo_mysql \
    && rm -rf /var/lib/apt/lists/*
# RUN apt-get update && apt-get install -y libpq-dev \
#     && docker-php-ext-install pdo_pgsql \
#     && rm -rf /var/lib/apt/lists/*

# Copy the bridge + Apache .htaccess template that protects the
# sibling config / audit / nonces files.
COPY myfb-bridge.php /var/www/html/
COPY .htaccess        /var/www/html/

# Apache needs AllowOverride All for .htaccess to take effect.
RUN sed -i \
    's|AllowOverride None|AllowOverride All|g' \
    /etc/apache2/apache2.conf

# Mount /data and symlink the runtime files there so the setup
# wizard's writes persist across container restarts.
RUN mkdir -p /var/www/html/data \
    && chown -R www-data:www-data /var/www/html/data \
    && ln -sf /var/www/html/data/myfb-bridge.config.php /var/www/html/myfb-bridge.config.php \
    && ln -sf /var/www/html/data/myfb-bridge.audit.log  /var/www/html/myfb-bridge.audit.log  \
    && ln -sf /var/www/html/data/myfb-bridge.nonces     /var/www/html/myfb-bridge.nonces

# Enable mod_headers / mod_rewrite for the optional rules in .htaccess.
RUN a2enmod headers rewrite

EXPOSE 80
