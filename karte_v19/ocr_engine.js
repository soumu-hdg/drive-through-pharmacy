// ocr_engine.js - 保険証OCRエンジン v3（完全ローカル処理、外部送信なし）
// Tesseract.js v5 + カード自動クロップ + HSV彩度フィルタv2 + 適応的閾値 + ノイズ除去 + マルチパスOCR

const OCR_ENGINE = (() => {

  let worker = null;
  let isInitialized = false;
  let initPromise = null;

  // ===== 1. Tesseract.js 初期化 =====
  async function init(progressCb) {
    if (isInitialized && worker) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      if (progressCb) progressCb('OCRエンジン読込中...', 0);
      const { createWorker } = Tesseract;
      worker = await createWorker('jpn', 1, {
        logger: m => {
          if (progressCb && m.progress !== undefined) {
            const pct = Math.round(m.progress * 100);
            const statusText = m.status === 'recognizing text' ? '文字認識中...' :
                               m.status === 'loading language traineddata' ? '日本語データ読込中...' :
                               m.status === 'initializing api' ? 'エンジン初期化中...' : m.status;
            progressCb(statusText, pct);
          }
        }
      });
      await worker.setParameters({
        tessedit_pageseg_mode: '6',
      });
      isInitialized = true;
      if (progressCb) progressCb('準備完了', 100);
    })();
    return initPromise;
  }

  // ===== 2. 画像前処理 v2: 保険証特化 =====

  // --- 2a. アンシャープマスク（カメラぼけ補正） ---
  function sharpen(ctx, w, h) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const src = new Uint8ClampedArray(imgData.data);
    const dst = imgData.data;
    // 3x3 sharpen kernel (center=9, cross=-1, corners=-1 → edge-preserving sharpen)
    const amount = 0.4; // mix ratio
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        for (let c = 0; c < 3; c++) {
          const idx = (y * w + x) * 4 + c;
          const sharp = 5 * src[idx]
            - src[((y-1)*w+x)*4+c]
            - src[((y+1)*w+x)*4+c]
            - src[(y*w+x-1)*4+c]
            - src[(y*w+x+1)*4+c];
          dst[idx] = Math.max(0, Math.min(255, Math.round(src[idx] * (1 - amount) + sharp * amount)));
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // --- 2b. カード領域自動クロップ ---
  function detectCardRegion(imgElement) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const sw = 400;
    const sh = Math.round(imgElement.naturalHeight * (sw / imgElement.naturalWidth));
    canvas.width = sw;
    canvas.height = sh;
    ctx.drawImage(imgElement, 0, 0, sw, sh);
    const imgData = ctx.getImageData(0, 0, sw, sh);
    const d = imgData.data;

    // 黄色〜ベージュ + 白領域を検出（保険証カード背景色）
    const mask = new Uint8Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) {
      const r = d[i*4], g = d[i*4+1], b = d[i*4+2];
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const delta = maxC - minC;
      if (maxC === 0) continue;
      let h = 0;
      if (delta > 0) {
        if (maxC === r) h = 60 * (((g - b) / delta) % 6);
        else if (maxC === g) h = 60 * ((b - r) / delta + 2);
        else h = 60 * ((r - g) / delta + 4);
        if (h < 0) h += 360;
      }
      const s = delta / maxC;
      const v = maxC / 255;
      // 黄色〜ベージュ範囲 or 白っぽい領域
      if (((h >= 15 && h <= 75 && s > 0.05) || (s < 0.15 && v > 0.82)) && v > 0.4) {
        mask[i] = 1;
      }
    }

    let minX = sw, maxX = 0, minY = sh, maxY = 0, count = 0;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (mask[y * sw + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          count++;
        }
      }
    }

    const ratio = count / (sw * sh);
    if (ratio < 0.25 || (maxX - minX) < sw * 0.25 || (maxY - minY) < sh * 0.15) {
      return null;
    }

    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.03);
    const scaleBack = imgElement.naturalWidth / sw;
    return {
      x: Math.max(0, Math.round((minX - pad) * scaleBack)),
      y: Math.max(0, Math.round((minY - pad) * scaleBack)),
      w: Math.min(imgElement.naturalWidth, Math.round((maxX - minX + pad * 2) * scaleBack)),
      h: Math.min(imgElement.naturalHeight, Math.round((maxY - minY + pad * 2) * scaleBack)),
    };
  }

  // --- 2c. メイン前処理: カードクロップ + 彩度フィルタv2 + 適応的閾値 + ノイズ除去 ---
  function preprocessInsuranceCard(imgElement) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // カード領域を検出してクロップ
    const cardRect = detectCardRegion(imgElement);
    let srcX = 0, srcY = 0, srcW = imgElement.naturalWidth, srcH = imgElement.naturalHeight;
    if (cardRect) {
      srcX = cardRect.x;
      srcY = cardRect.y;
      srcW = cardRect.w;
      srcH = cardRect.h;
    }

    // 解像度を上げてOCR精度向上（最大2800px幅）
    const scale = Math.min(2800 / srcW, 3.5);
    canvas.width = Math.round(srcW * scale);
    canvas.height = Math.round(srcH * scale);
    ctx.drawImage(imgElement, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);

    // シャープニング
    sharpen(ctx, canvas.width, canvas.height);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    const w = canvas.width, h = canvas.height, n = w * h;

    // ====== Phase 1: HSV彩度フィルタ v2（強化版） ======
    const gray = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      const r = d[i*4], g = d[i*4+1], b = d[i*4+2];
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
      const lum = (r * 0.299 + g * 0.587 + b * 0.114);

      // テキスト判定: 暗い + 低彩度
      const isDarkText = lum < 100 && sat < 0.25;
      // 中間トーン: やや暗い + 低彩度（印字かすれ対応）
      const isMidText = lum < 150 && sat < 0.10;

      if (isDarkText || isMidText) {
        gray[i] = Math.round(lum);
      } else {
        gray[i] = 255;
      }
    }

    // ====== Phase 2: 適応的閾値（より細かいブロック） ======
    const blockSize = 24;
    const C_THRESH = 15;
    const dw = Math.ceil(w / blockSize);
    const dh = Math.ceil(h / blockSize);
    const blockMeans = new Float32Array(dw * dh);
    const blockCounts = new Uint32Array(dw * dh);

    for (let y = 0; y < h; y++) {
      const by = Math.min(Math.floor(y / blockSize), dh - 1);
      for (let x = 0; x < w; x++) {
        const bx = Math.min(Math.floor(x / blockSize), dw - 1);
        const bi = by * dw + bx;
        blockMeans[bi] += gray[y * w + x];
        blockCounts[bi]++;
      }
    }
    for (let i = 0; i < dw * dh; i++) {
      blockMeans[i] = blockCounts[i] > 0 ? blockMeans[i] / blockCounts[i] : 128;
    }

    for (let y = 0; y < h; y++) {
      const fy = (y + 0.5) / blockSize - 0.5;
      const by0 = Math.max(0, Math.min(Math.floor(fy), dh - 2));
      const by1 = by0 + 1;
      const ty = fy - by0;

      for (let x = 0; x < w; x++) {
        const fx = (x + 0.5) / blockSize - 0.5;
        const bx0 = Math.max(0, Math.min(Math.floor(fx), dw - 2));
        const bx1 = bx0 + 1;
        const tx = fx - bx0;

        const m00 = blockMeans[by0 * dw + bx0];
        const m10 = blockMeans[by0 * dw + bx1];
        const m01 = blockMeans[by1 * dw + bx0];
        const m11 = blockMeans[by1 * dw + bx1];
        const localMean = m00*(1-tx)*(1-ty) + m10*tx*(1-ty) + m01*(1-tx)*ty + m11*tx*ty;

        const idx = y * w + x;
        const threshold = localMean - C_THRESH;
        const v = gray[idx] < threshold ? 0 : 255;
        d[idx*4] = d[idx*4+1] = d[idx*4+2] = v;
      }
    }

    // ====== Phase 3: ノイズ除去（孤立黒点の白化） ======
    ctx.putImageData(imgData, 0, 0);
    const binData = ctx.getImageData(0, 0, w, h);
    const bd = binData.data;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        if (bd[idx] === 0) {
          let blackN = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dy === 0 && dx === 0) continue;
              if (bd[((y+dy)*w+(x+dx))*4] === 0) blackN++;
            }
          }
          if (blackN <= 1) {
            bd[idx] = bd[idx+1] = bd[idx+2] = 255;
          }
        }
      }
    }
    ctx.putImageData(binData, 0, 0);

    return canvas;
  }

  // --- 2d. シンプル前処理（カードクロップ + グレースケール + コントラスト正規化） ---
  function preprocessSimple(imgElement) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // カード領域クロップ（パス1と同じ検出を使用）
    const cardRect = detectCardRegion(imgElement);
    let srcX = 0, srcY = 0, srcW = imgElement.naturalWidth, srcH = imgElement.naturalHeight;
    if (cardRect) {
      srcX = cardRect.x;
      srcY = cardRect.y;
      srcW = cardRect.w;
      srcH = cardRect.h;
    }

    const scale = Math.min(2400 / srcW, 3);
    canvas.width = Math.round(srcW * scale);
    canvas.height = Math.round(srcH * scale);
    ctx.drawImage(imgElement, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);

    sharpen(ctx, canvas.width, canvas.height);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    const n = d.length / 4;

    // グレースケール変換
    for (let i = 0; i < n; i++) {
      const gray = Math.round(d[i*4] * 0.299 + d[i*4+1] * 0.587 + d[i*4+2] * 0.114);
      d[i*4] = d[i*4+1] = d[i*4+2] = gray;
    }

    // パーセンタイルベースのコントラスト正規化（外れ値に強い）
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < n; i++) histogram[d[i*4]]++;
    let cumSum = 0;
    let pLow = 0, pHigh = 255;
    for (let i = 0; i < 256; i++) {
      cumSum += histogram[i];
      if (cumSum >= n * 0.02 && pLow === 0) pLow = i; // 2%ile
      if (cumSum >= n * 0.98) { pHigh = i; break; } // 98%ile
    }
    const range = pHigh - pLow || 1;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(255, Math.round(((d[i*4] - pLow) / range) * 255)));
      d[i*4] = d[i*4+1] = d[i*4+2] = v;
    }

    // 適応的閾値（パス1より大きいブロックで穏やかに）
    const w = canvas.width, h = canvas.height;
    const gray = new Uint8Array(n);
    for (let i = 0; i < n; i++) gray[i] = d[i*4];

    const blockSize = 40;
    const C_THRESH = 10;
    const dw = Math.ceil(w / blockSize);
    const dh = Math.ceil(h / blockSize);
    const blockMeans = new Float32Array(dw * dh);
    const blockCounts = new Uint32Array(dw * dh);

    for (let y = 0; y < h; y++) {
      const by = Math.min(Math.floor(y / blockSize), dh - 1);
      for (let x = 0; x < w; x++) {
        const bx = Math.min(Math.floor(x / blockSize), dw - 1);
        const bi = by * dw + bx;
        blockMeans[bi] += gray[y * w + x];
        blockCounts[bi]++;
      }
    }
    for (let i = 0; i < dw * dh; i++) {
      blockMeans[i] = blockCounts[i] > 0 ? blockMeans[i] / blockCounts[i] : 128;
    }

    for (let y = 0; y < h; y++) {
      const fy = (y + 0.5) / blockSize - 0.5;
      const by0 = Math.max(0, Math.min(Math.floor(fy), dh - 2));
      const by1 = by0 + 1;
      const ty = fy - by0;
      for (let x = 0; x < w; x++) {
        const fx = (x + 0.5) / blockSize - 0.5;
        const bx0 = Math.max(0, Math.min(Math.floor(fx), dw - 2));
        const bx1 = bx0 + 1;
        const tx = fx - bx0;
        const m00 = blockMeans[by0 * dw + bx0];
        const m10 = blockMeans[by0 * dw + bx1];
        const m01 = blockMeans[by1 * dw + bx0];
        const m11 = blockMeans[by1 * dw + bx1];
        const localMean = m00*(1-tx)*(1-ty) + m10*tx*(1-ty) + m01*(1-tx)*ty + m11*tx*ty;
        const idx = y * w + x;
        d[idx*4] = d[idx*4+1] = d[idx*4+2] = gray[idx] < (localMean - C_THRESH) ? 0 : 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // ===== 3. OCR実行（マルチパス） =====
  async function recognize(imgSource, progressCb) {
    await init(progressCb);

    // 画像読み込み
    let imgEl;
    if (imgSource instanceof HTMLImageElement || imgSource instanceof HTMLCanvasElement) {
      imgEl = imgSource;
    } else if (typeof imgSource === 'string') {
      imgEl = new Image();
      imgEl.src = imgSource;
      await new Promise((resolve, reject) => {
        imgEl.onload = resolve;
        imgEl.onerror = reject;
      });
    }

    // === パス1: 保険証特化前処理 ===
    if (progressCb) progressCb('前処理中（カラーフィルタ）...', 5);
    const processed1 = preprocessInsuranceCard(imgEl);

    if (progressCb) progressCb('文字認識中（1回目）...', 10);
    const result1 = await worker.recognize(processed1);
    const text1 = result1.data.text;
    const fields1 = extractInsuranceFields(text1);

    // 重要フィールドが全て揃っていて高信頼度ならパス1のみで返す
    const hasAllCritical = fields1.insurerNumber && fields1.dob && fields1.nameKana && fields1.name;
    if (fields1.confidence >= 80 && hasAllCritical) {
      if (progressCb) progressCb('解析完了', 100);
      return result1.data;
    }

    // === パス2: シンプル前処理で再試行 ===
    if (progressCb) progressCb('精度不足、別の前処理で再試行中...', 50);
    const processed2 = preprocessSimple(imgEl);
    const result2 = await worker.recognize(processed2);
    const text2 = result2.data.text;
    const fields2 = extractInsuranceFields(text2);

    // パス2が実質的に空の場合はパス1をそのまま返す
    if (fields2.confidence <= 5 || (text2 || '').trim().length < 20) {
      if (progressCb) progressCb('解析完了', 100);
      result1.data._mergedFields = fields1;
      return result1.data;
    }

    // フィールドレベルでマージ（各フィールドで見つかった方を採用）
    if (progressCb) progressCb('結果統合中...', 90);
    const merged = mergeFields(fields1, fields2);

    // マージ結果のテキストを設定
    const bestData = merged._source2Better ? result2.data : result1.data;
    bestData._mergedFields = merged;
    if (progressCb) progressCb('解析完了', 100);
    return bestData;
  }

  // カナ名の品質スコア（カタカナ文字の割合で判定）
  function kanaQuality(str) {
    if (!str) return 0;
    const kataCount = (str.match(/[ァ-ヶ]/g) || []).length;
    const total = str.replace(/[\s　]/g, '').length;
    return total > 0 ? kataCount / total : 0;
  }

  // フィールドマージ: 2つの結果から各フィールドのベストを選択
  function mergeFields(f1, f2) {
    const result = { ...f1 };
    const fieldNames = ['insurerNumber','symbol','memberNumber','name','nameKana',
      'dob','sex','address','postalCode','expiry','insurerName','qualifier'];
    let f2Wins = 0;
    for (const key of fieldNames) {
      if (!f1[key] && f2[key]) {
        result[key] = f2[key];
        f2Wins++;
      } else if (f1[key] && f2[key] && key === 'nameKana') {
        // カナ名は品質が高い方を採用
        if (kanaQuality(f2[key]) > kanaQuality(f1[key])) {
          result[key] = f2[key];
          f2Wins++;
        }
      } else if (f1[key] && f2[key] && key === 'insurerNumber') {
        // 保険者番号は8桁に近い方を優先
        const d1 = Math.abs(f1[key].length - 8);
        const d2 = Math.abs(f2[key].length - 8);
        if (d2 < d1) {
          result[key] = f2[key];
          f2Wins++;
        }
      } else if (f1[key] && f2[key] && key === 'name') {
        // 漢字名は漢字比率が高い方を優先
        const k1 = (f1[key].match(/[\u4e00-\u9fff]/g) || []).length;
        const k2 = (f2[key].match(/[\u4e00-\u9fff]/g) || []).length;
        if (k2 > k1) {
          result[key] = f2[key];
          f2Wins++;
        }
      }
    }
    // 信頼度を再計算
    let score = 0;
    if (result.insurerNumber) score += 25;
    if (result.dob) score += 20;
    if (result.nameKana) score += 15;
    if (result.name) score += 10;
    if (result.sex) score += 5;
    if (result.postalCode) score += 10;
    if (result.address) score += 10;
    if (result.memberNumber) score += 5;
    result.confidence = score;
    result._source2Better = f2.confidence > f1.confidence;
    result.rawText = f1.rawText + '\n---\n' + f2.rawText;
    return result;
  }

  // ===== 4. OCRテキスト正規化（Tesseract.jsの文字間スペース除去） =====
  function normalizeOcrText(rawText) {
    return rawText.replace(/\r\n/g, '\n').split('\n').map(line => {
      // カタカナ行: スペース除去後に辞書で姓名分割
      if (/[ァ-ヶー]/.test(line) && !/[a-zA-Z0-9]/.test(line)) {
        const noSpace = line.replace(/\s+/g, '');
        if (/^[ァ-ヶー]+$/.test(noSpace) && noSpace.length >= 3) {
          return guessKanaSplit(noSpace);
        }
      }
      let normalized = line;
      // CJK文字間のスペース除去（3回適用で連続対応）
      for (let i = 0; i < 3; i++) {
        normalized = normalized.replace(/([\u3000-\u9fff\uff00-\uffef])\s+([\u3000-\u9fff\uff00-\uffef])/g, '$1$2');
      }
      // ラベルキーワードの後にスペースを復元
      normalized = normalized.replace(/(氏名|住所|記号|番号|性別|生年月日|有効期限|保険者番号|被保険者番号|保険者名称|資格取得|保険者所在地|枝番)(?=[^\s])/g, '$1 ');
      return normalized;
    }).join('\n');
  }

  // カタカナ列を姓名に分割（辞書ベース）
  function guessKanaSplit(kataStr) {
    if (typeof NAME_DICT === 'undefined') return kataStr;
    for (let len = Math.min(kataStr.length - 1, 5); len >= 2; len--) {
      const surPart = kataStr.substring(0, len);
      if (NAME_DICT.SURNAME[surPart]) {
        return surPart + ' ' + kataStr.substring(len);
      }
    }
    for (let len = Math.min(kataStr.length - 1, 5); len >= 2; len--) {
      const givPart = kataStr.substring(kataStr.length - len);
      if (NAME_DICT.MALE_GIVEN[givPart] || NAME_DICT.FEMALE_GIVEN[givPart]) {
        return kataStr.substring(0, kataStr.length - len) + ' ' + givPart;
      }
    }
    return kataStr;
  }

  // ===== 5. 保険証フィールド抽出（v4: OCR誤字耐性強化） =====

  // OCR文字列から数字だけを抽出する（記号・スペース・誤認識文字を除去）
  function extractDigits(str) {
    return (str || '').replace(/[^\d]/g, '');
  }

  // OCRが「保険者番号」を誤認識するパターンに対応
  function isInsurerNumberLabel(str) {
    // 保険者番号、保険者番呈、保険者番号 etc
    return /保険者\s*番[号呈暑署]/.test(str) || /保険者\s*番\s*[号呈暑署]/.test(str);
  }

  // 「生年月日」ラベル近傍から年号を柔軟に読む
  // OCRが「平成」を「ギ成」「平或」等に誤認識するケースに対応
  function fuzzyEraMatch(str) {
    // 正確なマッチ
    const exact = str.match(/(昭和|平成|令和)\s*(\d{1,2})/);
    if (exact) return { era: exact[1], year: parseInt(exact[2]), index: exact.index };

    // 平成の誤認識パターン（ギ成、干成、ギ4、半成 etc）
    // 「生年月日」の後に 数字 数字 月 数字 のパターンを見つける
    const fuzzyHeisei = str.match(/[ギ干半平ギヤ][成或]\s*(\d{1,2})/);
    if (fuzzyHeisei) return { era: '平成', year: parseInt(fuzzyHeisei[1]), index: fuzzyHeisei.index };

    // 昭和の誤認識
    const fuzzyShowa = str.match(/[昭照]\s*[和知]\s*(\d{1,2})/);
    if (fuzzyShowa) return { era: '昭和', year: parseInt(fuzzyShowa[1]), index: fuzzyShowa.index };

    // 令和の誤認識
    const fuzzyReiwa = str.match(/[令今冷]\s*[和知]\s*(\d{1,2})/);
    if (fuzzyReiwa) return { era: '令和', year: parseInt(fuzzyReiwa[1]), index: fuzzyReiwa.index };

    return null;
  }

  function extractInsuranceFields(ocrText) {
    const text = normalizeOcrText(ocrText);
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const fullText = lines.join(' ');

    const result = {
      insurerNumber: null,
      symbol: null,
      memberNumber: null,
      name: null,
      nameKana: null,
      dob: null,
      sex: null,
      address: null,
      postalCode: null,
      expiry: null,
      insurerName: null,
      qualifier: null,
      rawText: text,
      confidence: 0
    };

    // --- 保険者番号（6桁 or 8桁の数字列） ---
    // まず正確なパターンで試す
    const insurerPatterns = [
      /保険者番号[:\s：]*(\d{6,8})/,
      /保険者[番号\s]*[:\s：]*(\d{6,8})/,
      /保険者番号[:\s：]*(\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d)/,
    ];
    for (const pat of insurerPatterns) {
      const m = fullText.match(pat);
      if (m) {
        result.insurerNumber = m[1].replace(/\s/g, '');
        if (result.insurerNumber.length >= 6) break;
      }
    }
    // フォールバック1: ラベル誤認識対応（番呈、番署 等）+ 数字だけ抽出
    if (!result.insurerNumber) {
      for (const line of lines) {
        if (isInsurerNumberLabel(line) || /保険者番号/.test(line) || /保険者\s*番\s*号/.test(line)) {
          const digits = extractDigits(line);
          if (digits.length >= 6) {
            result.insurerNumber = digits.substring(0, 8);
            break;
          }
        }
      }
    }
    // フォールバック2: 「保険者番」の後ろの文字列から数字を拾う（OCR記号混入対応）
    if (!result.insurerNumber) {
      const m = fullText.match(/保険者\s*番[^\n]{0,5}([\d\s\.\[\]lIO,]{6,20})/);
      if (m) {
        // lを1に、Oを0に置換してから数字抽出
        const cleaned = m[1].replace(/[lI|]/g, '1').replace(/[Oo]/g, '0');
        const digits = extractDigits(cleaned);
        if (digits.length >= 6) {
          result.insurerNumber = digits.substring(0, 8);
        }
      }
    }

    // チェックディジットで保険者番号を検証・修正
    if (result.insurerNumber && result.insurerNumber.length === 8) {
      const check = validateInsurerNumber(result.insurerNumber);
      if (!check.valid) {
        result.insurerNumber = check.corrected;
        result._insurerNumberCorrected = true;
      }
    }

    // --- 記号・番号 ---
    const symbolPatterns = [
      /記号[:\s：]*([^\s番]{1,20})/,
      /記号\s+(\S+)/,
      // OCR誤認識: 「記」の後にゴミ文字 + 数字列
      /記[ーー号\s]*(\d{4,10})/,
    ];
    for (const pat of symbolPatterns) {
      const m = fullText.match(pat);
      if (m) {
        const val = m[1].replace(/[番号ーー\s]/g, '').trim();
        // 数字のみの値で、保険者番号と異なる場合に採用
        if (/^\d+$/.test(val) && val !== result.insurerNumber) {
          result.symbol = val;
          break;
        } else if (val.length >= 2 && !/^\d+$/.test(val)) {
          result.symbol = val;
          break;
        }
      }
    }

    const numPatterns = [
      /記号[^\n]*?番号[:\s：]*(\d{1,10})/,
      /被保険者番号[:\s：]*(\d{1,10})/,
      /(?<!保険者)番号[:\s：]*(\d{1,10})/,
      /番\s*号\s+(\d+)/,
      // 記号の数字列の後に続く別の数字列（「8010441 和30」→ 30が番号）
      // 「和」「番」は OCRで「番号」の誤認識
    ];
    for (const pat of numPatterns) {
      const m = fullText.match(pat);
      if (m && m[1] !== result.insurerNumber && m[1] !== result.symbol) {
        result.memberNumber = m[1];
        break;
      }
    }
    // フォールバック: 記号の直後に「和 NN」や「番号 NN」のパターン
    if (!result.memberNumber && result.symbol) {
      const afterSymbol = fullText.substring(fullText.indexOf(result.symbol) + result.symbol.length);
      const numAfter = afterSymbol.match(/[和番号\s]+(\d{1,5})/);
      if (numAfter) {
        result.memberNumber = numAfter[1];
      }
    }

    // --- 枝番 ---
    const edaMatch = fullText.match(/枝番[:\s：）)]*(\d{1,2})/) || fullText.match(/[革草枝][番]\s*[)）]\s*(\d{1,2})/);
    if (edaMatch) result.branchNumber = edaMatch[1];

    // --- 生年月日（v4: 年号誤認識・交付日誤認識対応） ---
    // 方針: 「生年月日」ラベルの直後にある日付を最優先。交付日と区別する
    let dobFound = false;

    // ステップ1: 「生年月日」ラベル付きの行を探す
    for (const line of lines) {
      if (!/生年月日/.test(line)) continue;
      // ラベルの後ろの文字列から年号を探す
      const afterLabel = line.replace(/.*生年月日[\s：:]*/, '');

      // 正確な年号マッチ
      const exactEra = afterLabel.match(/(昭和|平成|令和)\s*(\d{1,2})\s*年?\s*(\d{1,2})\s*月\s*(\d{1,2})/);
      if (exactEra) {
        const year = eraToWestern(exactEra[1], parseInt(exactEra[2]));
        result.dob = `${year}-${String(exactEra[3]).padStart(2,'0')}-${String(exactEra[4]).padStart(2,'0')}`;
        dobFound = true;
        break;
      }

      // 誤認識年号 + 数字パターン（「ギ 4 4月 16」→ 平成4年4月16日）
      const fuzzy = fuzzyEraMatch(afterLabel);
      if (fuzzy) {
        // 年号の後ろから月日を探す
        const rest = afterLabel.substring(fuzzy.index);
        const md = rest.match(/\d{1,2}\s*[年\/\-\.]\s*(\d{1,2})\s*月?\s*(\d{1,2})/);
        if (md) {
          const year = eraToWestern(fuzzy.era, fuzzy.year);
          result.dob = `${year}-${String(md[1]).padStart(2,'0')}-${String(md[2]).padStart(2,'0')}`;
          dobFound = true;
          break;
        }
        // 「ギ4 4月16」形式: 最初の数字が年、次が月、次が日
        const nums = rest.match(/(\d{1,2})\s+(\d{1,2})\s*月\s*(\d{1,2})/);
        if (nums) {
          const year = eraToWestern(fuzzy.era, parseInt(nums[1]));
          result.dob = `${year}-${String(nums[2]).padStart(2,'0')}-${String(nums[3]).padStart(2,'0')}`;
          dobFound = true;
          break;
        }
      }

      // 数字のみ抽出してパターンマッチ（最終手段）
      const digits = afterLabel.match(/\d+/g);
      if (digits && digits.length >= 3) {
        // 生年月日行の数字列: [年号年, 月, 日] を推定
        const candidates = digits.map(d => parseInt(d));
        // 月（1-12）と日（1-31）の妥当性チェック
        for (let i = 0; i < candidates.length - 2; i++) {
          const y = candidates[i], mo = candidates[i+1], day = candidates[i+2];
          if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
            if (y >= 1 && y <= 64) {
              // 年号年として妥当（昭和1-64, 平成1-31, 令和1-xx）
              // 年号を推定: 交付日が令和なら、生年月日は平成以前が多い
              let era = '平成';
              if (y > 31) era = '昭和';
              const year = eraToWestern(era, y);
              if (year >= 1926 && year <= 2025) {
                result.dob = `${year}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                dobFound = true;
                break;
              }
            } else if (y >= 1926 && y <= 2025) {
              result.dob = `${y}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
              dobFound = true;
              break;
            }
          }
        }
        if (dobFound) break;
      }
    }

    // フォールバック: fullTextから年号付き日付を探す（交付日と区別）
    if (!dobFound) {
      const dobPatterns = [
        /生年月日[:\s：]*(昭和|平成|令和)\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
        /生年月日[:\s：]*(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/,
      ];
      for (const pat of dobPatterns) {
        const m = fullText.match(pat);
        if (m) {
          if (['昭和','平成','令和'].includes(m[1])) {
            const year = eraToWestern(m[1], parseInt(m[2]));
            result.dob = `${year}-${String(m[3]).padStart(2,'0')}-${String(m[4]).padStart(2,'0')}`;
          } else {
            const y = parseInt(m[1]);
            if (y >= 1900 && y <= 2030) {
              result.dob = `${y}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
            }
          }
          if (result.dob) break;
        }
      }
    }

    // フォールバック2: 全文から「平成/昭和 N年 N月 N日」を探す（ラベルなし対応）
    // 交付日（令和）と生年月日（平成/昭和）を区別する
    if (!dobFound) {
      const allDates = [];
      const globalEraRe = /(昭和|平成)\s*(\d{1,2})\s*年?\s*(\d{1,2})\s*月\s*(\d{1,2})/g;
      let em;
      while ((em = globalEraRe.exec(fullText)) !== null) {
        const year = eraToWestern(em[1], parseInt(em[2]));
        const mo = parseInt(em[3]);
        const day = parseInt(em[4]);
        if (year >= 1926 && year <= 2025 && mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
          allDates.push({ year, mo, day, era: em[1] });
        }
      }
      // 昭和/平成の日付が見つかれば、最も生年月日らしいもの（1926-2010年）を採用
      const dobCandidates = allDates.filter(d => d.year >= 1926 && d.year <= 2010);
      if (dobCandidates.length > 0) {
        const d = dobCandidates[0];
        result.dob = `${d.year}-${String(d.mo).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`;
      }
    }

    // --- 性別 ---
    const sexMatch = fullText.match(/性別[:\s：]*(男|女)/);
    if (sexMatch) {
      result.sex = sexMatch[1];
    } else if (/男/.test(fullText) && !/女/.test(fullText)) {
      result.sex = '男';
    } else if (/女/.test(fullText) && !/男/.test(fullText)) {
      result.sex = '女';
    }

    // --- フリガナ（v4: OCR誤認識カタカナの修正強化） ---
    // まず正確なカタカナ姓名パターン
    const kanaPattern = /([ァ-ヶー]{2,}[\s　]+[ァ-ヶー]{1,})/g;
    const kanaMatches = [];
    let km;
    while ((km = kanaPattern.exec(fullText)) !== null) {
      kanaMatches.push(km[1]);
    }
    if (kanaMatches.length > 0) {
      kanaMatches.sort((a, b) => b.length - a.length);
      result.nameKana = kanaMatches[0].replace(/[\s　]+/g, ' ').trim();
    }

    // フォールバック: カナ文字＋ひらがな混合を修正（OCRが「サ」→「が」等に誤認識）
    if (!result.nameKana || kanaQuality(result.nameKana) < 0.7) {
      for (const line of lines) {
        // カタカナを1文字でも含む行を検査
        if (!/[ァ-ヶー]/.test(line)) continue;
        // ラベル類を除去
        const cleaned = line.replace(/[#＃※◆●○◎□■△▲▽▼]/g, '')
          .replace(/記号|番号|保険|住所|生年|証|被|健康|氏名|性別|資格/g, '').trim();
        if (cleaned.length < 3) continue;

        // ひらがな→カタカナ変換
        const asKata = cleaned.replace(/[ぁ-ん]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
        // カタカナ・長音のみ抽出
        const kataOnly = asKata.replace(/[^ァ-ヶー]/g, '');
        if (kataOnly.length < 3 || kataOnly.length > 15) continue;

        // NAME_DICTで姓名分割を試みる
        const split = guessKanaSplit(kataOnly);
        if (split.includes(' ') && split.length >= 4) {
          // 現在の結果より品質が良ければ採用
          if (!result.nameKana || kanaQuality(split) > kanaQuality(result.nameKana)) {
            result.nameKana = split;
          }
        }
      }
    }

    // --- 氏名（漢字） ---
    for (const line of lines) {
      const m = line.match(/氏名[\s：:]+(.+)/);
      if (m) {
        let name = m[1].replace(/[（(].*/,'').replace(/記号|番号|保険|住所|生年|証|被|健康/g,'').trim();
        if (/^[\u4e00-\u9fff]+$/.test(name) && name.length >= 3 && typeof NAME_DICT !== 'undefined') {
          for (let len = Math.min(name.length - 1, 4); len >= 1; len--) {
            const surPart = name.substring(0, len);
            for (const kanjis of Object.values(NAME_DICT.SURNAME)) {
              if (kanjis.includes(surPart)) {
                name = surPart + ' ' + name.substring(len);
                break;
              }
            }
            if (name.includes(' ')) break;
          }
        }
        if (name.length >= 2 && name.length <= 12 && /[\u4e00-\u9fff]/.test(name)) {
          result.name = name;
          break;
        }
      }
    }
    // フォールバック: ラベルなしでも、テキスト中の姓辞書マッチで氏名を検出
    if (!result.name && typeof NAME_DICT !== 'undefined') {
      const excludeWords = /保険|協会|健康|番号|資格|取得|確認|名称|所在|全国|支部|都道府県|市区町村|交付|有効|期限|被保|條/;
      let bestNameCandidate = null;
      let bestScore = 0;

      for (const line of lines) {
        const kanjiSegs = line.match(/[\u4e00-\u9fff]{2,}/g);
        if (!kanjiSegs) continue;
        for (const seg of kanjiSegs) {
          if (excludeWords.test(seg)) continue;
          for (let sLen = Math.min(seg.length - 1, 3); sLen >= 1; sLen--) {
            const surPart = seg.substring(0, sLen);
            let surMatch = false;
            for (const kanjis of Object.values(NAME_DICT.SURNAME)) {
              if (kanjis.includes(surPart)) { surMatch = true; break; }
            }
            if (!surMatch) continue;

            // 名前候補を1〜3文字で切り出し、最もスコアの高いものを採用
            const rest = seg.substring(sLen);
            for (let gLen = Math.min(rest.length, 3); gLen >= 1; gLen--) {
              const givPart = rest.substring(0, gLen);
              const fullName = surPart + givPart;
              if (fullName.length < 2 || fullName.length > 5) continue;

              // スコア計算: 名前辞書にあれば高得点
              // 一般的な日本人名は姓1-3文字 + 名1-3文字 = 全体2-5文字
              // 名前部分が1-2文字のとき最も信頼度が高い
              let score = (gLen <= 2) ? 5 : (gLen === 3) ? 3 : 1;
              // 名前辞書チェック（MALE_GIVEN/FEMALE_GIVENのvalues内を検索）
              for (const givKanjis of Object.values(NAME_DICT.MALE_GIVEN || {})) {
                if (givKanjis.includes(givPart)) { score += 10; break; }
              }
              for (const givKanjis of Object.values(NAME_DICT.FEMALE_GIVEN || {})) {
                if (givKanjis.includes(givPart)) { score += 10; break; }
              }

              if (score > bestScore) {
                bestScore = score;
                bestNameCandidate = fullName;
              }
            }
          }
        }
      }
      if (bestNameCandidate) {
        result.name = bestNameCandidate;
      }
    }
    // フォールバック: カナ名から辞書逆引きで漢字名を推定
    if (!result.name && result.nameKana && typeof NAME_DICT !== 'undefined') {
      const parts = result.nameKana.split(/[\s　]+/);
      if (parts.length === 2) {
        const surKana = parts[0];
        const givKana = parts[1];
        const surKanjis = NAME_DICT.SURNAME[surKana];
        let givKanjis = NAME_DICT.MALE_GIVEN[givKana] || NAME_DICT.FEMALE_GIVEN[givKana];
        if (surKanjis && givKanjis) {
          // 最も一般的な漢字表記（配列の先頭）を使用
          const surKanji = Array.isArray(surKanjis) ? surKanjis[0] : surKanjis;
          const givKanji = Array.isArray(givKanjis) ? givKanjis[0] : givKanjis;
          result.name = surKanji + givKanji;
        }
      }
    }
    if (!result.name && result.nameKana) {
      for (let i = 1; i < lines.length; i++) {
        if (/[ァ-ヶー]{2,}/.test(lines[i]) && lines[i].includes(result.nameKana.replace(' ',''))) {
          const prev = lines[i-1];
          if (/[\u4e00-\u9fff]{1,}[\s　]+[\u4e00-\u9fff]{1,}/.test(prev)) {
            result.name = prev.trim();
            break;
          }
        }
      }
    }

    // --- 郵便番号 ---
    const zipMatch = fullText.match(/[〒〶]?\s*(\d{3})[ー\-ー](\d{4})/);
    if (zipMatch) {
      result.postalCode = zipMatch[1] + '-' + zipMatch[2];
    }

    // --- 住所 ---
    for (const line of lines) {
      const m = line.match(/(?:住\s*所|所在地)[:\s：]*(.*)/);
      if (m && m[1].length >= 3) {
        result.address = m[1].replace(/電話|TEL|tel|保険者|有効期限|資格|事業所/g, '').trim();
        break;
      }
    }
    if (!result.address) {
      const addrPatterns = [
        /(?:住\s*所|所在地)[:\s：]*(.+?)(?=\s*(?:電話|TEL|有効期限|保険者|資格|事業所|$))/,
        /(?:〒\s*\d{3}[\-ー]\d{4}\s*)(.+?)(?=\s*(?:電話|TEL|有効期限|保険者|資格|事業所|$))/,
      ];
      for (const pat of addrPatterns) {
        const m = fullText.match(pat);
        if (m && m[1].length >= 3) {
          result.address = m[1].replace(/電話|TEL|tel|保険者/g, '').trim();
          break;
        }
      }
    }

    // --- 有効期限 ---
    const expiryPatterns = [
      /有効期限[:\s：]*(令和|平成)\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
      /有効期限[:\s：]*(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/,
    ];
    for (const pat of expiryPatterns) {
      const m = fullText.match(pat);
      if (m) {
        if (['令和','平成'].includes(m[1])) {
          result.expiry = `${eraToWestern(m[1], parseInt(m[2]))}-${String(m[3]).padStart(2,'0')}-${String(m[4]).padStart(2,'0')}`;
        } else {
          result.expiry = `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
        }
        break;
      }
    }

    // --- 資格取得年月日 ---
    const qualPatterns = [
      /資格取得[年月日:\s：]*(令和|平成)\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    ];
    for (const pat of qualPatterns) {
      const m = fullText.match(pat);
      if (m) {
        result.qualifier = `${eraToWestern(m[1], parseInt(m[2]))}-${String(m[3]).padStart(2,'0')}-${String(m[4]).padStart(2,'0')}`;
        break;
      }
    }

    // --- 保険者名称 ---
    for (const line of lines) {
      const m = line.match(/保険者名称[:\s：]*(.*)/);
      if (m && m[1].length >= 2 && !/番号/.test(m[1])) {
        result.insurerName = m[1].trim();
        break;
      }
    }
    if (!result.insurerName) {
      const insurerNameMatch = fullText.match(/保険者名称[:\s：]*([^\n\d]{2,30})/);
      if (insurerNameMatch && !insurerNameMatch[1].match(/番号/)) {
        result.insurerName = insurerNameMatch[1].trim();
      }
    }

    // --- 信頼度スコア計算 ---
    let score = 0;
    if (result.insurerNumber) score += 25;
    if (result.dob) score += 20;
    if (result.nameKana) score += 15;
    if (result.name) score += 10;
    if (result.sex) score += 5;
    if (result.postalCode) score += 10;
    if (result.address) score += 10;
    if (result.memberNumber) score += 5;
    result.confidence = score;

    return result;
  }

  // ===== 6. 数字特化OCR（保険者番号・郵便番号向け） =====
  async function recognizeNumbers(imgSource, progressCb) {
    await init(progressCb);
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: '7',
    });
    const result = await worker.recognize(imgSource);
    await worker.setParameters({
      tessedit_char_whitelist: '',
      tessedit_pageseg_mode: '6',
    });
    return result.data.text.replace(/\s/g, '');
  }

  // ===== 7. 保険者番号チェックディジット検証・修正 =====
  // 保険者番号は8桁。末尾1桁がチェックディジット（モジュラス10）
  function validateInsurerNumber(num) {
    if (!num || num.length !== 8) return { valid: false, corrected: num };
    // 法別番号（1-2桁）+ 都道府県番号（3-4桁）+ 保険者番号（5-7桁）+ 検証番号（8桁目）
    // チェックディジット: 下1桁以外の各桁に交互に2,1を掛け、各桁の和のmod10の補数
    const digits = num.split('').map(Number);
    const weights = [2, 1, 2, 1, 2, 1, 2]; // 7桁分
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const product = digits[i] * weights[i];
      // 2桁になった場合は各桁を足す
      sum += product >= 10 ? Math.floor(product / 10) + (product % 10) : product;
    }
    const expected = (10 - (sum % 10)) % 10;
    if (digits[7] === expected) {
      return { valid: true, corrected: num };
    }
    // 修正: 正しいチェックディジットに置換
    return { valid: false, corrected: num.substring(0, 7) + String(expected) };
  }

  // ===== ユーティリティ =====
  function eraToWestern(era, year) {
    const base = { '明治': 1867, '大正': 1911, '昭和': 1925, '平成': 1988, '令和': 2018 };
    return (base[era] || 0) + year;
  }

  function extractPrefecture(address) {
    if (!address) return null;
    const prefMatch = address.match(/(北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)/);
    return prefMatch ? prefMatch[1] : null;
  }

  function splitAddress(address) {
    if (!address) return { pref: '', city: '', street: '', building: '' };
    const pref = extractPrefecture(address) || '';
    let rest = pref ? address.substring(address.indexOf(pref) + pref.length) : address;
    const cityMatch = rest.match(/^(.+?[市区町村郡])/);
    const city = cityMatch ? cityMatch[1] : '';
    rest = city ? rest.substring(rest.indexOf(city) + city.length) : rest;
    const buildingMatch = rest.match(/(\S*(?:ビル|マンション|アパート|ハイツ|コーポ|メゾン|荘|号室|棟|階).*)$/);
    const building = buildingMatch ? buildingMatch[1].trim() : '';
    const street = buildingMatch ? rest.substring(0, rest.indexOf(buildingMatch[1])).trim() : rest.trim();
    return { pref, city, street, building };
  }

  async function terminate() {
    if (worker) {
      await worker.terminate();
      worker = null;
      isInitialized = false;
      initPromise = null;
    }
  }

  // 後方互換: 旧 preprocessImage は preprocessInsuranceCard を使用
  function preprocessImage(imgElement) {
    return preprocessInsuranceCard(imgElement);
  }

  return {
    init,
    recognize,
    recognizeNumbers,
    extractInsuranceFields,
    normalizeOcrText,
    preprocessImage,
    preprocessInsuranceCard,
    preprocessSimple,
    detectCardRegion,
    splitAddress,
    extractPrefecture,
    eraToWestern,
    validateInsurerNumber,
    terminate
  };
})();
