EXT_NAME := timesheet-autofill
VERSION  := $(shell python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
DIST     := $(EXT_NAME)-v$(VERSION).zip

.PHONY: zip clean

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
	@echo "Done → $(DIST)"

clean:
	@rm -f *.zip
	@echo "Cleaned zip files."
