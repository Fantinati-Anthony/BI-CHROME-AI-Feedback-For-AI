# My-Feedbacks Bridge — common ops recipes
#
# Tab-indented (Makefile convention). Run from inside `bridge/`.
#
# Quick list :
#   make help            # show this list
#   make lint            # php -l on the bridge
#   make image           # docker build (Dockerfile)
#   make up              # docker compose up -d (bridge + bundled MySQL)
#   make down            # docker compose down -v
#   make logs            # follow bridge logs
#   make sign-check      # cross-language HMAC compatibility test
#   make clean           # remove runtime files (config / audit / nonces)

SHELL := /usr/bin/env bash

# ── Defaults — override on the command line ─────────────────────────
PHP        ?= php
DOCKER     ?= docker
COMPOSE    ?= docker compose

# Test vector — DO NOT use this secret anywhere real.
TEST_SECRET ?= test-secret-do-not-use
TEST_TS     ?= 1716000000
TEST_NONCE  ?= aaaaaaaaaaaaaaaa
TEST_OP     ?= meta
TEST_EXPECT := 655dd858fe4375fbe5ee18531214b75b1bfb825727792002f60c36280bd37118

# ─────────────────────────────────────────────────────────────────────

.PHONY: help
help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

.PHONY: lint
lint:  ## PHP syntax check on the bridge entrypoint
	$(PHP) -l myfb-bridge.php

.PHONY: image
image: ## Build the Docker image (myfb-bridge:latest)
	$(DOCKER) build -t myfb-bridge:latest .

.PHONY: up
up: ## docker compose up -d (bridge + bundled MySQL for testing)
	$(COMPOSE) up -d
	@echo
	@echo "  Bridge ready at http://localhost:8080/myfb-bridge.php"
	@echo "  Run the setup wizard with host=db port=3306 user=myfb_readonly"
	@echo

.PHONY: down
down: ## docker compose down -v (drops the bundled MySQL volume too)
	$(COMPOSE) down -v

.PHONY: logs
logs: ## Follow the bridge container logs
	$(COMPOSE) logs -f bridge

.PHONY: sign-check
sign-check: ## Cross-language HMAC compatibility test (PHP/Python/Go/Node)
	@echo "Test vector:"
	@echo "  secret=$(TEST_SECRET)  ts=$(TEST_TS)  nonce=$(TEST_NONCE)  op=$(TEST_OP)  args={}"
	@echo "  expected=$(TEST_EXPECT)"
	@echo
	@printf "  PHP    : "
	@$(PHP) -r 'echo hash_hmac("sha256","$(TEST_TS).$(TEST_NONCE).$(TEST_OP).[]","$(TEST_SECRET)"),"\n";'
	@command -v python3  >/dev/null && printf "  Python : " && \
	  python3 -c "import hmac, hashlib; print(hmac.new(b'$(TEST_SECRET)', b'$(TEST_TS).$(TEST_NONCE).$(TEST_OP).[]', hashlib.sha256).hexdigest())" || true
	@command -v node >/dev/null && printf "  Node   : " && \
	  node -e "const c=require('crypto'); console.log(c.createHmac('sha256','$(TEST_SECRET)').update('$(TEST_TS).$(TEST_NONCE).$(TEST_OP).[]').digest('hex'))" || true
	@command -v openssl >/dev/null && printf "  OpenSSL: " && \
	  printf '%s' '$(TEST_TS).$(TEST_NONCE).$(TEST_OP).[]' | \
	  openssl dgst -sha256 -hmac "$(TEST_SECRET)" -r | cut -d' ' -f1 || true

.PHONY: clean
clean: ## Remove runtime files (config / audit / nonces) — re-runs the wizard
	@echo "Removing runtime files (you will need to re-run the setup wizard) ..."
	rm -f myfb-bridge.config.php myfb-bridge.audit.log myfb-bridge.nonces myfb-bridge.nonces.tmp
	@echo "Done. Visit your bridge URL to re-run setup."
