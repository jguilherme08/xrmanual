export type FabricPresetKey = "estofado" | "cortina" | "seda" | "poliester";

export type FabricPreset = {
  key: FabricPresetKey;
  label: string;

  // “Física” simplificada (atenuação / transmissão)
  density: number; // maior = menos transmissão
  thicknessMin: number;
  thicknessMax: number;

  // Limites visuais (para não “estourar”)
  maxReveal: number; // 0..1 (limite superior de mistura)
  detailGain: number; // ganho do alto-frequência (sutil)
  blurRadius: number; // espalhamento/tecido (px)
  desat: number; // desaturação quando revela (0..1)
  noise: number; // ruído leve (0..0.06)
  maxDelta: number; // clamp do quanto pode variar por pixel (segurança anti-lavagem)
};

export const PRESETS: Record<FabricPresetKey, FabricPreset> = {
  estofado: {
    key: "estofado",
    label: "Estofado (alta densidade)",
    density: 2.4,
    thicknessMin: 0.2,
    thicknessMax: 1.6,
    maxReveal: 0.28,
    detailGain: 0.55,
    blurRadius: 4,
    desat: 0.45,
    noise: 0.018,
    maxDelta: 28,
  },
  cortina: {
    key: "cortina",
    label: "Cortina (média densidade)",
    density: 1.5,
    thicknessMin: 0.2,
    thicknessMax: 1.8,
    maxReveal: 0.42,
    detailGain: 0.65,
    blurRadius: 3,
    desat: 0.35,
    noise: 0.02,
    maxDelta: 34,
  },
  seda: {
    key: "seda",
    label: "Seda (baixa densidade)",
    density: 0.95,
    thicknessMin: 0.15,
    thicknessMax: 2.0,
    maxReveal: 0.55,
    detailGain: 0.7,
    blurRadius: 2,
    desat: 0.28,
    noise: 0.022,
    maxDelta: 40,
  },
  poliester: {
    key: "poliester",
    label: "Poliéster (média/alta densidade)",
    density: 1.85,
    thicknessMin: 0.2,
    thicknessMax: 1.9,
    maxReveal: 0.36,
    detailGain: 0.6,
    blurRadius: 3,
    desat: 0.38,
    noise: 0.02,
    maxDelta: 32,
  },
};
