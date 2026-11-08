#!/bin/sh
# Flutter assets must live inside the package, so the shared wordlist is copied here.
# The generator test fails if this copy ever drifts from the shared source.
set -eu
cd "$(dirname "$0")/.."
cp ../shared/wordlists/eff_large_wordlist.txt assets/eff_large_wordlist.txt
