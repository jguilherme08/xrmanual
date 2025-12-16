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

type BrushMode = "dodge" | "burn";

export default function XRayApp() {
  const [presetKey, setPresetKey] = useState<FabricPresetKey>("cortina");
  const preset = PRESETS[presetKey];

  // X-ray
  const [thickness, setThickness] = useState<number>(0.55);
  const [intensity, setIntensity] = useState<number>(1.0);
  const [enableNoise, setEnableNoise] = useState<boolean>(true);

  // Tonalidade (controles “visíveis”)
  const [shadows, setShadows] = useState(0.55);
  const [blacks, setBlacks] = useState(0.35);
  const [highlights, setHighlights] = useState(0.25);
  const [contrast, setContrast] = useState(0.25);

  // Textura / microcontraste
  const [clarity, setClarity] = useState(0.35);
  const [dehaze, setDehaze] = useState(0.15);

  // Ruído e nitidez
  const [denoiseColor, setDenoiseColor] = useState(0.25);
  const [denoiseLuma, setDenoiseLuma] = useState(0.20);
  const [sharpen, setSharpen] = useState(0.20);
  const [sharpenMasking, setSharpenMasking] = useState(0.55);

  const [img, setImg] = useState<LoadedImage | null>(null);
  const [aspect, setAspect] = useState<{ aw: number; ah: number }>({ aw: 4, ah: 3 });

  // Aba única (sempre) para manter “preview e resultado não coexistem”
  const [tab, setTab] = useState<"preview" | "resultado">("preview");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // máscaras para Dodge/Burn (mesma resolução do render)
  const dodgeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const burnCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // últimos tamanhos de render (para mapear pincel)
  const lastRenderRef = useRef<{ rw: number; rh: number } | null>(null);

  // Brush
  const [brushEnabled, setBrushEnabled] = useState(false);
  const [brushMode, setBrushMode] = useState<BrushMode>("dodge");
  const [brushSize, setBrushSize] = useState(46); // px em coords do render
  const [brushOpacity, setBrushOpacity] = useState(0.12); // 5–15% típico
  const paintingRef = useRef(false);

  useEffect(() => {
    if (!workCanvasRef.current) workCanvasRef.current = document.createElement("canvas");
    if (!dodgeCanvasRef.current) dodgeCanvasRef.current = document.createElement("canvas");
    if (!burnCanvasRef.current) burnCanvasRef.current = document.createElement("canvas");
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

    setTab("resultado");
  }

  function clearImage() {
    setImg((prev) => {
      if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
      prev?.bitmap?.close?.();
      return null;
    });
    setAspect({ aw: 4, ah: 3 });
    clearMasks();
    setTab("preview");
  }

  function clearMasks() {
    const d = dodgeCanvasRef.current;
    const b = burnCanvasRef.current;
    const lr = lastRenderRef.current;
    if (!d || !b || !lr) return;

    d.width = lr.rw;
    d.height = lr.rh;
    b.width = lr.rw;
    b.height = lr.rh;

    const dctx = d.getContext("2d");
    const bctx = b.getContext("2d");
    dctx?.clearRect(0, 0, lr.rw, lr.rh);
    bctx?.clearRect(0, 0, lr.rw, lr.rh);
  }

  const render = () => {
    if (!img) return;

    const canvas = canvasRef.current;
    const work = workCanvasRef.current;
    const dodgeC = dodgeCanvasRef.current;
    const burnC = burnCanvasRef.current;
    if (!canvas || !work || !dodgeC || !burnC) return;

    const maxRenderSize = 1700;
    const scale = Math.min(maxRenderSize / Math.max(img.w, img.h), 1);
    const rw = Math.max(1, Math.floor(img.w * scale));
    const rh = Math.max(1, Math.floor(img.h * scale));
    lastRenderRef.current = { rw, rh };

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    work.width = rw;
    work.height = rh;

    canvas.width = Math.floor(rw * dpr);
    canvas.height = Math.floor(rh * dpr);

    // garante máscaras na mesma resolução
    if (dodgeC.width !== rw || dodgeC.height !== rh) {
      dodgeC.width = rw;
      dodgeC.height = rh;
      burnC.width = rw;
      burnC.height = rh;
    }

    const wctx = work.getContext("2d", { willReadFrequently: true });
    const vctx = canvas.getContext("2d");
    if (!wctx || !vctx) return;

    wctx.clearRect(0, 0, rw, rh);

    if (img.bitmap) wctx.drawImage(img.bitmap, 0, 0, rw, rh);
    else if (img.imgEl) wctx.drawImage(img.imgEl, 0, 0, rw, rh);
    else return;

    const base = wctx.getImageData(0, 0, rw, rh);

    // slider intuitivo: mais para a direita => mais efeito
    const thicknessEff = clamp(
      preset.thicknessMin + preset.thicknessMax - thickness,
      preset.thicknessMin,
      preset.thicknessMax
    );

    const dctx = dodgeC.getContext("2d");
    const bctx = burnC.getContext("2d");
    const dodgeData = dctx?.getImageData(0, 0, rw, rh).data;
    const burnData = bctx?.getImageData(0, 0, rw, rh).data;

    // converte RGBA->1 canal (alpha do desenho). usamos canal R
    const dodgeMask = dodgeData ? new Uint8ClampedArray(rw * rh) : undefined;
    const burnMask = burnData ? new Uint8ClampedArray(rw * rh) : undefined;

    if (dodgeMask && dodgeData) {
      for (let p = 0, k = 0; p < dodgeData.length; p += 4, k++) dodgeMask[k] = dodgeData[p];
    }
    if (burnMask && burnData) {
      for (let p = 0, k = 0; p < burnData.length; p += 4, k++) burnMask[k] = burnData[p];
    }

    const processed = applyXRayEffect(base, {
      preset,
      thickness: thicknessEff,
      intensity,
      enableNoise,
      maxRenderSize,

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
    });

    wctx.putImageData(processed, 0, 0);

    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vctx.clearRect(0, 0, rw, rh);
    vctx.drawImage(work, 0, 0);
  };

  // Re-render quando controles mudarem e quando Resultado estiver visível
  useEffect(() => {
    if (!img) return;
    if (tab !== "resultado") return;
    const id = requestAnimationFrame(() => render());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    img,
    presetKey,
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
    tab,
  ]);

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

  // pintura local (Dodge & Burn) – desenha na máscara (canvas offscreen)
  function paintAt(clientX: number, clientY: number) {
    const lr = lastRenderRef.current;
    if (!lr) return;
    const container = canvasRef.current?.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const xNorm = (clientX - rect.left) / rect.width;
    const yNorm = (clientY - rect.top) / rect.height;

    const x = clamp(Math.round(xNorm * lr.rw), 0, lr.rw - 1);
    const y = clamp(Math.round(yNorm * lr.rh), 0, lr.rh - 1);

    const target = brushMode === "dodge" ? dodgeCanvasRef.current : burnCanvasRef.current;
    if (!target) return;

    const ctx = target.getContext("2d");
    if (!ctx) return;

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "white";
    ctx.globalAlpha = clamp(brushOpacity, 0.02, 0.25);

    ctx.beginPath();
    ctx.arc(x, y, clamp(brushSize, 8, 140), 0, Math.PI * 2);
    ctx.fill();

    // renderiza de novo para ver o efeito
    requestAnimationFrame(() => render());
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!brushEnabled) return;
    paintingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    paintAt(e.clientX, e.clientY);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!brushEnabled) return;
    if (!paintingRef.current) return;
    paintAt(e.clientX, e.clientY);
  }

  function onPointerUp() {
    paintingRef.current = false;
  }

  return (
    <div className="min-h-dvh w-screen flex flex-col overflow-hidden">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-zinc-300">X-Ray Realista em Tecidos</div>
            <div className="text-xs text-zinc-500">Client-only • pipeline imutável • canvas apenas como saída</div>
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

      {/* scroll interno */}
      <section className="flex-1 overflow-y-auto p-4">
        {/* Tabs sempre (para não coexistirem visualmente) */}
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={`flex-1 rounded-md border px-3 py-2 text-xs ${
              tab === "preview" ? "border-zinc-500 bg-zinc-800" : "border-zinc-800 bg-zinc-900"
            }`}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setTab("resultado")}
            className={`flex-1 rounded-md border px-3 py-2 text-xs ${
              tab === "resultado" ? "border-zinc-500 bg-zinc-800" : "border-zinc-800 bg-zinc-900"
            }`}
          >
            Resultado
          </button>
        </div>

        {/* Preview */}
        {tab === "preview" && (
          <div className="flex flex-col gap-2">
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
        )}

        {/* Resultado */}
        {tab === "resultado" && (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-zinc-400">
              Resultado (X-ray) {brushEnabled ? "• Pincel ativo" : ""}
            </div>

            <div
              className="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 touch-none"
              style={viewAspectStyle}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              <canvas
                ref={canvasRef}
                className="absolute inset-0 block"
                style={{ width: "100%", height: "100%" }}
              />

              {!img && (
                <div className="absolute inset-0 grid place-items-center p-6 text-center">
                  <div className="max-w-xs text-sm text-zinc-400">Aguardando upload para renderizar o resultado.</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* CONTROLES */}
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
                Regra prática: aumente Sombras até aparecer detalhe; depois ajuste Pretos; segure Realces.
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-400">Espessura (↔ efeito): {thickness.toFixed(2)}</label>
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
              <label className="block text-xs text-zinc-400">Força X-ray: {intensity.toFixed(2)}</label>
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

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-xs text-zinc-400 mb-2">Curvas + Sombras + Pretos + Realces</div>

              <label className="block text-xs text-zinc-400">Sombras: {shadows.toFixed(2)}</label>
              <input className="w-full" type="range" min={0} max={1} step={0.01} value={shadows} onChange={(e) => setShadows(parseFloat(e.target.value))} disabled={!img} />

              <label className="mt-2 block text-xs text-zinc-400">Pretos: {blacks.toFixed(2)}</label>
              <input className="w-full" type="range" min={0} max={1} step={0.01} value={blacks} onChange={(e) => setBlacks(parseFloat(e.target.value))} disabled={!img} />

              <label className="mt-2 block text-xs text-zinc-400">Realces: {highlights.toFixed(2)}</label>
              <input className="w-full" type="range" min={0} max={1} step={0.01} value={highlights} onChange={(e) => setHighlights(parseFloat(e.target.value))} disabled={!img} />

              <label className="mt-2 block text-xs text-zinc-400">Curvas (contraste S): {contrast.toFixed(2)}</label>
              <input className="w-full" type="range" min={0} max={1} step={0.01} value={contrast} onChange={(e) => setContrast(parseFloat(e.target.value))} disabled={!img} />
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-xs text-zinc-400 mb-2">Textura / Denoise / Nitidez</div>

              <label className="block text-xs text-zinc-400">Clarity (microcontraste): {clarity.toFixed(2)}</label>
              <input className="w-full" type="range" min={0} max={1} step={0.01} value={clarity} onChange={(e) => setClarity(parseFloat(e.target.value))} disabled={!img} />

              <label className="mt-2 block text-xs text-zinc-400">Dehaze (cuidado): {dehaze.toFixed(2)}</label>
              <input className="w-full" type="range" min={0} max={1} step={0.01} value={dehaze} onChange={(e) => setDehaze(parseFloat(e.target.value))} disabled={!img} />

              <label className="mt-2 block text-xs text-zinc-400">Denoise cor: {denoiseColor.toFixed(2)}</label>
              <input className="w-full" type="range" min={0} max={1} step={0.01} value={denoiseColor} onChange={(e) => setDenoiseColor(parseFloat(e.target.value))} disabled={!img} />

              <label className="mt-2 block text-xs text-zinc-400">Denoise luminância: {denoiseLuma.toFixed(2)}</label>
              <input className="w-full" type="range" min={0} max={1} step={0.01} value={denoiseLuma} onChange={(e) => setDenoiseLuma(parseFloat(e.target.value))} disabled={!img} />

              <label className="mt-2 block text-xs text-zinc-400">Nitidez: {sharpen.toFixed(2)}</label>
              <input className="w-full" type="range" min={0} max={1} step={0.01} value={sharpen} onChange={(e) => setSharpen(parseFloat(e.target.value))} disabled={!img} />

              <label className="mt-2 block text-xs text-zinc-400">Masking (bordas): {sharpenMasking.toFixed(2)}</label>
              <input className="w-full" type="range" min={0} max={1} step={0.01} value={sharpenMasking} onChange={(e) => setSharpenMasking(parseFloat(e.target.value))} disabled={!img} />
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="text-xs text-zinc-400 mb-2">Ajustes locais (Dodge & Burn)</div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`rounded-md border px-3 py-2 text-xs ${
                  brushEnabled ? "border-zinc-500 bg-zinc-800" : "border-zinc-800 bg-zinc-900"
                }`}
                onClick={() => setBrushEnabled((v) => !v)}
                disabled={!img || tab !== "resultado"}
              >
                {brushEnabled ? "Pincel: ON" : "Pincel: OFF"}
              </button>

              <select
                className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs"
                value={brushMode}
                onChange={(e) => setBrushMode(e.target.value as BrushMode)}
                disabled={!img || !brushEnabled}
              >
                <option value="dodge">Dodge (clarear)</option>
                <option value="burn">Burn (escurecer)</option>
              </select>

              <button
                type="button"
                className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs"
                onClick={() => {
                  clearMasks();
                  requestAnimationFrame(() => render());
                }}
                disabled={!img}
              >
                Limpar máscara
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="block text-xs text-zinc-400">Tamanho: {brushSize}px</label>
                <input className="w-full" type="range" min={8} max={140} step={1} value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value, 10))} disabled={!img || !brushEnabled} />
              </div>
              <div>
                <label className="block text-xs text-zinc-400">Opacidade: {brushOpacity.toFixed(2)}</label>
                <input className="w-full" type="range" min={0.05} max={0.2} step={0.01} value={brushOpacity} onChange={(e) => setBrushOpacity(parseFloat(e.target.value))} disabled={!img || !brushEnabled} />
              </div>
              <div className="text-[11px] text-zinc-500">
                Use baixa opacidade (5–15%) e várias passadas. Isso dá volume sem estourar.
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}



