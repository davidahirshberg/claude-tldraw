#!/bin/bash
# Build LaTeX to SVG pages for tldraw viewer
#
# Usage: ./build-svg.sh /path/to/document.tex [doc-name]
#
# - Runs latexmk -dvi for proper reference resolution
# - Converts DVI to SVG with dvisvgm
# - Outputs to public/docs/

set -e

TEX_FILE="$1"
DOC_NAME="${2:-bregman}"

if [ -z "$TEX_FILE" ]; then
  echo "Usage: $0 <tex-file> [doc-name]"
  exit 1
fi

if [ ! -f "$TEX_FILE" ]; then
  echo "Error: $TEX_FILE not found"
  exit 1
fi

TEX_DIR="$(dirname "$TEX_FILE")"
TEX_BASE="$(basename "$TEX_FILE" .tex)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/public/docs"

echo "Building $TEX_FILE → $OUTPUT_DIR"

# Build DVI with latexmk (handles biber, multiple passes, etc.)
echo "Running latexmk..."
cd "$TEX_DIR"
latexmk -dvi -interaction=nonstopmode "$TEX_BASE.tex"

DVI_FILE="$TEX_DIR/$TEX_BASE.dvi"
if [ ! -f "$DVI_FILE" ]; then
  echo "Error: DVI file not created"
  exit 1
fi

# Clear old SVGs
rm -f "$OUTPUT_DIR"/page-*.svg

# Convert to SVG
echo "Converting DVI to SVG..."
dvisvgm --page=1- --font-format=woff2 --exact-bbox \
  --output="$OUTPUT_DIR/page-%p.svg" \
  "$DVI_FILE"

# Count pages
PAGE_COUNT=$(ls -1 "$OUTPUT_DIR"/page-*.svg 2>/dev/null | wc -l | tr -d ' ')
echo "Generated $PAGE_COUNT pages"

# Output info for updating App.tsx if needed
echo ""
echo "Document ready. Update src/App.tsx if needed:"
echo "  '$DOC_NAME': { name: '...', pages: $PAGE_COUNT, basePath: '/docs/page-' }"
