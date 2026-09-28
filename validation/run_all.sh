#!/bin/bash
# Full reproduction queue (sequential so jobs don't fight for cores).
set -e
V=/Users/rikhinkavuru/univabio/validation
H=/Users/rikhinkavuru/univabio/hearing
cd $H
uv run python ../validation/run_cpc2.py --level-offset-db -20 --workers 9                       # main, full set
cd $V && .venv/bin/python compute_haspi.py --workers 9                                          # HASPI v2 BE, full set
cd $H
uv run python ../validation/run_cpc2.py --level-offset-db -20 --subset 400 --no-floor --workers 9
uv run python ../validation/run_cpc2.py --level-offset-db -20 --subset 400 --model base.en --workers 9
uv run python ../validation/run_cpc2.py --level-offset-db 0 --subset 400 --workers 9           # level-convention sensitivity
uv run python ../validation/run_cpc2.py --level-offset-db -20 --subset 400 --model large-v3-turbo --workers 5 --threads 2
cd $V && .venv/bin/python analyze.py
