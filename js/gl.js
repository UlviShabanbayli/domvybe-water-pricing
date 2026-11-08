// Tiny full-screen shader helper (grown from the round-6 _shared_a/gl.js and DV89's gl.js): WebGL2 only (the CSS
// fallback covers the rest), one triangle, scissored draws for partial redraws.

const VS = '#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

export function createGL(canvas) {
  const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' };
  const gl = canvas.getContext('webgl2', opts);
  if (!gl) return null;
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  return gl;
}

export function program(gl, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
    return s;
  };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(pr, 0, 'p');
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(pr) || 'link failed');
  const locs = {};
  const U = (n) => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(pr, n)));
  const api = {
    use() { gl.useProgram(pr); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); return api; },
    f(n, ...v) {
      const l = U(n); if (l === null) return api;
      if (v.length === 1) gl.uniform1f(l, v[0]); else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]); else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
      return api;
    },
    i(n, v) { const l = U(n); if (l !== null) gl.uniform1i(l, v); return api; },
    draw() { gl.drawArrays(gl.TRIANGLES, 0, 3); return api; },
  };
  return api;
}
