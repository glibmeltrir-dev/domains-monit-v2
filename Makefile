# DomainOps v2 — management shortcuts around docker compose.
# Usage: make <target>   (run `make help` to list everything)

COMPOSE ?= docker compose
# Service for targeted commands, e.g. `make logs s=worker`
s ?=

.DEFAULT_GOAL := help

.PHONY: help up build rebuild deploy down stop start restart restart-app \
        ps status logs seed migrate psql redis sh-api sh-worker pull clean nuke

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	 | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

up: ## Start the whole stack in the background
	$(COMPOSE) up -d

build: ## Build all images
	$(COMPOSE) build

rebuild: ## Rebuild images and (re)start the stack
	$(COMPOSE) up -d --build

deploy: ## git pull + rebuild + restart (use on the server to update)
	git pull && $(COMPOSE) up -d --build

down: ## Stop and remove containers (keeps data volumes)
	$(COMPOSE) down

stop: ## Stop containers
	$(COMPOSE) stop $(s)

start: ## Start stopped containers
	$(COMPOSE) start $(s)

restart: ## Restart containers (all, or `make restart s=worker`)
	$(COMPOSE) restart $(s)

restart-app: ## Restart just app services (api, worker, scheduler)
	$(COMPOSE) restart api worker scheduler

ps: ## Show container status
	$(COMPOSE) ps

status: ## Show domain monitoring status counts
	$(COMPOSE) exec postgres sh -c \
	 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -c "select monitoring_status, count(*) from domains group by 1 order by 2 desc;"'

logs: ## Tail logs (all, or `make logs s=scheduler`)
	$(COMPOSE) logs -f --tail=100 $(s)

seed: ## Import domains + templates + integrations (one-off)
	$(COMPOSE) run --rm api npm run seed

migrate: ## Apply the database schema
	$(COMPOSE) run --rm api npm run migrate

psql: ## Open a psql shell in the postgres container
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

redis: ## Open redis-cli in the redis container
	$(COMPOSE) exec redis redis-cli

sh-api: ## Open a shell in the api container
	$(COMPOSE) exec api sh

sh-worker: ## Open a shell in the worker container
	$(COMPOSE) exec worker sh

pull: ## Pull the latest code from git
	git pull

clean: ## Remove macOS AppleDouble junk files
	./scripts/clean-appledouble.sh

nuke: ## DANGER: stop stack and DELETE all data volumes (postgres + redis)
	$(COMPOSE) down -v
