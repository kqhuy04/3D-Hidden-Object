// Boots three's bundled Draco decoder in Node.
//
// The emscripten wrapper is a script, not a module: it calls `require` and
// `__dirname` at top level and expects a CommonJS context. Loading it from an
// ES module throws ERR_AMBIGUOUS_MODULE_SYNTAX, so it lives here and the ESM
// side imports this file instead. `new Function` is deliberate — it keeps the
// wrapper's several hundred minified globals out of this module's scope.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco');
const wasmBinary = fs.readFileSync(path.join(dir, 'draco_decoder.wasm'));
const wrapper = fs.readFileSync(path.join(dir, 'draco_wasm_wrapper.js'), 'utf8');

const factory = new Function('require', '__dirname', `${wrapper}\nreturn DracoDecoderModule;`)(
  require,
  dir
);

module.exports = function loadDracoDecoder() {
  return factory({ wasmBinary });
};
