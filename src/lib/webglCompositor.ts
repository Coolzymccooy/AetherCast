// ---------------------------------------------------------------------------
// WebGL2 Compositing Engine for Aether Studio
// GPU-accelerated scene composition with chroma key, filters, rounded corners,
// transitions, and multi-layout support.
// ---------------------------------------------------------------------------

// ---- Public Types ---------------------------------------------------------

export type ChromaKeyConfig = {
  keyColor: [number, number, number]; // RGB 0-1
  similarity: number; // 0-1
  smoothness: number; // 0-1
};

export type BackgroundConfig = {
  color?: string;
  gradientStops?: Array<{ offset: number; color: string }>;
  textureId?: string;
};

export type RenderRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius?: number;
  opacity?: number;
};

export type RenderLayout = {
  sources: Array<{
    textureId: string;
    rect: RenderRect;
    label?: string;
    zIndex?: number;
  }>;
};

// ---- Internal Types -------------------------------------------------------

type FilterKind = 'None' | 'B&W' | 'Sepia' | 'Vivid' | 'Cool' | 'Dim';

interface TextureEntry {
  texture: WebGLTexture;
  width: number;
  height: number;
  chromaEnabled: boolean;
  chromaConfig: ChromaKeyConfig;
  filter: FilterKind;
}

interface TransitionState {
  type: 'Cut' | 'Fade' | 'Wipe';
  startTime: number;
  durationMs: number;
  previousFBO: WebGLFramebuffer;
  previousTexture: WebGLTexture;
  active: boolean;
}

// ---- Helpers --------------------------------------------------------------

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

/**
 * Parse a CSS hex color (#rgb, #rrggbb, #rrggbbaa) to a normalized float
 * array. Returns [r, g, b, a] with values in 0-1.
 */
function parseHexColor(hex: string): [number, number, number, number] {
  let r = 0, g = 0, b = 0, a = 1;
  const h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) {
    r = parseInt(h[0] + h[0], 16) / 255;
    g = parseInt(h[1] + h[1], 16) / 255;
    b = parseInt(h[2] + h[2], 16) / 255;
    if (h.length === 4) a = parseInt(h[3] + h[3], 16) / 255;
  } else if (h.length === 6 || h.length === 8) {
    r = parseInt(h.substring(0, 2), 16) / 255;
    g = parseInt(h.substring(2, 4), 16) / 255;
    b = parseInt(h.substring(4, 6), 16) / 255;
    if (h.length === 8) a = parseInt(h.substring(6, 8), 16) / 255;
  }
  return [r, g, b, a];
}

// ---- Shaders --------------------------------------------------------------

const VERTEX_SHADER_SRC = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position; // clip-space quad (-1..1)
layout(location = 1) in vec2 a_texCoord;

uniform vec4 u_destRect; // x, y, w, h in pixels (canvas coords)
uniform vec2 u_resolution; // canvas size

out vec2 v_texCoord;

void main() {
  // Map pixel rect to NDC (-1..1). Canvas origin = top-left, NDC origin =
  // bottom-left, so we flip Y.
  vec2 pos = a_position * 0.5 + 0.5; // 0..1
  vec2 pixel = u_destRect.xy + pos * u_destRect.zw;
  vec2 ndc = (pixel / u_resolution) * 2.0 - 1.0;
  ndc.y = -ndc.y; // flip Y
  gl_Position = vec4(ndc, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

const FRAGMENT_SHADER_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_opacity;

// Rounded corners (SDF)
uniform float u_cornerRadius; // in pixels
uniform vec2 u_rectSize;      // quad size in pixels

// Chroma key
uniform bool u_chromaEnabled;
uniform vec3 u_chromaKeyColor;
uniform float u_chromaSimilarity;
uniform float u_chromaSmoothness;

// Filter selector: 0=None, 1=B&W, 2=Sepia, 3=Vivid, 4=Cool, 5=Dim
uniform int u_filter;

// Transition uniforms (used when rendering full-screen transition pass)
uniform bool u_transitionActive;
uniform int u_transitionType; // 0=cut, 1=fade, 2=wipe
uniform float u_transitionProgress; // 0..1
uniform sampler2D u_prevTexture;

// ---- SDF rounded rect ----
float roundedBoxSDF(vec2 p, vec2 halfSize, float radius) {
  vec2 d = abs(p) - halfSize + radius;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

// ---- Chroma key ----
vec4 applyChromaKey(vec4 color, vec3 keyColor, float similarity, float smoothness) {
  float dist = distance(color.rgb, keyColor);
  float edge = smoothstep(similarity, similarity + smoothness, dist);
  return vec4(color.rgb, color.a * edge);
}

// ---- Filters ----
vec3 applyFilter(vec3 color, int filter) {
  if (filter == 1) {
    // B&W (grayscale via luminance)
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return vec3(lum);
  } else if (filter == 2) {
    // Sepia
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return vec3(lum * 1.2, lum * 1.0, lum * 0.8);
  } else if (filter == 3) {
    // Vivid (saturate + contrast)
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    vec3 saturated = mix(vec3(lum), color, 1.6); // boost saturation
    return mix(vec3(0.5), saturated, 1.3);        // boost contrast
  } else if (filter == 4) {
    // Cool (simple hue shift towards blue)
    return vec3(color.r * 0.85, color.g * 0.95, min(color.b * 1.2, 1.0));
  } else if (filter == 5) {
    // Dim (lower brightness)
    return color * 0.55;
  }
  return color;
}

void main() {
  // --- Transition full-screen pass ---
  if (u_transitionActive) {
    vec4 current = texture(u_texture, v_texCoord);
    vec4 prev = texture(u_prevTexture, v_texCoord);
    if (u_transitionType == 1) {
      // Fade
      fragColor = mix(prev, current, u_transitionProgress);
    } else if (u_transitionType == 2) {
      // Wipe (left-to-right)
      fragColor = v_texCoord.x < u_transitionProgress ? current : prev;
    } else {
      // Cut
      fragColor = current;
    }
    return;
  }

  vec4 color = texture(u_texture, v_texCoord);

  // Chroma key
  if (u_chromaEnabled) {
    color = applyChromaKey(color, u_chromaKeyColor, u_chromaSimilarity, u_chromaSmoothness);
  }

  // Filter
  color.rgb = applyFilter(color.rgb, u_filter);

  // Rounded corners via SDF
  if (u_cornerRadius > 0.0) {
    vec2 pixelPos = v_texCoord * u_rectSize;
    vec2 center = u_rectSize * 0.5;
    float dist = roundedBoxSDF(pixelPos - center, center, u_cornerRadius);
    // Anti-aliased edge (1px feather)
    float alpha = 1.0 - smoothstep(-1.0, 1.0, dist);
    color.a *= alpha;
  }

  color.a *= u_opacity;
  fragColor = color;
}
`;

// Background-specific shaders (gradient / solid pass)
const BG_FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform int u_bgType; // 0=solid, 1=gradient, 2=image
uniform vec4 u_bgColor;

// Gradient – up to 8 stops
uniform int u_gradientStopCount;
uniform float u_gradientOffsets[8];
uniform vec4 u_gradientColors[8];

uniform sampler2D u_texture;

// Unused uniforms are declared to share the same vertex shader / program setup
// but we keep a dedicated program for background for clarity.

vec4 sampleGradient(float t) {
  if (u_gradientStopCount == 0) return u_bgColor;
  if (t <= u_gradientOffsets[0]) return u_gradientColors[0];
  for (int i = 1; i < 8; i++) {
    if (i >= u_gradientStopCount) break;
    if (t <= u_gradientOffsets[i]) {
      float frac = (t - u_gradientOffsets[i - 1]) / (u_gradientOffsets[i] - u_gradientOffsets[i - 1]);
      return mix(u_gradientColors[i - 1], u_gradientColors[i], frac);
    }
  }
  return u_gradientColors[u_gradientStopCount - 1];
}

void main() {
  if (u_bgType == 0) {
    fragColor = u_bgColor;
  } else if (u_bgType == 1) {
    fragColor = sampleGradient(v_texCoord.y);
  } else {
    fragColor = texture(u_texture, v_texCoord);
  }
}
`;

// ---- Shader compilation helpers -------------------------------------------

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${info}`);
  }
  // Shaders are ref-counted; safe to flag for deletion after linking.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

// ---- Main class -----------------------------------------------------------

export class WebGLCompositor {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;

  // Programs
  private mainProgram: WebGLProgram;
  private bgProgram: WebGLProgram;

  // Geometry
  private quadVAO: WebGLVertexArrayObject;
  private quadVBO: WebGLBuffer;

  // Textures
  private textures: Map<string, TextureEntry> = new Map();

  // Background state
  private bgType: 'solid' | 'gradient' | 'image' = 'solid';
  private bgConfig: BackgroundConfig = { color: '#000000' };

  // Transition
  private transition: TransitionState = {
    type: 'Cut',
    startTime: 0,
    durationMs: 0,
    previousFBO: null!,
    previousTexture: null!,
    active: false,
  };

  // FBOs for transitions
  private fboA: WebGLFramebuffer;
  private fboTexA: WebGLTexture;
  private fboB: WebGLFramebuffer;
  private fboTexB: WebGLTexture;

  // Uniform caches
  private mainUniforms!: Record<string, WebGLUniformLocation | null>;
  private bgUniforms!: Record<string, WebGLUniformLocation | null>;

  private destroyed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    // Compile programs
    this.mainProgram = createProgram(gl, VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC);
    this.bgProgram = createProgram(gl, VERTEX_SHADER_SRC, BG_FRAGMENT_SRC);

    // Cache uniform locations
    this.cacheUniforms();

    // Create fullscreen quad geometry: 2 triangles, each vertex = (x, y, u, v)
    const quadData = new Float32Array([
      // pos        texcoord
      -1, -1,       0, 1,
       1, -1,       1, 1,
      -1,  1,       0, 0,
       1,  1,       1, 0,
    ]);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.quadVAO = vao;

    const vbo = gl.createBuffer();
    if (!vbo) throw new Error('Failed to create VBO');
    this.quadVBO = vbo;

    gl.bindVertexArray(this.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, quadData, gl.STATIC_DRAW);

    // location 0 = a_position (vec2)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    // location 1 = a_texCoord (vec2)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    gl.bindVertexArray(null);

    // Create FBOs for transitions
    [this.fboA, this.fboTexA] = this.createFBO();
    [this.fboB, this.fboTexB] = this.createFBO();

    // Default GL state
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.viewport(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  // ---- Uniform caching ----------------------------------------------------

  private cacheUniforms(): void {
    const gl = this.gl;

    const mainNames = [
      'u_texture', 'u_destRect', 'u_resolution', 'u_opacity',
      'u_cornerRadius', 'u_rectSize',
      'u_chromaEnabled', 'u_chromaKeyColor', 'u_chromaSimilarity', 'u_chromaSmoothness',
      'u_filter',
      'u_transitionActive', 'u_transitionType', 'u_transitionProgress', 'u_prevTexture',
    ];
    this.mainUniforms = {};
    for (const name of mainNames) {
      this.mainUniforms[name] = gl.getUniformLocation(this.mainProgram, name);
    }

    const bgNames = [
      'u_destRect', 'u_resolution', 'u_bgType', 'u_bgColor', 'u_texture',
      'u_gradientStopCount',
    ];
    this.bgUniforms = {};
    for (const name of bgNames) {
      this.bgUniforms[name] = gl.getUniformLocation(this.bgProgram, name);
    }
    // Array uniforms for gradient
    for (let i = 0; i < 8; i++) {
      this.bgUniforms[`u_gradientOffsets[${i}]`] = gl.getUniformLocation(this.bgProgram, `u_gradientOffsets[${i}]`);
      this.bgUniforms[`u_gradientColors[${i}]`] = gl.getUniformLocation(this.bgProgram, `u_gradientColors[${i}]`);
    }
  }

  // ---- FBO helpers --------------------------------------------------------

  private createFBO(): [WebGLFramebuffer, WebGLTexture] {
    const gl = this.gl;

    const tex = gl.createTexture();
    if (!tex) throw new Error('Failed to create FBO texture');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, CANVAS_WIDTH, CANVAS_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('Failed to create FBO');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return [fbo, tex];
  }

  // ---- Public API ---------------------------------------------------------

  /**
   * Upload or update a video/image source texture. Uses `texSubImage2D` when
   * the source dimensions have not changed for better performance.
   */
  updateTexture(id: string, source: HTMLVideoElement | HTMLImageElement): void {
    if (this.destroyed) return;
    const gl = this.gl;

    const srcWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const srcHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (srcWidth === 0 || srcHeight === 0) return; // source not ready

    const existing = this.textures.get(id);

    if (existing && existing.width === srcWidth && existing.height === srcHeight) {
      // Fast path — dimensions unchanged, use texSubImage2D.
      gl.bindTexture(gl.TEXTURE_2D, existing.texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return;
    }

    // Full upload (new texture or dimensions changed).
    const texture = existing?.texture ?? gl.createTexture();
    if (!texture) throw new Error(`Failed to create texture for "${id}"`);

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const entry: TextureEntry = existing ?? {
      texture,
      width: srcWidth,
      height: srcHeight,
      chromaEnabled: false,
      chromaConfig: { keyColor: [0, 1, 0], similarity: 0.4, smoothness: 0.08 },
      filter: 'None',
    };
    entry.texture = texture;
    entry.width = srcWidth;
    entry.height = srcHeight;
    this.textures.set(id, entry);
  }

  /** Remove a texture and free GPU memory. */
  removeTexture(id: string): void {
    if (this.destroyed) return;
    const entry = this.textures.get(id);
    if (entry) {
      this.gl.deleteTexture(entry.texture);
      this.textures.delete(id);
    }
  }

  /** Configure background rendering. */
  setBackground(type: 'solid' | 'gradient' | 'image', config: BackgroundConfig): void {
    this.bgType = type;
    this.bgConfig = config;
  }

  /** Enable or disable chroma key for a given source. */
  setChromaKey(id: string, enabled: boolean, config?: ChromaKeyConfig): void {
    const entry = this.textures.get(id);
    if (!entry) return;
    entry.chromaEnabled = enabled;
    if (config) entry.chromaConfig = config;
  }

  /** Set a color filter for a given source. */
  setFilter(id: string, filter: FilterKind): void {
    const entry = this.textures.get(id);
    if (!entry) return;
    entry.filter = filter;
  }

  /** Render a single composited frame with the given layout. */
  render(layout: RenderLayout): void {
    if (this.destroyed) return;
    const gl = this.gl;

    const renderToTarget = (fbo: WebGLFramebuffer | null) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // 1. Background
      this.renderBackground();

      // 2. Sources sorted by zIndex
      const sorted = [...layout.sources].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
      for (const src of sorted) {
        this.renderSource(src.textureId, src.rect);
      }
    };

    if (this.transition.active) {
      const elapsed = performance.now() - this.transition.startTime;
      const progress = Math.min(elapsed / this.transition.durationMs, 1.0);

      if (this.transition.type === 'Cut' || progress >= 1.0) {
        // Transition complete (or instant cut)
        this.transition.active = false;
        renderToTarget(null);
        return;
      }

      // Render current scene to FBO A
      renderToTarget(this.fboA);

      // Composite previous + current on screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.mainProgram);
      gl.bindVertexArray(this.quadVAO);

      // Bind current FBO texture to unit 0
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboTexA);
      gl.uniform1i(this.mainUniforms['u_texture'], 0);

      // Bind previous FBO texture to unit 1
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.transition.previousTexture);
      gl.uniform1i(this.mainUniforms['u_prevTexture'], 1);

      // Full-screen rect
      gl.uniform4f(this.mainUniforms['u_destRect'], 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      gl.uniform2f(this.mainUniforms['u_resolution'], CANVAS_WIDTH, CANVAS_HEIGHT);
      gl.uniform1f(this.mainUniforms['u_opacity'], 1.0);
      gl.uniform1f(this.mainUniforms['u_cornerRadius'], 0);
      gl.uniform2f(this.mainUniforms['u_rectSize'], CANVAS_WIDTH, CANVAS_HEIGHT);
      gl.uniform1i(this.mainUniforms['u_chromaEnabled'], 0);
      gl.uniform1i(this.mainUniforms['u_filter'], 0);

      gl.uniform1i(this.mainUniforms['u_transitionActive'], 1);
      gl.uniform1i(this.mainUniforms['u_transitionType'], this.transition.type === 'Fade' ? 1 : 2);
      gl.uniform1f(this.mainUniforms['u_transitionProgress'], progress);

      // We need to temporarily disable UNPACK_FLIP_Y since FBO textures are
      // already in the correct orientation.
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.bindVertexArray(null);
      return;
    }

    // No transition — render directly to canvas
    renderToTarget(null);
  }

  /**
   * Start a transition. The current canvas contents are captured as the
   * "previous" frame; subsequent render() calls will blend between the old
   * and new scenes.
   */
  startTransition(type: 'Cut' | 'Fade' | 'Wipe', durationMs: number): void {
    if (this.destroyed) return;
    const gl = this.gl;

    if (type === 'Cut' || durationMs <= 0) {
      this.transition.active = false;
      return;
    }

    // Copy current canvas to FBO B (previous frame)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fboB);
    gl.blitFramebuffer(
      0, 0, CANVAS_WIDTH, CANVAS_HEIGHT,
      0, 0, CANVAS_WIDTH, CANVAS_HEIGHT,
      gl.COLOR_BUFFER_BIT, gl.NEAREST,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    this.transition = {
      type,
      startTime: performance.now(),
      durationMs,
      previousFBO: this.fboB,
      previousTexture: this.fboTexB,
      active: true,
    };
  }

  /** Return the underlying canvas (useful for MediaStream capture). */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /** Release all GPU resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const gl = this.gl;

    this.textures.forEach((entry) => {
      gl.deleteTexture(entry.texture);
    });
    this.textures.clear();

    gl.deleteProgram(this.mainProgram);
    gl.deleteProgram(this.bgProgram);
    gl.deleteBuffer(this.quadVBO);
    gl.deleteVertexArray(this.quadVAO);

    gl.deleteFramebuffer(this.fboA);
    gl.deleteTexture(this.fboTexA);
    gl.deleteFramebuffer(this.fboB);
    gl.deleteTexture(this.fboTexB);

    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }

  // ---- Private rendering --------------------------------------------------

  private renderBackground(): void {
    const gl = this.gl;
    gl.useProgram(this.bgProgram);
    gl.bindVertexArray(this.quadVAO);

    gl.uniform4f(this.bgUniforms['u_destRect'], 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gl.uniform2f(this.bgUniforms['u_resolution'], CANVAS_WIDTH, CANVAS_HEIGHT);

    if (this.bgType === 'solid') {
      const [r, g, b, a] = parseHexColor(this.bgConfig.color ?? '#000000');
      gl.uniform1i(this.bgUniforms['u_bgType'], 0);
      gl.uniform4f(this.bgUniforms['u_bgColor'], r, g, b, a);
    } else if (this.bgType === 'gradient') {
      gl.uniform1i(this.bgUniforms['u_bgType'], 1);
      const stops = this.bgConfig.gradientStops ?? [];
      const count = Math.min(stops.length, 8);
      gl.uniform1i(this.bgUniforms['u_gradientStopCount'], count);
      for (let i = 0; i < count; i++) {
        const [r, g, b, a] = parseHexColor(stops[i].color);
        gl.uniform1f(this.bgUniforms[`u_gradientOffsets[${i}]`], stops[i].offset);
        gl.uniform4f(this.bgUniforms[`u_gradientColors[${i}]`], r, g, b, a);
      }
    } else if (this.bgType === 'image') {
      gl.uniform1i(this.bgUniforms['u_bgType'], 2);
      const entry = this.bgConfig.textureId ? this.textures.get(this.bgConfig.textureId) : undefined;
      if (entry) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        gl.uniform1i(this.bgUniforms['u_texture'], 0);
      }
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  private renderSource(textureId: string, rect: RenderRect): void {
    const gl = this.gl;
    const entry = this.textures.get(textureId);
    if (!entry) return;

    gl.useProgram(this.mainProgram);
    gl.bindVertexArray(this.quadVAO);

    // Texture on unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.uniform1i(this.mainUniforms['u_texture'], 0);

    // Destination rect
    gl.uniform4f(this.mainUniforms['u_destRect'], rect.x, rect.y, rect.width, rect.height);
    gl.uniform2f(this.mainUniforms['u_resolution'], CANVAS_WIDTH, CANVAS_HEIGHT);

    // Opacity
    gl.uniform1f(this.mainUniforms['u_opacity'], rect.opacity ?? 1.0);

    // Rounded corners
    gl.uniform1f(this.mainUniforms['u_cornerRadius'], rect.cornerRadius ?? 0);
    gl.uniform2f(this.mainUniforms['u_rectSize'], rect.width, rect.height);

    // Chroma key
    if (entry.chromaEnabled) {
      gl.uniform1i(this.mainUniforms['u_chromaEnabled'], 1);
      gl.uniform3f(
        this.mainUniforms['u_chromaKeyColor'],
        entry.chromaConfig.keyColor[0],
        entry.chromaConfig.keyColor[1],
        entry.chromaConfig.keyColor[2],
      );
      gl.uniform1f(this.mainUniforms['u_chromaSimilarity'], entry.chromaConfig.similarity);
      gl.uniform1f(this.mainUniforms['u_chromaSmoothness'], entry.chromaConfig.smoothness);
    } else {
      gl.uniform1i(this.mainUniforms['u_chromaEnabled'], 0);
    }

    // Filter
    const filterMap: Record<FilterKind, number> = {
      'None': 0, 'B&W': 1, 'Sepia': 2, 'Vivid': 3, 'Cool': 4, 'Dim': 5,
    };
    gl.uniform1i(this.mainUniforms['u_filter'], filterMap[entry.filter]);

    // Transition disabled for individual source draws
    gl.uniform1i(this.mainUniforms['u_transitionActive'], 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
