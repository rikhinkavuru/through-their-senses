#!/bin/bash
# Full reproduction queue (sequential; <= 6 worker processes, machine is shared).
set -e
V=/Users/rikhinkavuru/univabio/validation
H=/Users/rikhinkavuru/univabio/hearing
cd $H
uv run python ../validation/run_cpc2.py --level-offset-db -20 --workers 6                       # main: small.en, floor on, full set
cd $V && .venv/bin/python compute_haspi.py --workers 6                                          # HASPI v2 BE, full set
cd $H
uv run python ../validation/run_cpc2.py --level-offset-db -20 --model base.en --workers 6       # base.en, full set (deployable model)
uv run python ../validation/run_cpc2.py --level-offset-db -20 --subset 400 --no-floor --workers 6
uv run python ../validation/run_cpc2.py --level-offset-db 0 --subset 400 --workers 6            # level-convention sensitivity
uv run python ../validation/run_cpc2.py --level-offset-db -20 --subset 400 --model large-v3-turbo --workers 3 --threads 2
cd $V && .venv/bin/python analyze.py
