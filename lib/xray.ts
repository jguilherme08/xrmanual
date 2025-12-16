import type { FabricPreset } from "./presets";

export type XRayParams = {
  preset: FabricPreset;

  // Controles do usuário (sempre limitados pelo preset)
  thickness: number; // dentro do range do preset
  intensity: number; // 0..1 (escala adicional dentro do maxReveal)
  enableNoise: boolean;

  // Segurança de performance / estabilidade
  maxRenderSize: number; // ex: 1600..2200
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// Box blur separável (rápido e estável) – evita filtros extremos
function boxBlurRGBA(src: Uint8ClampedArray, w: number, h: number, radius: number) {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) return src.slice();

  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);

  // Horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0,
        gs = 0,
        bs = 0,
        as = 0,
        count = 0;
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
      let rs = 0,
        gs = 0,
        bs = 0,
        as = 0,
        count = 0;
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

/**
 * Efeito “X-ray” realista simplificado:
 * - Atenuação progressiva (transmissão ~ exp(-density*thickness))
 * - Realce sutil de volumes (alto-frequência controlado, sem “lavar”)
 * - Desaturação moderada + ruído leve (sensor)
 * - Clamps fortes por preset (anti-estouro)
 */
export function applyXRayEffect(imageData: ImageData, params: XRayParams): ImageData {
  const { preset, thickness, intensity, enableNoise } = params;
  const w = imageData.width;
  const h = imageData.height;

  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);

  // Transmissão física simplificada (quanto maior, mais “revela”)
  const t = Math.exp(
    -preset.density * clamp(thickness, preset.thicknessMin, preset.thicknessMax)
  );
  const reveal = clamp(t * preset.maxReveal * clamp(intensity, 0, 1), 0, preset.maxReveal);

  // Blur representa espalhamento/scattering do tecido (não é “contraste extremo”)
  const blurred = boxBlurRGBA(src, w, h, preset.blurRadius);

  // Ruído bem leve, proporcional à revelação (sensor)
  const noiseAmp = enableNoise ? preset.noise * reveal : 0;

  for (let i = 0; i < src.length; i += 4) {
    const r = src[i + 0];
    const g = src[i + 1];
    const b = src[i + 2];
    const a = src[i + 3];

    const br = blurred[i + 0];
    const bg = blurred[i + 1];
    const bb = blurred[i + 2];

    // High-pass: detalhe = original - borrado (sutil)
    const dr = (r - br) * preset.detailGain * reveal;
    const dg = (g - bg) * preset.detailGain * reveal;
    const db = (b - bb) * preset.detailGain * reveal;

    // Clamp de delta (segurança contra “lavar” / estourar)
    const maxD = preset.maxDelta * reveal;
    const cdr = clamp(dr, -maxD, maxD);
    const cdg = clamp(dg, -maxD, maxD);
    const cdb = clamp(db, -maxD, maxD);

    // Aplicação do detalhe sem alterar brilho global
    let rr = r + cdr;
    let gg = g + cdg;
    let bb2 = b + cdb;

    // Desaturação moderada para “leitura de volume”
    const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb2;
    const ds = preset.desat * reveal;
    rr = lerp(rr, lum, ds);
    gg = lerp(gg, lum, ds);
    bb2 = lerp(bb2, lum, ds);

    // Ruído leve
    if (noiseAmp > 0) {
      const n = (Math.random() - 0.5) * 255 * noiseAmp;
      rr += n;
      gg += n;
      bb2 += n;
    }

    out[i + 0] = clamp(rr, 0, 255) | 0;
    out[i + 1] = clamp(gg, 0, 255) | 0;
    out[i + 2] = clamp(bb2, 0, 255) | 0;
    out[i + 3] = a;
  }

  return new ImageData(out, w, h);
}
