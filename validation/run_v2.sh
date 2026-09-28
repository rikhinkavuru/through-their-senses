#!/bin/bash
# Rerun the production-relevant configs after the internal noise-floor fix (FIR -> exact
# frequency-domain shaping). MSBG outputs are cached, so only transcription reruns.
set -e
H=/Users/rikhinkavuru/univabio/hearing
cd $H
uv run python ../validation/run_cpc2.py --level-offset-db -20 --model base.en --workers 6 --suffix __floorv2
uv run python ../validation/run_cpc2.py --level-offset-db -20 --model small.en --workers 6 --suffix __floorv2
