#!/usr/bin/env bash
# Fetch the listening models the prototype offers into engine/models/, from
# the sherpa-onnx project's releases. About 180 MB in all.
#
#   ./fetch-models.sh            all three
#   ./fetch-models.sh 70M        one: 70M, 20M or kroko
set -euo pipefail
cd "$(dirname "$0")"
base=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models
want="${1:-all}"
mkdir -p engine/models
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# name in the release, where it goes, and the three files' names in it
fetch() {
  local archive=$1 id=$2 encoder=$3 decoder=$4 joiner=$5
  echo "Fetching $id…"
  curl -fsSL "$base/$archive.tar.bz2" | tar xj -C "$tmp"
  mkdir -p "engine/models/$id"
  cp "$tmp/$archive/$encoder" "engine/models/$id/encoder.onnx"
  cp "$tmp/$archive/$decoder" "engine/models/$id/decoder.onnx"
  cp "$tmp/$archive/$joiner" "engine/models/$id/joiner.onnx"
  cp "$tmp/$archive/tokens.txt" "engine/models/$id/tokens.txt"
  rm -rf "${tmp:?}/$archive"
}

if [[ $want == all || $want == 70M ]]; then
  s=-epoch-99-avg-1-chunk-16-left-128
  fetch sherpa-onnx-streaming-zipformer-en-2023-06-26 zipformer-en-70M "encoder$s.int8.onnx" "decoder$s.onnx" "joiner$s.int8.onnx"
fi
if [[ $want == all || $want == 20M ]]; then
  s=-epoch-99-avg-1
  fetch sherpa-onnx-streaming-zipformer-en-20M-2023-02-17 zipformer-en-20M "encoder$s.int8.onnx" "decoder$s.onnx" "joiner$s.int8.onnx"
fi
if [[ $want == all || $want == kroko ]]; then
  fetch sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06 kroko-en encoder.onnx decoder.onnx joiner.onnx
fi

# The page lists whichever of them are here.
{
  echo '['
  sep=''
  note() { printf '%s  { "id": "%s", "label": "%s", "base": "engine/models/%s", "note": "%s" }' "$sep" "$1" "$2" "$1" "$3"; sep=$',\n'; }
  [[ -d engine/models/zipformer-en-70M ]] && note zipformer-en-70M 'Zipformer English, larger (72 MB)' 'Apache 2.0, trained on LibriSpeech. The one we could ship as it stands.'
  [[ -d engine/models/zipformer-en-20M ]] && note zipformer-en-20M 'Zipformer English, small (44 MB)' 'Apache 2.0, trained on LibriSpeech. Smaller and faster, and it mishears more.'
  [[ -d engine/models/kroko-en ]] && note kroko-en 'Kroko English (68 MB), for comparison' 'The best of the three on the bench. Its licence is CC BY-SA, so it is here to compare against, not to ship.'
  printf '\n]\n'
} > engine/models/index.json
echo "Done: $(ls engine/models | grep -v index.json | tr '\n' ' ')"
