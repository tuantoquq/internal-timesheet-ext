EXT_NAME := timesheet-autofill
VERSION  := $(shell python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
DIST     := $(EXT_NAME)-v$(VERSION).zip
DATE     := $(shell date +%Y-%m-%d)
MSG      ?=

.DEFAULT_GOAL := help

.PHONY: help test zip package clean changelog commit release

help:
	@echo "Timesheet AutoFill Makefile"
	@echo ""
	@echo "Usage:"
	@echo "  make help                         Show this help"
	@echo "  make test                         Run unit tests"
	@echo "  make zip                          Build extension zip package"
	@echo "  make clean                        Remove generated zip packages"
	@echo "  make changelog MSG=\"text\"          Add release note for current manifest version"
	@echo "  make commit MSG=\"text\"             Commit current changes"
	@echo "  make release MSG=\"text\"            Test, update changelog, package, and commit"
	@echo ""
	@echo "Current version: $(VERSION)"

test:
	@node --test tests/*.js

zip:
	@echo "Packing $(DIST)..."
	@zip -r $(DIST) . \
		-x ".agents/*" \
		-x ".codex/*" \
		-x "data/*" \
		-x ".git/*" \
		-x "tests/*" \
		-x "Makefile" \
		-x "*.py" \
		-x "*.test.js"
	@echo "Done -> $(DIST)"

package: zip

clean:
	@rm -f *.zip
	@echo "Cleaned zip files."

changelog:
	@if [ -z "$(MSG)" ]; then \
		echo "Usage: make changelog MSG=\"Describe the change\""; \
		exit 1; \
	fi
	@tmp=$$(mktemp); \
	if [ -f CHANGELOG.md ]; then \
		sed '1{/^# Changelog$$/d;}' CHANGELOG.md > $$tmp.old; \
	else \
		: > $$tmp.old; \
	fi; \
	{ \
		echo "# Changelog"; \
		echo ""; \
		echo "## [$(VERSION)] - $(DATE)"; \
		echo ""; \
		echo "- $(MSG)"; \
		echo ""; \
		cat $$tmp.old; \
	} > $$tmp; \
	mv $$tmp CHANGELOG.md; \
	rm -f $$tmp.old; \
	echo "Updated CHANGELOG.md for v$(VERSION)."

commit:
	@if [ -z "$(MSG)" ]; then \
		echo "Usage: make commit MSG=\"Commit message\""; \
		exit 1; \
	fi
	@git add -A
	@git commit -m "$(MSG)"

release:
	@$(MAKE) test
	@$(MAKE) changelog MSG="$(MSG)"
	@$(MAKE) zip
	@$(MAKE) commit MSG="$(MSG)"
