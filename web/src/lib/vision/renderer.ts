/**
 * Field renderer: shows a camera frame (or image) through someone's visual field.
 *
 * Method: Peli's band-limited contrast model (Peli 1990, JOSA A 7:2032).
 *  1. Build a Gaussian pyramid of the frame in linear light.
 *  2. Each Laplacian band is divided by the local mean one octave below to give
 *     local band contrast.
 *  3. Contrast below that person's threshold at that point in the field is removed.
 *     Threshold = normal threshold for the band's spatial frequency (Mannos-Sakrison
 *     CSF) x 10^(-TD/10), from the fitted total deviation at that visual angle.
 *  4. Reconstruct. Where loss is deep, every band is removed and only the coarse
 *     low-pass remains: objects vanish while surrounding colour continues, which is
 *     how patients describe it (Crabb et al. 2013), never a black patch.
 */

import { MAP_EXTENT } from "../field";
import { NIGHT, normalThreshold, thresholdMultiplier } from "./csf";

export interface RenderParams {
  /** Horizontal field of view of the source image, degrees. */
  hfovDeg: number;
  /** Fixation point in normalized canvas coordinates (0-1, origin top-left). */
  gaze: [number, number];
  /** Wipe position (0-1). Left of it shows the typical view, right shows theirs. Use 0 for all theirs. */
  wipe: number;
  night: boolean;
  /** Mirror horizontally (front camera). */
  mirror: boolean;
}

const MAX_WORK_DIM = 960;
const MIN_LEVEL_DIM = 8;

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS_COPY = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec4 uCrop; // xy scale, zw offset in source uv
uniform float uMirror;
uniform float uDim;
out vec4 o;
void main() {
  vec2 uv = vUv;
  if (uMirror > 0.5) uv.x = 1.0 - uv.x;
  vec3 c = texture(uSrc, uCrop.xy * uv + uCrop.zw).rgb;
  o = vec4(pow(c, vec3(2.2)) * uDim, 1.0);
}`;

// 3x3 binomial blur sampled from the finer level, then decimated by 2.
const FS_DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uSrcTexel;
out vec4 o;
void main() {
  vec2 t = uSrcTexel;
  vec3 c = texture(uSrc, vUv).rgb * 4.0;
  c += (texture(uSrc, vUv + vec2(t.x, 0.0)).rgb + texture(uSrc, vUv - vec2(t.x, 0.0)).rgb
      + texture(uSrc, vUv + vec2(0.0, t.y)).rgb + texture(uSrc, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  c += texture(uSrc, vUv + t).rgb + texture(uSrc, vUv - t).rgb
     + texture(uSrc, vUv + vec2(t.x, -t.y)).rgb + texture(uSrc, vUv + vec2(-t.x, t.y)).rgb;
  o = vec4(c / 16.0, 1.0);
}`;

const FS_RECON = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uGk;
uniform sampler2D uGk1;
uniform sampler2D uPrev;
uniform sampler2D uField;
uniform float uThreshold;   // normal contrast threshold for this band
uniform float uNightFactor; // extra threshold factor in dim light (1 in daylight)
uniform float uVeil;        // glare veil luminance added to the local mean
uniform vec2 uGaze;         // fixation, normalized (origin bottom-left, GL convention)
uniform vec2 uFocal;        // focal length in normalized units (x, y)
uniform float uExtent;      // field map half-extent, degrees
out vec4 o;
const vec3 W = vec3(0.2126, 0.7152, 0.0722);
void main() {
  vec3 gk = texture(uGk, vUv).rgb;
  vec3 up = texture(uGk1, vUv).rgb;
  vec3 prev = texture(uPrev, vUv).rgb;
  vec3 band = gk - up;
  float mean = max(dot(up, W) + uVeil, 1e-3);
  float c = abs(dot(band, W)) / mean;

  vec2 d = (vUv - uGaze) / uFocal;
  vec2 deg = degrees(atan(d));
  vec2 fuv = vec2((deg.x + uExtent) / (2.0 * uExtent), (deg.y + uExtent) / (2.0 * uExtent));
  vec2 f = texture(uField, fuv).rg;
  float td = (fuv.x < 0.0 || fuv.x > 1.0 || fuv.y < 0.0 || fuv.y > 1.0) ? 0.0 : f.r;
  float m = pow(10.0, -min(td, 0.0) / 10.0) * uNightFactor;
  float t = uThreshold * m;
  float g = smoothstep(0.7 * t, 1.3 * t, c);
  g = mix(1.0, g, step(1.05, m));
  o = vec4(prev + g * band, 1.0);
}`;

const FS_FINAL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTheirs;
uniform sampler2D uTypical;
uniform float uWipe;
uniform float uVeil;
out vec4 o;
void main() {
  bool typical = vUv.x < uWipe;
  vec3 lin = typical ? texture(uTypical, vUv).rgb : texture(uTheirs, vUv).rgb + vec3(uVeil);
  o = vec4(pow(max(lin, 0.0), vec3(1.0 / 2.2)), 1.0);
}`;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

export class FieldRenderer {
  private gl: WebGL2RenderingContext;
  private progs: Record<"copy" | "down" | "recon" | "final", Prog>;
  private vao: WebGLVertexArrayObject;
  private src: WebGLTexture;
  private field: WebGLTexture;
  private gauss: Target[] = [];
  private recon: Target[] = [];
  private workW = 0;
  private workH = 0;
  private float: boolean;
  private hasField = false;
  private frames = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;
    this.float = !!gl.getExtension("EXT_color_buffer_float");
    this.progs = {
      copy: this.program(FS_COPY, ["uSrc", "uCrop", "uMirror", "uDim"]),
      down: this.program(FS_DOWN, ["uSrc", "uSrcTexel"]),
      recon: this.program(FS_RECON, ["uGk", "uGk1", "uPrev", "uField", "uThreshold", "uNightFactor", "uVeil", "uGaze", "uFocal", "uExtent"]),
      final: this.program(FS_FINAL, ["uTheirs", "uTypical", "uWipe", "uVeil"]),
    };
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
    this.src = this.texture();
    this.field = this.texture();
  }

  private program(fs: string, uniforms: string[]): Prog {
    const gl = this.gl;
    const sh = (type: number, code: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "aPos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link error");
    const u: Prog["u"] = {};
    for (const name of uniforms) u[name] = gl.getUniformLocation(p, name);
    return { p, u };
  }

  private texture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.texture();
    if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  private ensureTargets(w: number, h: number) {
    if (w === this.workW && h === this.workH) return;
    const gl = this.gl;
    for (const t of [...this.gauss, ...this.recon]) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    this.gauss = [];
    this.recon = [];
    let lw = w;
    let lh = h;
    while (Math.min(lw, lh) >= MIN_LEVEL_DIM) {
      this.gauss.push(this.target(lw, lh));
      this.recon.push(this.target(lw, lh));
      lw = Math.max(1, Math.floor(lw / 2));
      lh = Math.max(1, Math.floor(lh / 2));
    }
    this.workW = w;
    this.workH = h;
  }

  /** Upload a total-deviation map (row 0 = top of the field) from interpolateField(). */
  setField(map: Float32Array, size: number) {
    const gl = this.gl;
    const data = new Float32Array(size * size * 2);
    // GL textures start at the bottom row, so flip vertically.
    for (let j = 0; j < size; j++) {
      const srcRow = size - 1 - j;
      for (let i = 0; i < size; i++) {
        const v = map[srcRow * size + i];
        const tested = Number.isFinite(v);
        data[(j * size + i) * 2] = tested ? v : 0;
        data[(j * size + i) * 2 + 1] = tested ? 1 : 0;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.field);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, size, size, 0, gl.RG, gl.FLOAT, data);
    this.hasField = true;
  }

  private pass(prog: Prog, target: Target | null) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private bind(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  render(source: TexImageSource, srcW: number, srcH: number, params: RenderParams) {
    const gl = this.gl;
    if (!this.hasField || !srcW || !srcH) return;
    gl.bindVertexArray(this.vao);

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const scale = Math.min(1, MAX_WORK_DIM / Math.max(cw, ch));
    const w = Math.max(16, Math.round(cw * scale));
    const h = Math.max(16, Math.round(ch * scale));
    this.ensureTargets(w, h);

    // Cover-crop the source to the canvas aspect ratio.
    const srcAspect = srcW / srcH;
    const dstAspect = cw / ch;
    let sx = 1;
    let sy = 1;
    if (srcAspect > dstAspect) sx = dstAspect / srcAspect;
    else sy = srcAspect / dstAspect;
    // Field of view of what is actually shown, after cropping.
    const shownHfov = 2 * Math.atan(Math.tan((params.hfovDeg * Math.PI) / 360) * sx);

    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    const dim = params.night ? NIGHT.sceneLuminance : 1;
    const copy = this.progs.copy;
    this.pass(copy, this.gauss[0]);
    this.bind(0, this.src, copy.u.uSrc);
    gl.uniform4f(copy.u.uCrop, sx, sy, (1 - sx) / 2, (1 - sy) / 2);
    gl.uniform1f(copy.u.uMirror, params.mirror ? 1 : 0);
    gl.uniform1f(copy.u.uDim, dim);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const down = this.progs.down;
    for (let k = 1; k < this.gauss.length; k++) {
      this.pass(down, this.gauss[k]);
      this.bind(0, this.gauss[k - 1].tex, down.u.uSrc);
      gl.uniform2f(down.u.uSrcTexel, 1 / this.gauss[k - 1].w, 1 / this.gauss[k - 1].h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Pixels per degree at the centre of level 0, in real-world degrees.
    const focalPx = w / 2 / Math.tan(shownHfov / 2);
    const ppd = focalPx * Math.tan(Math.PI / 180);
    const focal: [number, number] = [focalPx / w, focalPx / h];
    const gaze: [number, number] = [params.gaze[0], 1 - params.gaze[1]];
    const nightFactor = params.night ? NIGHT.typicalFactor * NIGHT.glaucomaExtraFactor : 1;
    const veil = 0;

    const n = this.gauss.length;
    const recon = this.progs.recon;
    // Top of the pyramid: the coarsest low-pass passes through unchanged.
    let prev = this.gauss[n - 1].tex;
    for (let k = n - 2; k >= 0; k--) {
      const bandCpd = (0.35 * ppd) / Math.pow(2, k);
      this.pass(recon, this.recon[k]);
      this.bind(0, this.gauss[k].tex, recon.u.uGk);
      this.bind(1, this.gauss[k + 1].tex, recon.u.uGk1);
      this.bind(2, prev, recon.u.uPrev);
      this.bind(3, this.field, recon.u.uField);
      gl.uniform1f(recon.u.uThreshold, normalThreshold(bandCpd));
      gl.uniform1f(recon.u.uNightFactor, nightFactor);
      gl.uniform1f(recon.u.uVeil, veil);
      gl.uniform2f(recon.u.uGaze, gaze[0], gaze[1]);
      gl.uniform2f(recon.u.uFocal, focal[0], focal[1]);
      gl.uniform1f(recon.u.uExtent, MAP_EXTENT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      prev = this.recon[k].tex;
    }

    const fin = this.progs.final;
    this.pass(fin, null);
    this.bind(0, this.recon[0].tex, fin.u.uTheirs);
    this.bind(1, this.gauss[0].tex, fin.u.uTypical);
    gl.uniform1f(fin.u.uWipe, params.wipe);
    gl.uniform1f(fin.u.uVeil, veil);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.frames++ < 3) {
      const err = gl.getError();
      if (err !== gl.NO_ERROR) console.warn(`FieldRenderer: GL error 0x${err.toString(16)} (float targets: ${this.float})`);
    }
  }

  /** Threshold multiplier at the given visual angle, for UI readouts. */
  static multiplier(td: number, night: boolean) {
    return thresholdMultiplier(td) * (night ? NIGHT.typicalFactor * NIGHT.glaucomaExtraFactor : 1);
  }

  dispose() {
    const gl = this.gl;
    for (const t of [...this.gauss, ...this.recon]) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    gl.deleteTexture(this.src);
    gl.deleteTexture(this.field);
    // Do not call loseContext(): the canvas keeps the same context object, and a
    // remount (React Strict Mode, fast refresh) would receive a dead context.
  }
}
