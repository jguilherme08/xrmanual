"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { PRESETS, type FabricPresetKey } from "@/lib/presets";
import { applyXRayEffect } from "@/lib/xray";

type LoadedImage = {
  bitmap?: ImageBitmap;
  imgEl?: HTMLImageElement;
  w: number;
  h: number;
  objectUrl: string;
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

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

async function loadImageFallback(file: File): Promise<{ imgEl: HTMLImageElement; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.src = url;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Falha ao carregar imagem no fallback <img>."));
  });

  return { imgEl: img, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
}

export default function XRayApp() {
  const [presetKey, setPresetKey] = useState<FabricPresetKey>("cortina");
  const preset = PRESETS[presetKey];

  // Defaults mais perceptíveis
  const [thickness, setThickness] = useState<number>(0.55);
  const [intensity, setIntensity] = useState<number>(1.0);
  const [enableNoise, setEnableNoise] = useState<boolean>(true);

  const [img, setImg] = useState<LoadedImage | null>(null);
  const [aspect, setAspect] = useState<{ aw: number; ah: number }>({ aw: 4, ah: 3 });

  // Mobile: Preview OU Resultado (não coexistem visualmente)
  const [mobileTab, setMobileTab] = useState<"preview" | "resultado">("preview");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!workCanvasRef.current) {
      workCanvasRef.current = document.createElement("canvas");
    }
  }, []);

  useEffect(() => {
    setThickness((t) => clamp(t, preset.thicknessMin, preset.thicknessMax));
  }, [presetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewAspectStyle = useMemo(
    () => ({ aspectRatio: `${aspect.aw} / ${aspect.ah}` }),
    [aspect]
  );

  async function onPickFile(file: File) {
    const objectUrl = URL.createObjectURL(file);

    try {
      const bitmap = await createImageBitmap(file);
      const snapped = snapAspectRatio(bitmap.width, bitmap.height);
      setAspect(snapped);
      setImg({ bitmap, w: bitmap.width, h: bitmap.height, objectUrl });
    } catch {
      const { imgEl, w, h } = await loadImageFallback(file);
      const snapped = snapAspectRatio(w, h);
      setAspect(snapped);
      setImg({ imgEl, w, h, objectUrl });
    }

    setMobileTab("resultado");
  }

  function clearImage() {
    setImg((prev) => {
      if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
      prev?.bitmap?.close?.();
      return null;
    });
    setAspect({ aw: 4, ah: 3 });
    setMobileTab("preview");
  }

  const render = () => {
    if (!img) return;

    const canvas = canvasRef.current;
    const work = workCanvasRef.current;
    if (!canvas || !work) return;

    const maxRenderSize = 1700;
    const scale = Math.min(maxRenderSize / Math.max(img.w, img.h), 1);
    const rw = Math.max(1, Math.floor(img.w * scale));
    const rh = Math.max(1, Math.floor(img.h * scale));

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    work.width = rw;
    work.height = rh;

    canvas.width = Math.floor(rw * dpr);
    canvas.height = Math.floor(rh * dpr);

    const wctx = work.getContext("2d", { willReadFrequently: true });
    const vctx = canvas.getContext("2d");
    if (!wctx || !vctx) return;

    // 1) limpa
    wctx.clearRect(0, 0, rw, rh);

    // 2) redesenha base imutável
    if (img.bitmap) wctx.drawImage(img.bitmap, 0, 0, rw, rh);
    else if (img.imgEl) wctx.drawImage(img.imgEl, 0, 0, rw, rh);
    else return;

    // 3) aplica efeito sempre a partir da base (e torna o slider intuitivo)
    const base = wctx.getImageData(0, 0, rw, rh);

    const thicknessEff = clamp(
      preset.thicknessMin + preset.thicknessMax - thickness,
      preset.thicknessMin,
      preset.thicknessMax
    );

    const processed = applyXRayEffect(base, {
      preset,
      thickness: thicknessEff,
      intensity,
      enableNoise,
      maxRenderSize,
    });

    wctx.putImageData(processed, 0, 0);

    // 4) exibe (canvas é saída)
    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vctx.clearRect(0, 0, rw, rh);
    vctx.drawImage(work, 0, 0);
  };

  // Renderiza quando Resultado estiver visível (mobile) + sempre no desktop
  useEffect(() => {
    if (!img) return;

    const isDesktop = window.matchMedia?.("(min-width: 768px)")?.matches ?? true;
    if (!isDesktop && mobileTab !== "resultado") return;

    const id = requestAnimationFrame(() => render());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, presetKey, thickness, intensity, enableNoise, mobileTab]);

  useEffect(() => {
    if (!img) return;
    const onResize = () => render();
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);

  return (
    <div className="min-h-dvh w-screen flex flex-col overflow-hidden">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-zinc-300">X-Ray Realista em Tecidos</div>
            <div className="text-xs text-zinc-500">
              Client-only • pipeline imutável • canvas apenas como saída
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
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs hover:bg-zinc-800 disabled:opacity-50"
              disabled={!img}
            >
              Limpar
            </button>
          </div>
        </div>
      </header>

      {/* Sem scroll global; scroll interno */}
      <section className="flex-1 overflow-y-auto p-4">
        {/* Tabs mobile */}
        <div className="mb-3 flex gap-2 md:hidden">
          <button
            type="button"
            onClick={() => setMobileTab("preview")}
            className={`flex-1 rounded-md border px-3 py-2 text-xs ${
              mobileTab === "preview" ? "border-zinc-500 bg-zinc-800" : "border-zinc-800 bg-zinc-900"
            }`}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("resultado")}
            className={`flex-1 rounded-md border px-3 py-2 text-xs ${
              mobileTab === "resultado" ? "border-zinc-500 bg-zinc-800" : "border-zinc-800 bg-zinc-900"
            }`}
          >
            Resultado
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Preview */}
          <div className={`${mobileTab !== "preview" ? "hidden md:flex" : "flex"} flex-col gap-2`}>
            <div className="text-xs text-zinc-400">Upload / Preview</div>
            <div
              className="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
              style={viewAspectStyle}
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
          </div>

          {/* Resultado */}
          <div className={`${mobileTab !== "resultado" ? "hidden md:flex" : "flex"} flex-col gap-2`}>
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
          </div>
        </div>

        {/* Controles fora do container do canvas */}
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
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
                Presets limitam intensidade/densidade para evitar imagem estourada.
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-400">Espessura: {thickness.toFixed(2)}</label>
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
            </div>

            <div>
              <label className="block text-xs text-zinc-400">Intensidade: {intensity.toFixed(2)}</label>
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
        </div>
      </section>
    </div>
  );
}
