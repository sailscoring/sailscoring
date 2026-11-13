#!/usr/bin/env bash
# Build the listening engine for the browser: sherpa-onnx's streaming
# recogniser as WebAssembly, into engine/. Takes about ten minutes and needs
# git, cmake, python3 and about 3 GB of disk. Nothing here is committed.
#
# Two changes from the project's own browser build: the model is not packed
# into the engine (the page fetches whichever model it is asked for and
# writes it into the engine's file system), and the engine starts with 128 MB
# of memory rather than 512 MB, growing as it needs, so a phone will load it.
set -euo pipefail
cd "$(dirname "$0")"
SHERPA_TAG=v2.0.1
EMSDK_VERSION=4.0.23
# The build tree is large and full of other projects' source: keep it out of
# the repo, where the app's own tools would trip over it.
work="${VOICE_ENGINE_WORK:-${TMPDIR:-/tmp}/voice-engine-build}"
mkdir -p "$work" engine

[[ -d $work/emsdk ]] || git clone -q --depth 1 https://github.com/emscripten-core/emsdk.git "$work/emsdk"
"$work/emsdk/emsdk" install "$EMSDK_VERSION" > /dev/null
"$work/emsdk/emsdk" activate "$EMSDK_VERSION" > /dev/null
# shellcheck disable=SC1091
source "$work/emsdk/emsdk_env.sh" > /dev/null 2>&1

[[ -d $work/sherpa-onnx ]] || git clone -q --depth 1 --branch "$SHERPA_TAG" https://github.com/k2-fsa/sherpa-onnx.git "$work/sherpa-onnx"
cd "$work/sherpa-onnx"
git checkout -q -- wasm/asr/CMakeLists.txt build-wasm-simd-asr.sh
python3 - <<'PY'
p = 'wasm/asr/CMakeLists.txt'
s = open(p).read()
start = s.index('if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/assets/encoder.onnx")')
s = s[:start] + s[s.index('endif()', start) + len('endif()'):]
s = s.replace('INITIAL_MEMORY=512MB', 'INITIAL_MEMORY=128MB')
s = s.replace('string(APPEND MY_FLAGS "--preload-file ${CMAKE_CURRENT_SOURCE_DIR}/assets@. ")\n', '')
s = s.replace("'HEAPF32','HEAPF64']", "'HEAPF32','HEAPF64','FS']")
s = '\n'.join(line for line in s.split('\n') if 'sherpa-onnx-wasm-main-asr.data' not in line)
open(p, 'w').write(s)
p = 'build-wasm-simd-asr.sh'
s = open(p).read().replace('make -j2', 'make -j6')
open(p, 'w').write(s)
PY
./build-wasm-simd-asr.sh
cd - > /dev/null
out="$work/sherpa-onnx/build-wasm-simd-asr/install/bin/wasm/asr"
cp "$out/sherpa-onnx-wasm-main-asr.js" "$out/sherpa-onnx-wasm-main-asr.wasm" "$out/sherpa-onnx-asr.js" engine/
ls -lh engine/*.js engine/*.wasm
