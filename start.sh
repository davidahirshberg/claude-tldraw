#!/bin/bash
# Start both servers for the PDF annotator

cd "$(dirname "$0")"

echo "Starting snapshot server on port 5174..."
node mcp-server/index.mjs &
SNAP_PID=$!

echo "Starting dev server on port 5173..."
npm run dev &
DEV_PID=$!

echo ""
echo "Services running:"
echo "  App: http://localhost:5173/"
echo "  App (network): http://10.0.0.18:5173/"
echo "  Snapshot API: http://localhost:5174/"
echo ""
echo "Press Ctrl+C to stop both servers"

trap "kill $SNAP_PID $DEV_PID 2>/dev/null" EXIT
wait
