// Compiles the game's hand-written shaders in a real GL context.
//
// A GLSL typo in `Weather.ts` is invisible until the map that uses it loads —
// and on this machine that is a forty-second round trip through SwiftShader
// before the console tells you about a missing semicolon. This extracts the
// shader sources from the TypeScript, prepends the prefix three would inject
// for a `ShaderMaterial`, and compiles them against a bare WebGL2 context. No
// scene, no assets, no map.
//
//   node tools/check-shaders.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './cdp.mjs';

const SOURCES = ['src/game/render/Weather.ts'];

/** Pulls every `const NAME = /* glsl *\/ \`...\`` out of a file. */
function extractShaders(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /const\s+([A-Z_]+)\s*=\s*\/\*\s*glsl\s*\*\/\s*`([\s\S]*?)`;/g;
  let m;
  while ((m = re.exec(text))) out.push({ name: m[1], source: m[2], file });
  return out;
}

// What `WebGLProgram` puts in front of a ShaderMaterial's own source. Without
// it the compiler rejects `position`, `modelViewMatrix` and friends, which the
// real build injects.
const VERTEX_PREFIX = `
precision highp float;
precision highp int;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
`;

const FRAGMENT_PREFIX = `
precision highp float;
precision highp int;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
`;

const shaders = SOURCES.flatMap(extractShaders);
if (!shaders.length) {
  console.error('no shaders found');
  process.exit(1);
}

const payload = shaders.map((s) => ({
  name: s.name,
  file: s.file,
  vertex: /void\s+main/.test(s.source) && /gl_Position/.test(s.source),
  source: s.source,
}));

const cdp = await launch({ url: 'about:blank', port: 9501 });
const results = await cdp.evaluate(`(() => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return [{ name: 'context', ok: false, log: 'no WebGL context available' }];

  const shaders = ${JSON.stringify(payload)};
  const VERTEX_PREFIX = ${JSON.stringify(VERTEX_PREFIX)};
  const FRAGMENT_PREFIX = ${JSON.stringify(FRAGMENT_PREFIX)};

  const compile = (type, source) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
    const log = gl.getShaderInfoLog(sh) || '';
    gl.deleteShader(sh);
    return { ok, log };
  };

  const out = [];
  for (const s of shaders) {
    const type = s.vertex ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER;
    const prefix = s.vertex ? VERTEX_PREFIX : FRAGMENT_PREFIX;
    const r = compile(type, prefix + s.source);
    out.push({ name: s.name + (s.vertex ? ' (vertex)' : ' (fragment)'), ok: r.ok, log: r.log.trim() });
  }
  return out;
})()`);

await cdp.close();

let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  ok   ${r.name}`);
  } else {
    failed++;
    console.log(`  FAIL ${r.name}\n${r.log.split('\n').map((l) => '       ' + l).join('\n')}`);
  }
}
console.log(failed ? `\n${failed} shader(s) failed to compile` : `\nall ${results.length} shaders compile`);
process.exit(failed ? 1 : 0);
