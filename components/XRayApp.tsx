"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { PRESETS, type FabricPresetKey } from "@/lib/presets";
import { applyXRayEffect } from "@/lib/xray";

type LoadedImage = {
  bitmap: ImageBitmap; // fonte imutável em memória
  w: number;
  h: number;
  objectUrl: string; // apenas para preview no bloco de upload
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

// Mantém layout previsível escolhendo um aspect-ratio “seguro”
function snapAspectRatio(w: number, h: number) {
  const candidates: Array<[number, number]> = [
    [1, 1],
    [4, 3],
    [3, 4],
    [16, 9],
    [9, 16],
  ];
  const r = w / h;
  let best = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    const cr = c[0] / c[1];
    const dist = Math.abs(cr - r);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return { aw: best[0], ah: best[1] };
}

export default function XRayApp() {
  // Layout previsível: view fixa + controles separados
  const [presetKey, setPresetKey] = useState<FabricPresetKey>("cortina");
  const preset = PRESETS[presetKey];

  const [thickness, setThickness] = useState<number>(0.8);
  const [intensity, setIntensity] = useState<number>(0.85);
  const [enableNoise, setEnableNoise] = useState<boolean>(true);

  const [img, setImg] = useState<LoadedImage | null>(null);

  // Aspect-ratio definido ANTES de renderizar imagem/canvas; atualiza de forma controlada após load
  const [aspect, setAspect] = useState<{ aw: number; ah: number }>({ aw: 4, ah: 3 });

  // Canvas visível (saída) e offscreen (processamento)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Evita recriações de canvas por layout: o canvas vive fixo no mesmo container
  useEffect(() => {
    if (!workCanvasRef.current) {
      workCanvasRef.current = document.createElement("canvas");
    }
  }, []);

  // Ajusta thickness para ficar sempre dentro dos limites do preset
  useEffect(() => {
    setThickness((t) => clamp(t, preset.thicknessMin, preset.thicknessMax));
  }, [presetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewAspectStyle = useMemo(
    () => ({ aspectRatio: `${aspect.aw} / ${aspect.ah}` }),
    [aspect]
  );

  async function onPickFile(file: File) {
    // Regra: medir dimensões sem inserir <img hidden> no DOM
    const bitmap = await createImageBitmap(file);
    const objectUrl = URL.createObjectURL(file);

    // Aspect ratio previsível (snap) para não “quebrar layout”
    const snapped = snapAspectRatio(bitmap.width, bitmap.height);
    setAspect(snapped);

    // Fonte imutável em memória
    setImg({ bitmap, w: bitmap.width, h: bitmap.height, objectUrl });
  }

  function clearImage() {
    setImg((prev) => {
      if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
      prev?.bitmap.close?.();
      return null;
    });
    setAspect({ aw: 4, ah: 3 });
  }

  // Render pipeline correto (sempre parte do ORIGINAL imutável)
  useEffect(() => {
    if (!img) return;

    const canvas = canvasRef.current;
    const work = workCanvasRef.current;
    if (!canvas || !work) return;

    // Define uma resolução segura (não estoura, não trava)
    // Nada define tamanho da página: o canvas só se adapta ao container.
    const maxRenderSize = 1800;
    const scale = Math.min(maxRenderSize / Math.max(img.w, img.h), 1);
    const rw = Math.max(1, Math.floor(img.w * scale));
    const rh = Math.max(1, Math.floor(img.h * scale));

    // Mantém DPR sob controle para estabilidade
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Canvas de trabalho no tamanho de processamento
    work.width = rw;
    work.height = rh;

    // Canvas visível acompanha DPR, mas sem extrapolar
    canvas.width = Math.floor(rw * dpr);
    canvas.height = Math.floor(rh * dpr);

    const wctx = work.getContext("2d", { willReadFrequently: true });
    const vctx = canvas.getContext("2d");
    if (!wctx || !vctx) return;

    // 1) canvas limpo
    wctx.clearRect(0, 0, rw, rh);

    // 2) desenha imagem original (imutável) como base
    wctx.drawImage(img.bitmap, 0, 0, rw, rh);

    // 3) aplica efeito SEM reutilizar output como base
    const base = wctx.getImageData(0, 0, rw, rh);

    const processed = applyXRayEffect(base, {
      preset,
      thickness,
      intensity,
      enableNoise,
      maxRenderSize,
    });

    wctx.putImageData(processed, 0, 0);

    // 4) exibe no canvas visível (saída)
    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vctx.clearRect(0, 0, rw, rh);
    vctx.drawImage(work, 0, 0);

    // Regra: efeito é reaplicado sempre a partir da base original -> garantido neste effect
  }, [img, preset, thickness, intensity, enableNoise]);

  return (
    <div className="h-screen w-screen flex flex-col">
      {/* Header fixo, layout previsível */}
      <header className="shrink-0 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-zinc-300">X-Ray Realista em Tecidos</div>
            <div className="text-xs text-zinc-500">
              Client-only • pipeline imutável • canvas apenas como saída • safe para Vercel
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs hover:bg-zinc-800">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickFile(f);
                  e.currentTarget.value = "";
                }}
              />
              Upload
            </label>
            <button
              type="button"
              onClick={clearImage}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs hover:bg-zinc-800"
              disabled={!img}
            >
              Limpar
            </button>
          </div>
        </div>
      </header>

      {/* View area fixa (sem scroll global). Mobile empilha; desktop lado a lado */}
      <section className="flex-1 overflow-hidden p-4">
        <div className="grid h-full grid-cols-1 gap-4 md:grid-cols-2">
          {/* Bloco 1: Upload/Preview (nunca define layout, só conteúdo interno) */}
          <div className="flex h-full flex-col gap-2 overflow-hidden">
            <div className="text-xs text-zinc-400">Upload / Preview</div>

            <div
              className="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
              style={{ aspectRatio: `${aspect.aw} / ${aspect.ah}` }}
            >
              {!img ? (
                <div className="absolute inset-0 grid place-items-center p-6 text-center">
                  <div className="max-w-xs text-sm text-zinc-400">
                    Envie uma imagem. Este bloco tem tamanho previsível antes do render.
                  </div>
                </div>
              ) : (
                <img
                  src={img.objectUrl}
                  alt="Preview"
                  className="absolute inset-0 h-full w-full object-contain"
                  draggable={false}
                />
              )}
            </div>

            <div className="text-[11px] leading-snug text-zinc-500">
              Preview dentro de container dimensionado; sem &lt;img hidden&gt;; container nunca se adapta
              à imagem.
            </div>
          </div>

          {/* Bloco 2: Resultado X-ray (canvas como saída) */}
          <div className="flex h-full flex-col gap-2 overflow-hidden">
            <div className="text-xs text-zinc-400">Resultado (X-ray)</div>

            <div
              className="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
              style={viewAspectStyle}
            >
              <canvas className="absolute inset-0 h-full w-full" ref={canvasRef} />

              {!img && (
                <div className="absolute inset-0 grid place-items-center p-6 text-center">
                  <div className="max-w-xs text-sm text-zinc-400">
                    Aguardando upload para renderizar o resultado.
                  </div>
                </div>
              )}
            </div>

            <div className="text-[11px] leading-snug text-zinc-500">
              Canvas é saída; efeito reaplicado da base original; sem cascata; sem SSR visual.
            </div>
          </div>
        </div>
      </section>

      {/* Controles FORA da área de visualização */}
      <aside className="shrink-0 border-t border-zinc-800 bg-zinc-950 p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="block text-xs text-zinc-400">Preset de tecido</label>
            <select
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              value={presetKey}
              onChange={(e) => setPresetKey(e.target.value as FabricPresetKey)}
            >
              {Object.values(PRESETS).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <div className="mt-2 text-[11px] text-zinc-500">
              Cada preset impõe limites próprios (densidade, transmissão, maxReveal, clamps) para evitar
              “imagem estourada”.
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-400">
              Espessura (limitada pelo preset): {thickness.toFixed(2)}
            </label>
            <input
              className="mt-2 w-full"
              type="range"
              min={preset.thicknessMin}
              max={preset.thicknessMax}
              step={0.01}
              value={thickness}
              onChange={(e) => setThickness(parseFloat(e.target.value))}
              disabled={!img}
            />
            <div className="mt-1 text-[11px] text-zinc-500">
              Atenuação progressiva (não transparência direta).
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-400">
              Intensidade (limitada): {intensity.toFixed(2)}
            </label>
            <input
              className="mt-2 w-full"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={intensity}
              onChange={(e) => setIntensity(parseFloat(e.target.value))}
              disabled={!img}
            />
            <label className="mt-3 flex select-none items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={enableNoise}
                onChange={(e) => setEnableNoise(e.target.checked)}
                disabled={!img}
              />
              Ruído leve (sensor)
            </label>
          </div>
        </div>
      </aside>
    </div>
  );
}
