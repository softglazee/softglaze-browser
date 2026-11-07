#!/bin/bash
# Hostinger cron wrapper for scripts/run-cron.js. It finds the app folder it lives in, picks the
# newest Node the host provides (/opt/alt/alt-nodejs*), and appends one line per run to
# ~/logs/sg-licensing-cron.log (rotated at 1 MB). Overlapping runs are stopped by the database lock.
# The exact cron command is in docs/DEPLOY.md.
set -u
APP_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
NODE="$(ls -d /opt/alt/alt-nodejs*/root/usr/bin/node 2>/dev/null | sort -V | tail -1)"
[ -n "$NODE" ] || NODE="$(command -v node)"
LOG_DIR="$HOME/logs"
LOG="$LOG_DIR/sg-licensing-cron.log"
mkdir -p "$LOG_DIR"
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1048576 ]; then mv -f "$LOG" "$LOG.1"; fi
cd "$APP_DIR" && "$NODE" scripts/run-cron.js >> "$LOG" 2>&1
