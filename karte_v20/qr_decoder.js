// ===== QR Decoder for Insurance Cards =====
// 協会けんぽ 資格確認書/被保険者証 QRコード解析
// Format: 支部コード(2) + 記号(8) + 番号(7) + 本家区分(2) + 交付年月日(8) + 支部コード(2) + 受付年月日(2) + 業務種別(3) + 連番(6) + 予備(1) = 41桁

const QR_DECODER = (() => {

  // 協会けんぽ 都道府県コード → 保険者番号 マッピング
  // 法別番号01 + 都道府県コード + 保険者別番号001 + 検証番号
  // 公式データ出典: 厚生労働省関東信越厚生局 保険者番号一覧
  const KYOUKAI_KENPO_MAP = {
    '01':'01010016','02':'01020015','03':'01030014','04':'01040013',
    '05':'01050012','06':'01060011','07':'01070010','08':'01080019',
    '09':'01090018','10':'01100015','11':'01110014','12':'01120013',
    '13':'01130012','14':'01140011','15':'01150010','16':'01160019',
    '17':'01170018','18':'01180017','19':'01190016','20':'01200013',
    '21':'01210012','22':'01220011','23':'01230010','24':'01240019',
    '25':'01250018','26':'01260017','27':'01270016','28':'01280015',
    '29':'01290014','30':'01300011','31':'01310010','32':'01320019',
    '33':'01330018','34':'01340017','35':'01350016','36':'01360015',
    '37':'01370014','38':'01380013','39':'01390012','40':'01400019',
    '41':'01410018','42':'01420017','43':'01430016','44':'01440015',
    '45':'01450014','46':'01460013','47':'01470012'
  };

  /**
   * 画像からQRコードを検出・デコード
   * @param {HTMLImageElement|HTMLCanvasElement} imgElement
   * @returns {string|null} デコード文字列 or null
   */
  function detectQR(imgElement) {
    if (typeof jsQR === 'undefined') return null;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // 原寸サイズで処理
    let w, h;
    if (imgElement instanceof HTMLCanvasElement) {
      w = imgElement.width;
      h = imgElement.height;
    } else {
      w = imgElement.naturalWidth || imgElement.width;
      h = imgElement.naturalHeight || imgElement.height;
    }

    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(imgElement, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    let result = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (result && result.data) return result.data;

    // 失敗時: グレースケール化+コントラスト強調して再試行
    const enhanced = enhanceForQR(ctx, w, h);
    if (enhanced) {
      result = jsQR(enhanced.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (result && result.data) return result.data;
    }

    // 失敗時: 拡大して再試行
    const scale = 2;
    canvas.width = w * scale;
    canvas.height = h * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(imgElement, 0, 0, w * scale, h * scale);
    const scaledData = ctx.getImageData(0, 0, w * scale, h * scale);
    result = jsQR(scaledData.data, w * scale, h * scale, { inversionAttempts: 'attemptBoth' });
    if (result && result.data) return result.data;

    return null;
  }

  /**
   * コントラスト強調
   */
  function enhanceForQR(ctx, w, h) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
      const val = gray < 128 ? 0 : 255;
      data[i] = data[i+1] = data[i+2] = val;
    }
    return imageData;
  }

  /**
   * QRデータ文字列を協会けんぽフォーマットとしてパース
   * @param {string} qrData
   * @returns {object|null} パース結果 or null (フォーマット不一致)
   */
  function parseKyoukaiKenpo(qrData) {
    // 41桁の数字のみ
    if (!qrData || !/^\d{41}$/.test(qrData)) return null;

    const branchCode = qrData.substring(0, 2);
    const symbolRaw = qrData.substring(2, 10);
    const numberRaw = qrData.substring(10, 17);
    const dependentType = qrData.substring(17, 19);
    const issueDateRaw = qrData.substring(19, 27);
    const branchCode2 = qrData.substring(27, 29);

    // 支部コードが有効な都道府県コードか確認
    const branchNum = parseInt(branchCode, 10);
    if (branchNum < 1 || branchNum > 47) return null;

    // 2つの支部コードが一致するか確認（追加検証）
    if (branchCode !== branchCode2) return null;

    // 保険者番号を導出
    const insurerNumber = KYOUKAI_KENPO_MAP[branchCode] || null;

    // 記号: 先頭ゼロ除去
    const symbol = symbolRaw.replace(/^0+/, '') || '0';

    // 番号: 先頭ゼロ除去
    const memberNumber = String(parseInt(numberRaw, 10));

    // 枝番
    const edaban = dependentType;

    return {
      source: 'QR',
      format: 'kyoukai_kenpo',
      branchCode: branchCode,
      insurerNumber: insurerNumber,
      symbol: symbol,
      memberNumber: memberNumber,
      edaban: edaban,
      issueDateRaw: issueDateRaw,
      dependentType: dependentType === '00' ? '本人' : '被扶養者',
      raw: qrData,
      confidence: 100  // QRコードは100%信頼
    };
  }

  /**
   * dataURL画像からQRコードを検出してパース
   * @param {string} dataUrl
   * @returns {Promise<object|null>}
   */
  function decodeFromDataUrl(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const qrData = detectQR(img);
        if (!qrData) {
          resolve(null);
          return;
        }
        // 協会けんぽフォーマットでパース
        const parsed = parseKyoukaiKenpo(qrData);
        if (parsed) {
          resolve(parsed);
          return;
        }
        // 他のフォーマット（将来拡張用）
        resolve({ source: 'QR', format: 'unknown', raw: qrData, confidence: 100 });
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  return {
    detectQR,
    parseKyoukaiKenpo,
    decodeFromDataUrl,
    KYOUKAI_KENPO_MAP
  };

})();
