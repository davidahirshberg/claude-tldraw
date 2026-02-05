#!/bin/bash
# Highlight a TeX line in TLDraw
# Usage: ./highlight-line.sh <line> [file.tex]

LINE=$1
FILE=${2:-/Users/skip/work/bregman-lower-bound/bregman-lower-bound.tex}

if [ -z "$LINE" ]; then
  echo "Usage: ./highlight-line.sh <line> [file.tex]"
  exit 1
fi

# Get TLDraw coords from reverse synctex
COORDS=$(node /Users/skip/work/claude-tldraw/synctex-reverse.mjs "$FILE" "$LINE" 2>/dev/null | grep "^JSON:" | sed 's/JSON: //')

if [ -z "$COORDS" ]; then
  echo "Could not find coords for $FILE:$LINE"
  exit 1
fi

# Send to TLDraw
curl -s -X POST http://localhost:5174/highlight \
  -H "Content-Type: application/json" \
  -d "$COORDS"

echo ""
echo "Highlighted $FILE:$LINE"
