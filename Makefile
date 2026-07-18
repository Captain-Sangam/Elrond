# Thin wrappers over the npm scripts in package.json — that file stays the
# source of truth for how the app is built and run.

.DEFAULT_GOAL := help
.PHONY: help install dev build start typecheck test export clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-10s %s\n", $$1, $$2}'

install: ## Install dependencies (rebuilds native modules for Electron)
	npm install

dev: ## Run the app in development mode with HMR
	npm run dev

build: ## Build production bundles into out/
	npm run build

start: build ## Build and launch the production bundle
	npm run preview

typecheck: ## Typecheck the main and renderer projects
	npm run typecheck

test: typecheck ## Typecheck + unit tests + build — the full local gate
	npm test
	$(MAKE) build

export: build ## Package Elrond.app and install it to Applications (Spotlight-searchable)
	npx electron-builder --dir
	@APP=$$(find dist -maxdepth 2 -name "Elrond.app" -print -quit); \
	if [ -z "$$APP" ]; then echo "Elrond.app not found under dist/"; exit 1; fi; \
	if [ -w /Applications ]; then DEST=/Applications; else DEST="$$HOME/Applications"; mkdir -p "$$DEST"; fi; \
	rm -rf "$$DEST/Elrond.app"; \
	ditto "$$APP" "$$DEST/Elrond.app"; \
	echo "Installed $$DEST/Elrond.app — launch it from Spotlight (⌘Space → Elrond)"

clean: ## Remove build output
	rm -rf out dist
