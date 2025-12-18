< script >
  const arquivoInput = documento . getElementById ( 'fileInput' );
  const canvas = document.getElementById ( 'canvas ' )
 ;
  const ctx = canvas.getContext ( ' 2d' );
  const uploadArea = document.getElementById ( 'uploadArea' ) ;
  const overlay = document.getElementById ( ' processingOverlay' ) ;
  const status = document.getElementById ( ' status' ) ;

  let originalImage = null ;

  const sliders = [
    'brilho' , 'contraste' , 'exposição' ,
    'sombras' , 'destaques' , 'saturação' ,
    'nitidez' , 'clareza' , 'vibração' , 'transparência'
  ];

  // Helpers numéricos
  const clamp = ( v, a, b ) => Math . max (a, Math . min (b, v));
 
  const lerp = ( a, b, t ) => a + (b - a) * t;
 
  const srgbToLin = ( x ) => {
 
    const v = x / 255 ;
    retornar v <= 0.04045 ? v / 12.92 : Math . pow ((v + 0.055 ) / 1.055 , 2.4 );
  };
  const linToSrgb = ( x ) => {
 
    const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math . pow (x, 1 / 2.4 ) - 0.055 ;
    retornar clamp ( Math . round (v * 255 ), 0 , 255 );
 
  };
  const luminanceLin = ( r, g, b ) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
 

  função boxBlurRGBA ( src, w, h, radius ) {
 
    const r = Math.max ( 0 , Math.floor (
 radius ) ) ;
    se (r === 0 ) retorne src.slice ( );

    const tmp = new Uint8ClampedArray (src.length ) ;
 
    const out = new Uint8ClampedArray (src. length );
 

    para ( seja y = 0 ; y < h; y++) {
      para ( seja x = 0 ; x < w; x++) {
        seja rs = 0 , gs = 0 , bs = 0 , as = 0 , count = 0 ;
        const x0 = Math.max ( 0 , x - r)
 ;
        const x1 = Math.min (w - 1 , x + r)
 ;
        for ( seja xi = x0; xi <= x1; xi++) {
          const i = (y * w + xi) * 4 ;
          rs += src[i + 0 ];
          gs += src[i + 1 ];
          bs += src[i + 2 ];
          como += src[i + 3 ];
          contagem++;
        }
        const o = (y * w + x) * 4 ;
        tmp[o + 0 ] = (rs / contagem) | 0 ;
        tmp[o + 1 ] = (gs / contagem) | 0 ;
        tmp[o + 2 ] = (bs / contagem) | 0 ;
        tmp[o + 3 ] = ( como / contagem) | 0 ;
      }
    }

    para ( seja y = 0 ; y < h; y++) {
      para ( seja x = 0 ; x < w; x++) {
        seja rs = 0 , gs = 0 , bs = 0 , as = 0 , count = 0 ;
        const y0 = Math.max ( 0 , y - r)
 ;
        const y1 = Math.min (h - 1 , y + r)
 ;
        for ( seja yi = y0; yi <= y1; yi++) {
          const i = (yi * w + x) * 4 ;
          rs += tmp[i + 0 ];
          gs += tmp[i + 1 ];
          bs += tmp[i + 2 ];
          como += tmp[i + 3 ];
          contagem++;
        }
        const o = (y * w + x) * 4 ;
        out[o + 0 ] = (rs / contagem) | 0 ;
        out[o + 1 ] = (gs / contagem) | 0 ;
        out[o + 2 ] = (bs / contagem) | 0 ;
        out[o + 3 ] = ( como / contagem) | 0 ;
      }
    }

    retornar para fora;
  }

  // Atualiza valores numéricos ao lado dos sliders e aplica os filtros
  sliders.forEach ( id = > {
    const slider = document.getElementById ( id);
    const valueLabel = document.getElementById ( ` $ {id} Valor` );
    slider.addEventListener ( 'entrada' , () = > {
      valorLabel. textContent = controle deslizante. valor ;
      aplicarFiltros ();
    });
  });

  // Upload via botão
  fileInput.addEventListener ( 'change' , e = > {
    const file = e.target.files [ 0 ]
 ;
    se (arquivo) {
      const leitor = novo FileReader ();
 
      sobreposição.classList.adicionar ( ' ativo ' )
 ;
      leitor.onload = função ( evento )
 {
        const img = new Image ();
 
        img. onload = function ( ) {
          canvas.width = img.width ;
​
altura           da tela = altura da imagem ;
          imagemOriginal = img;
          ctx.drawImage ( img , 0 , 0 );
          sobreposição.classList.remove ( ' ativo ' )
 ;
          applyFilters(); // Aplica filtros padrão (mesmo que todos 0)
        };
        img.src = event.target.result ;​​​
      };
      leitor. lerComoURLDeDados (arquivo);
    }
  });

  // Arrastar e soltar
  uploadArea.addEventListener ( 'dragover' , e = > {
    e. prevenirDefault ();
    uploadArea.classList.add ( ' drag-over ' )
 ;
  });

  uploadArea.addEventListener ( 'dragleave' , () = > {
    uploadArea.classList.remove ( ' drag-over ' )
 ;
  });

  uploadArea.addEventListener ( 'drop' , e = > {
    e. prevenirDefault ();
    uploadArea.classList.remove ( ' drag-over ' )
 ;
    const file = e. dataTransfer . files [ 0 ];
    fileInput.files = e.dataTransfer.files ;​​​
    fileInput.dispatchEvent ( new Event ( ' change' ));
 
  });

  // Aplicar filtros à tela
  função aplicarFiltros ( ) {
 
    se (!originalImage) retornar ;

    ctx.drawImage ( originalImage , 0 , 0 );
    const imageData = ctx.getImageData ( 0 , 0 , canvas.width , canvas.height ) ;
    const data
 = imageData.data ;
    const w =
 imageData.width ;
    const h
 = imageData.height ;

    const brightness = + document.getElementById ( 'brightness' ) . value ; //    -100..100
    const contrast = + document.getElementById ( 'contrast' ) . value ;        // -100..100
    const exposure = + document.getElementById ( 'exposure' ) . value ; //        -100..100
    const shadows = + document.getElementById ( 'shadows' ) . value ; //          -100..100
    const highlights = + document.getElementById ( 'highlights' ) . value ; //    -100..100
    const saturação = + document.getElementById ( 'saturação' ) . value ; //    -100..100
    const nitidez = + document.getElementById ( 'sharpness' ) . value ; //      0..100
    const clarity = + document.getElementById ( 'clarity' ) . value ; //          0..100
    const vibrance = + document.getElementById ( 'vibrance' ) . value ; //        -100..100
    const transparency = + document.getElementById ( ' transparency' ). value ; // 0..100

    // Pré-calcula blurs para clarity/sharpness para evitar ruídos duros
    const blurLow = boxBlurRGBA (dados, w, h, 1 );
    const blurMid = boxBlurRGBA (dados, w, h, 2 );

    // Ganhos e pesos refinados
    const ganhoDeExposição = Math.pow ( 2 , exposição / 50 ); // cada 50 ~= + 1EV
    const brightnessOffset = brightness / 100 * 0.08; // deslocamento em linear
    const contrastStrength = contraste / 100 ;
    const shadowLift = shadows / 100 ;
    const highlightHold = highlights / 100 ;
    const ganhoDeSaturação = 1 + saturação / 100 ;
    const vibraçãoAmt = vibração / 100 ;
    const clarityAmt = clarity / 100 * 0.35 ;
    const sharpAmt = nitidez / 100 * 0,6 ;
    const transparencyFactor = clamp ( 1 - transparency / 100 , 0 , 1 );

    para ( seja i = 0 ; i < data.length ; i += 4 ) {
      const r0 = data[i];
      const g0 = data[i + 1 ];
      const b0 = data[i + 2 ];

      // Conversões para linear para preservar tonalidade
      seja rl = srgbToLin (r0);
      let gl = srgbToLin (g0);
      let bl = srgbToLin (b0);

      // Exposição + brilho em linear
      rl = rl * ganhoDeExposição + DeslocamentoDeBordura;
      gl = gl * ganhoDeExposição + DeslocamentoDeBordura;
      bl = bl * ganhoDeExposição + DeslocamentoDeBordura;

      // Luminosidade para curvas de contraste/sombras/realces
      const y = luminânciaLin (rl, gl, bl);
      seja yCurve = y;

      // Contraste com S-curve suave
      se (forçacontraste !== 0 ) {
        const d = yCurve - 0.5 ;
        yCurve = yCurve + contrastStrength * d * ( 1 - Math . min ( 1 , Math . abs (d) * 2 )) * 0.8 ;
      }

      // Sombras/Luzes
      se (shadowLift !== 0 ) {
        const lift = shadowLift > 0
          ? shadowLift * ( 1 - yCurve) * 0,6
          : shadowLift * 0,4 * yCurve;
        yCurve = clamp (yCurve + lift, 0 , 1 );
      }
      se (highlightHold !== 0 ) {
        const rolloff = Math.pow ( yCurve , 2 );
        const hold = highlightHold > 0
          ? -destaqueManter * rolloff * 0,6
          : Math.abs ( highlightHold) * ( 1 - yCurve) * 0.3 ;
        yCurve = clamp (yCurve + hold, 0 , 1 );
      }

      // Reescala canais mantendo crominância original
      const ySafe = y > 1e-6 ? yCurve / y : 1 ;
      rl = clamp (rl * ySafe, 0 , 1 );
      gl = clamp (gl * ySafe, 0 , 1 );
      bl = clamp (bl * ySafe, 0 , 1 );

      // Converte para sRGB pós curvas para operações no espaço correto
      const rBase = linToSrgb (rl);
      const gBase = linToSrgb (gl);
      const bBase = linToSrgb (bl);

      // Saturação e vibrance
      const lum = 0,2126 * rBase + 0,7152 * gBase + 0,0722 * bBase;
      const satTarget = ganhoDeSaturação;

      const maxRGB = Math.max ( rBase , gBase, bBase) || 1 ;
      const minRGB = Math.min ( rBase , gBase, bBase);
      const satLevel = maxRGB - minRGB;
      const vibranceBoost = vibranceAmt * clamp ( 1 - satLevel / 255 , 0 , 1 );

      seja rSat = rBase + (rBase - lum) * (satTarget - 1 + vibranceBoost);
      deixe gSat = gBase + (gBase - lum) * (satTarget - 1 + vibranceBoost);
      seja bSat = bBase + (bBase - lum) * (satTarget - 1 + vibranceBoost);

      // Clarity: realça microcontraste de médios sem exagerar
      const hpMidR = (rBase - blurMid[i]) * clarityAmt;
      const hpMidG = (gBase - blurMid[i + 1 ]) * clarezaAmt;
      const hpMidB = (bBase - blurMid[i + 2 ]) * clarityAmt;
      rSat += hpMidR;
      gSat += hpMidG;
      bSat += hpMidB;

      // Sharpness: unsharp leve com blur curto
      const unsharpR = (rBase - blurLow[i]) * sharpAmt;
      const unsharpG = (gBase - blurLow[i + 1 ]) * sharpAmt;
      const unsharpB = (bBase - blurLow[i + 2 ]) * sharpAmt;
      rSat += unsharpR;
      gSat += unsharpG;
      bSat += unsharpB;

      dados[i] = truncar (rSat);
      dados[i + 1 ] = truncar (gSat);
      dados[i + 2 ] = truncar (bSat);
      dados[i + 3 ] = Math . round (dados[i + 3 ] * transparencyFactor);
    }

    ctx.putImageData ( imageData , 0 , 0 );
  }

  função truncar ( v ) {
 
    retornar Math.max ( 0 , Math.min ( 255 , v ) ) ;
 
  }

  função resetControls ( ) {
 
    sliders.forEach ( id = > {
      const slider = document.getElementById ( id);
valor       do controle deslizante = 0 ;
      document.getElementById ( ` ${id} Valor` ) .textContent = ' 0 ' ;
    });
    if (originalImage) ctx.drawImage ( originalImage, 0 , 0 );
  }

  função baixarImagem ( ) {
 
    const link = document.createElement ( 'a ' )
 ;
    link.download = 'imagem_editada.png';
    link.href = canvas.toDataURL ( )
 ;
    link. clique ();
  }

  função aplicarPredefinição ( predefinição ) {
 
    const presets = {
      ultraLeve : { brilho : 20 , contraste : 30 , sombras : 100 , realces : -20 , exposição : 10 }
      nível : { brilho : 15 , contraste : 20 , sombras : 80 },
      