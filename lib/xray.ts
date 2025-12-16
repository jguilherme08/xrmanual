import type { FabricPreset } from "./presets";

export type XRayParams = {
  preset: FabricPreset;

  // X-ray / transmissão
  thickness: number; // 0..1 (clamp no preset)
  intensity: number; // 0..1

  enableNoise: boolean;
  maxRenderSize: number;

  // Recuperação de sombras e tonalidade (0..1)
  shadows: number;     // levanta sombras sem lavar
  blacks: number;      // recupera profundidade após levantar sombras
  highlights: number;  // segura realces
  contrast: number;    // S-curve leve (global, moderado)

  // Textura / microcontraste (0..1)
  clarity: number;     // microcontraste local (cuidado com halo)
  dehaze: number;      // contraste local mais agressivo (limitado)

  // Ruído e nitidez (0..1)
  denoiseColor: number;
  denoiseLuma: number;
  sharpen: number;
  sharpenMasking: number; // 0 = tudo, 1 = só bordas

  // Máscaras locais (mesma resolução do ImageData)
  dodgeMask?: Uint8ClampedArray; // 0..255
  burnMask?: Uint8ClampedArray;  // 0..255
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// sRGB -> linear (aprox)
function srgbToLin(x: number) {
  const v = x / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function linToSrgb(x: number) {
  const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return clamp(Math.round(v * 255), 0, 255);
}

function luminanceLin(r: number, g: number, b: number) {
  // r,g,b em [0..1] linear
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function boxBlurRGBA(src: Uint8ClampedArray, w: number, h: number, radius: number) {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) return src.slice();

  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);

  // Horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0, gs = 0, bs = 0, as = 0, count = 0;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      for (let xi = x0; xi <= x1; xi++) {
        const i = (y * w + xi) * 4;
        rs += src[i + 0];
        gs += src[i + 1];
        bs += src[i + 2];
        as += src[i + 3];
        count++;
      }
      const o = (y * w + x) * 4;
      tmp[o + 0] = (rs / count) | 0;
      tmp[o + 1] = (gs / count) | 0;
      tmp[o + 2] = (bs / count) | 0;
      tmp[o + 3] = (as / count) | 0;
    }
  }

  // Vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0, gs = 0, bs = 0, as = 0, count = 0;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      for (let yi = y0; yi <= y1; yi++) {
        const i = (yi * w + x) * 4;
        rs += tmp[i + 0];
        gs += tmp[i + 1];
        bs += tmp[i + 2];
        as += tmp[i + 3];
        count++;
      }
      const o = (y * w + x) * 4;
      out[o + 0] = (rs / count) | 0;
      out[o + 1] = (gs / count) | 0;
      out[o + 2] = (bs / count) | 0;
      out[o + 3] = (as / count) | 0;
    }
  }

  return out;
}

// Curva “S” leve e lift de sombras (em luminância linear 0..1)
function toneMapY(
  y: number,
  shadows: number,
  blacks: number,
  highlights: number,
  contrast: number
) {
  // 1) Lift de sombras (atua mais em y baixo)
  // y += shadows * (1 - y) * exp(-k*y)
  const k = 6.0;
  y = y + shadows * (1 - y) * Math.exp(-k * y);

  // 2) Segurar highlights (compressão suave do topo)
  // y -= highlights * y^p (mais no topo)
  const p = 3.0;
  y = y - highlights * Math.pow(y, p) * 0.35;

  // 3) S-curve (contraste moderado, sem esmagar)
  // y' = y + c*(y-0.5)*(1 - |y-0.5|*2)
  const d = y - 0.5;
  y = y + contrast * d * (1 - Math.min(1, Math.abs(d) * 2)) * 0.6;

  // 4) Blacks: depois de levantar sombras, puxar pretos para baixo (profundidade)
  // atua mais em sombras médias/baixas
  y = y - blacks * (1 - y) * (1 - y) * 0.55;

  return clamp(y, 0, 1);
}

export function applyXRayEffect(imageData: ImageData, params: XRayParams): ImageData {
  const {
    preset,
    thickness,
    intensity,
    enableNoise,
    shadows,
    blacks,
    highlights,
    contrast,
    clarity,
    dehaze,
    denoiseColor,
    denoiseLuma,
    sharpen,
    sharpenMasking,
    dodgeMask,
    burnMask,
  } = params;

  const w = imageData.width;
  const h = imageData.height;

  const src = imageData.data;

  // 1) Blur do “tecido” (base para transmissão e microcontraste)
  const blurredTecido = boxBlurRGBA(src, w, h, preset.blurRadius);

  // 2) Blur leve para denoise (raio pequeno e barato)
  const blurredDenoise = boxBlurRGBA(src, w, h, 1);

  // 3) Transmissão física simplificada (quanto menor a espessura efetiva, mais revela)
  const t = Math.exp(-preset.density * clamp(thickness, preset.thicknessMin, preset.thicknessMax));
  const reveal = clamp(t * preset.maxReveal * clamp(intensity, 0, 1), 0, preset.maxReveal);

  // mistura controlada (anti “lavagem”)
  const mixTrans = clamp(reveal * 1.15, 0, 0.42);

  // microcontraste local (clarity/dehaze) baseado em high-pass suave
  const clarityAmt = clamp(clarity, 0, 1) * 0.35; // limite forte
  const dehazeAmt = clamp(dehaze, 0, 1) * 0.25;   // mais agressivo, mas limitado

  const noiseAmp = enableNoise ? preset.noise * reveal : 0;

  const out = new Uint8ClampedArray(src.length);

  for (let i = 0; i < src.length; i += 4) {
    const r0 = src[i + 0];
    const g0 = src[i + 1];
    const b0 = src[i + 2];
    const a0 = src[i + 3];

    // denoise (color primeiro, depois luma)
    let r = r0, g = g0, b = b0;

    if (denoiseColor > 0 || denoiseLuma > 0) {
      const rn = blurredDenoise[i + 0];
      const gn = blurredDenoise[i + 1];
      const bn = blurredDenoise[i + 2];

      // Color noise: aproxima RGB do blur (reduz “pontinhos coloridos”)
      const dc = clamp(denoiseColor, 0, 1) * 0.55;
      r = lerp(r, rn, dc);
      g = lerp(g, gn, dc);
      b = lerp(b, bn, dc);

      // Luma noise: aproxima luminância do blur, preservando cor
      const dl = clamp(denoiseLuma, 0, 1) * 0.55;
      if (dl > 0) {
        const rl = srgbToLin(r);
        const gl = srgbToLin(g);
        const bl = srgbToLin(b);

        const rnl = srgbToLin(rn);
        const gnl = srgbToLin(gn);
        const bnl = srgbToLin(bn);

        const y = luminanceLin(rl, gl, bl);
        const yn = luminanceLin(rnl, gnl, bnl);

        const y2 = lerp(y, yn, dl);

        // reescala RGB linear mantendo proporção (evita “lama” de cor)
        const scale = y > 1e-6 ? y2 / y : 1;
        const rr = clamp(rl * scale, 0, 1);
        const gg = clamp(gl * scale, 0, 1);
        const bb = clamp(bl * scale, 0, 1);

        r = linToSrgb(rr);
        g = linToSrgb(gg);
        b = linToSrgb(bb);
      }
    }

    // transmissão: mistura com blur do tecido (simula espalhamento)
    const br = blurredTecido[i + 0];
    const bg = blurredTecido[i + 1];
    const bb = blurredTecido[i + 2];

    let rr = lerp(r, br, mixTrans);
    let gg = lerp(g, bg, mixTrans);
    let bb2 = lerp(b, bb, mixTrans);

    // high-pass (detalhe) conservador e clampado
    const dr = (r - br) * preset.detailGain * reveal;
    const dg = (g - bg) * preset.detailGain * reveal;
    const db = (b - bb) * preset.detailGain * reveal;

    const maxD = preset.maxDelta * reveal;
    rr += clamp(dr, -maxD, maxD);
    gg += clamp(dg, -maxD, maxD);
    bb2 += clamp(db, -maxD, maxD);

    // microcontraste (clarity + dehaze) em cima do high-pass
    if (clarityAmt > 0 || dehazeAmt > 0) {
      const hpR = (r0 - br) / 255;
      const hpG = (g0 - bg) / 255;
      const hpB = (b0 - bb) / 255;

      rr += hpR * 255 * clarityAmt;
      gg += hpG * 255 * clarityAmt;
      bb2 += hpB * 255 * clarityAmt;

      // dehaze (mais forte, mas ainda limitado)
      rr += hpR * 255 * dehazeAmt * 1.15;
      gg += hpG * 255 * dehazeAmt * 1.15;
      bb2 += hpB * 255 * dehazeAmt * 1.15;
    }

    // trabalhar “luz” separado (luminosidade): curvas/shadows/blacks/highlights sem destruir cor
    {
      const rl = srgbToLin(rr);
      const gl = srgbToLin(gg);
      const bl = srgbToLin(bb2);

      let y = luminanceLin(rl, gl, bl);

      // máscara local: dodge/burn (0..1)
      const mDodge = dodgeMask ? dodgeMask[i >> 2] / 255 : 0;
      const mBurn = burnMask ? burnMask[i >> 2] / 255 : 0;

      // Ajustes globais
      let y2 = toneMapY(
        y,
        clamp(shadows, 0, 1),
        clamp(blacks, 0, 1),
        clamp(highlights, 0, 1),
        clamp(contrast, 0, 1)
      );

      // Ajustes locais (Dodge & Burn) — baixa opacidade, acumulativo pelo pincel
      if (mDodge > 0) {
        const localLift = 0.22 * mDodge; // “5–15%” na prática, limitado
        y2 = clamp(y2 + localLift * (1 - y2), 0, 1);
      }
      if (mBurn > 0) {
        const localBurn = 0.22 * mBurn;
        y2 = clamp(y2 - localBurn * (1 - y2), 0, 1);
      }

      // reescala RGB linear mantendo cor
      const scale = y > 1e-6 ? y2 / y : 1;
      rr = linToSrgb(clamp(rl * scale, 0, 1));
      gg = linToSrgb(clamp(gl * scale, 0, 1));
      bb2 = linToSrgb(clamp(bl * scale, 0, 1));
    }

    // desaturação moderada por preset (volume), proporcional ao reveal
    const lumS = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb2;
    const ds = preset.desat * reveal;
    rr = lerp(rr, lumS, ds);
    gg = lerp(gg, lumS, ds);
    bb2 = lerp(bb2, lumS, ds);

    // ruído leve (sensor), proporcional à revelação
    if (noiseAmp > 0) {
      const n = (Math.random() - 0.5) * 255 * noiseAmp;
      rr += n;
      gg += n;
      bb2 += n;
    }

    // nitidez controlada (unsharp leve + masking por borda)
    if (sharpen > 0) {
      // aproxima borda por diferença com blur
      const rn = blurredDenoise[i + 0];
      const gn = blurredDenoise[i + 1];
      const bn = blurredDenoise[i + 2];

      const edge = (Math.abs(rr - rn) + Math.abs(gg - gn) + Math.abs(bb2 - bn)) / (3 * 255); // 0..1
      const mask = clamp((edge - sharpenMasking * 0.35) / (1 - sharpenMasking * 0.35), 0, 1);

      const amount = clamp(sharpen, 0, 1) * 0.55 * mask; // limitado
      rr = rr + (rr - rn) * amount;
      gg = gg + (gg - gn) * amount;
      bb2 = bb2 + (bb2 - bn) * amount;
    }

    out[i + 0] = clamp(rr, 0, 255) | 0;
    out[i + 1] = clamp(gg, 0, 255) | 0;
    out[i + 2] = clamp(bb2, 0, 255) | 0;
    out[i + 3] = a0;
  }

  return new ImageData(out, w, h);
}

