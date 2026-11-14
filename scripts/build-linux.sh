#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:-0.1.0}"
[[ "$version" =~ ^[0-9A-Za-z._-]+$ ]] || { echo 'Invalid version' >&2; exit 1; }
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'Build on x86_64 Linux' >&2; exit 1; }
python="${PYTHON:-python3}"
npm run build
"$python" -m PyInstaller --noconfirm --clean --distpath release/linux --workpath build/linux desktop/Folio-Linux.spec
cp desktop/START-HERE-LINUX.txt release/linux/Folio/START-HERE.txt
cp LICENSE release/linux/Folio/
"$python" scripts/third-party-licenses.py --output release/linux/Folio/THIRD-PARTY-LICENSES.txt
archive="Folio-$version-Linux-x64.tar.gz"
tar -C release/linux -czf "release/$archive" Folio
(cd release && sha256sum "$archive" > SHA256SUMS-Linux.txt)
echo "Built release/$archive"
