// ===== OCR UIモジュール（app.jsから分離 2026-07-03） =====
// 保険証OCR（新規患者/既存患者）とOCR結果描画。関数はグローバルのまま＝従来のonclick互換。
// 依存(実行時グローバル): esc, showToast, patients, karteData, currentPatientId,
//   buildInsuranceNumberStr, autoFillAddress, QR_DECODER, OCR_ENGINE 等（ユーザー操作時参照のため読込順不問）。
// 共有状態 ocrExtracted はapp.jsのaddNewPatientからも参照（グローバルレキシカルスコープ共有）。

let ocrStream = null;       // カメラストリーム
let ocrExtracted = null;    // 最新の抽出結果
function startOcrCamera() {
  const wrap = document.getElementById('ocrCameraWrap');
  const video = document.getElementById('ocrVideo');
  wrap.style.display = 'block';
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
    .then(stream => { ocrStream = stream; video.srcObject = stream; })
    .catch(e => { showToast('カメラを起動できません: ' + e.message); wrap.style.display = 'none'; });
}
function stopOcrCamera() {
  if (ocrStream) { ocrStream.getTracks().forEach(t => t.stop()); ocrStream = null; }
  const video = document.getElementById('ocrVideo');
  video.srcObject = null;
  document.getElementById('ocrCameraWrap').style.display = 'none';
}
function captureOcrPhoto() {
  const video = document.getElementById('ocrVideo');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  stopOcrCamera();
  processOcrImage(canvas.toDataURL('image/jpeg', 0.9));
}
function onOcrFileSelected(input) {
  if (!input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => processOcrImage(e.target.result);
  reader.readAsDataURL(input.files[0]);
  input.value = '';
}
function validateOcrFields(f) {
  const today = new Date();
  const warnings = [];

  // --- 生年月日: 未来日・1歳未満・120歳超は却下 ---
  if (f.dob) {
    const dobDate = new Date(f.dob);
    const ageMsec = today - dobDate;
    const ageYears = ageMsec / (365.25 * 24 * 60 * 60 * 1000);
    if (isNaN(dobDate.getTime()) || dobDate > today || ageYears < 1 || ageYears > 120) {
      warnings.push('生年月日 "' + f.dob + '" は不正（交付日の誤認識の可能性）。却下しました。');
      f.dob = null;
    }
  }

  // --- フリガナ: カタカナ文字が50%未満なら却下 ---
  if (f.nameKana) {
    const cleaned = f.nameKana.replace(/[\s　]/g, '');
    const kataCount = (cleaned.match(/[ァ-ヶ]/g) || []).length;
    if (cleaned.length === 0 || kataCount / cleaned.length < 0.5) {
      warnings.push('フリガナ "' + f.nameKana + '" はカタカナとして不正。却下しました。');
      f.nameKana = null;
    }
  }

  // --- 保険者番号: 6-8桁の数字以外は却下 ---
  if (f.insurerNumber) {
    const cleaned = f.insurerNumber.replace(/\s/g, '');
    if (!/^\d{6,8}$/.test(cleaned)) {
      warnings.push('保険者番号 "' + f.insurerNumber + '" は数字6-8桁でない。却下しました。');
      f.insurerNumber = null;
    }
  }

  // --- 記号: 空白やゴミ文字のみなら却下 ---
  if (f.symbol) {
    const cleaned = f.symbol.replace(/[ーー\-\s]/g, '');
    if (cleaned.length < 1) {
      f.symbol = null;
    }
  }

  // --- 氏名: 漢字を1文字も含まない場合は却下 ---
  if (f.name) {
    if (!/[\u4e00-\u9fff]/.test(f.name)) {
      warnings.push('氏名 "' + f.name + '" に漢字が含まれない。却下しました。');
      f.name = null;
    }
  }

  // --- 住所: 都道府県名を含まない場合はwarnフラグ ---
  if (f.address) {
    f._addressUncertain = !/[都道府県]/.test(f.address) && !/市|区|町|村/.test(f.address);
  }

  f._validationWarnings = warnings;
  return f;
}
function processOcrImage(dataUrl) {
  // プレビュー表示
  const wrap = document.getElementById('ocrPreviewWrap');
  const img = document.getElementById('ocrPreviewImg');
  const progressArea = document.getElementById('ocrProgressArea');
  const resultArea = document.getElementById('ocrResultArea');
  const applyBtn = document.getElementById('ocrApplyBtn');

  wrap.style.display = 'block';
  img.src = dataUrl;
  img.style.display = 'block';
  progressArea.style.display = 'block';
  resultArea.style.display = 'none';
  applyBtn.style.display = 'none';

  // ===== ハイブリッド方式: QRコード優先 → OCR補完 =====
  // Step 1: QRコード検出（高速・確実）
  document.getElementById('ocrProgressText').textContent = 'QRコード検出中...';
  document.getElementById('ocrProgressFill').style.width = '10%';

  const qrPromise = (typeof QR_DECODER !== 'undefined')
    ? QR_DECODER.decodeFromDataUrl(dataUrl)
    : Promise.resolve(null);

  qrPromise.then(qrResult => {
    // Step 2: OCR実行（QR有無に関わらず個人情報取得のため実行）
    document.getElementById('ocrProgressText').textContent = 'OCR実行中...';
    document.getElementById('ocrProgressFill').style.width = '20%';

    return OCR_ENGINE.recognize(dataUrl, (status, pct) => {
      document.getElementById('ocrProgressText').textContent = status;
      document.getElementById('ocrProgressFill').style.width = (20 + pct * 0.8) + '%';
    }).then(data => ({ qrResult, ocrData: data }));
  }).then(({ qrResult, ocrData }) => {
    progressArea.style.display = 'none';

    // OCRフィールド抽出
    const ocrFields = ocrData._mergedFields || OCR_ENGINE.extractInsuranceFields(ocrData.text);
    validateOcrFields(ocrFields);

    // QRデータをOCR結果にマージ（QR優先）
    const fields = mergeQrAndOcr(qrResult, ocrFields);

    ocrExtracted = fields;

    // フリガナから漢字推測
    if (fields.nameKana && typeof NAME_DICT !== 'undefined') {
      const guess = NAME_DICT.guessKanji(fields.nameKana);
      if (guess && guess.full) {
        fields.nameGuess = guess.full;
        fields.nameGuessCandidates = guess;
      }
      if (!fields.sex) {
        const parts = fields.nameKana.split(/[\s　]+/);
        if (parts.length >= 2) {
          const sexGuess = NAME_DICT.guessSex(parts[1]);
          if (sexGuess) fields.sexGuess = sexGuess;
        }
      }
    }

    renderOcrResult(fields);
  }).catch(err => {
    progressArea.style.display = 'none';
    resultArea.style.display = 'block';
    resultArea.innerHTML = '<div style="color:var(--danger);font-size:12px;">読取エラー: ' + esc(err.message) + '</div>';
  });
}
function mergeQrAndOcr(qrResult, ocrFields) {
  const fields = Object.assign({}, ocrFields);
  fields._qrResult = qrResult;

  if (!qrResult || qrResult.format === 'unknown') return fields;

  // QRから取得できるフィールドを上書き（QR=確実）
  if (qrResult.insurerNumber) {
    fields.insurerNumber = qrResult.insurerNumber;
    fields._insurerFromQR = true;
  }
  if (qrResult.symbol) {
    fields.symbol = qrResult.symbol;
    fields._symbolFromQR = true;
  }
  if (qrResult.memberNumber) {
    fields.memberNumber = qrResult.memberNumber;
    fields._memberFromQR = true;
  }
  if (qrResult.edaban) {
    fields.edaban = qrResult.edaban;
    fields._edabanFromQR = true;
  }

  // 信頼度を再計算: QRから保険番号系が取れれば大幅アップ
  if (qrResult.insurerNumber && qrResult.symbol && qrResult.memberNumber) {
    fields.confidence = Math.max(fields.confidence || 0, 80);
  }

  return fields;
}
function renderOcrResult(f) {
  const area = document.getElementById('ocrResultArea');
  area.style.display = 'block';
  document.getElementById('ocrApplyBtn').style.display = 'inline-block';

  const hasQR = f._qrResult && f._qrResult.format !== 'unknown';

  let html = '';

  // QRコード読取成功バナー
  if (hasQR) {
    html += '<div style="background:#d4edda;border:1px solid #28a745;border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:11px;color:#155724;font-weight:700;">';
    html += '&#10004; QRコード読取成功（保険番号系は確実）';
    html += '</div>';
  }

  html += '<div style="font-size:11px;font-weight:700;color:var(--primary);margin-bottom:4px;">読取結果</div>';

  // バリデーション警告を表示
  if (f._validationWarnings && f._validationWarnings.length > 0) {
    html += '<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:10px;color:#856404;">';
    html += '&#9888; ' + f._validationWarnings.join('<br>&#9888; ');
    html += '</div>';
  }

  // QR由来 = ✓確認済み（緑）, OCR由来 = ⚠要確認（黄）
  const rows = [
    { label: '保険者番号', val: f.insurerNumber, qr: f._insurerFromQR },
    { label: '記号', val: f.symbol, qr: f._symbolFromQR },
    { label: '番号', val: f.memberNumber, qr: f._memberFromQR },
    { label: '枝番', val: f.edaban, qr: f._edabanFromQR },
    { label: 'フリガナ', val: f.nameKana, qr: false },
    { label: '氏名', val: f.nameGuess || f.name, qr: false },
    { label: '生年月日', val: f.dob, qr: false },
    { label: '性別', val: f.sex || f.sexGuess || null, qr: false, guess: f.sexGuess && !f.sex },
    { label: '郵便番号', val: f.postalCode, qr: false },
    { label: '住所', val: f.address, qr: false },
  ];

  for (const r of rows) {
    if (!r.val) continue;
    let iconHtml;
    let valueClass;
    if (r.qr) {
      iconHtml = ' <span style="color:#28a745;font-size:10px;font-weight:700;">&#10004; QR確認済</span>';
      valueClass = 'ocr-field-value';
    } else if (r.guess) {
      iconHtml = ' <span class="ocr-field-warn">&#9733; 推測</span>';
      valueClass = 'ocr-field-value low-conf';
    } else {
      iconHtml = r.val ? ' <span class="ocr-field-warn">&#9888; 要確認</span>' : '';
      valueClass = 'ocr-field-value low-conf';
    }
    html += '<div class="ocr-field-row"><span class="ocr-field-label">' + esc(r.label) + '</span><span class="' + valueClass + '">' + esc(r.val) + '</span>' + iconHtml + '</div>';
  }

  // 漢字候補がある場合
  if (f.nameGuessCandidates) {
    const gc = f.nameGuessCandidates;
    if (gc.surnameCandidates.length > 1 || gc.givenCandidates.length > 1) {
      html += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">漢字候補: ';
      if (gc.surnameCandidates.length > 1) html += '姓=' + gc.surnameCandidates.map(esc).join('/') + ' ';
      if (gc.givenCandidates.length > 1) html += '名=' + gc.givenCandidates.map(esc).join('/');
      html += '</div>';
    }
  }

  // 情報バナー
  if (hasQR) {
    html += '<div style="background:#e8f4fd;border-radius:4px;padding:4px 8px;margin-top:6px;font-size:10px;color:#0c5460;">';
    html += '&#9432; 保険番号系はQRコードから取得（確実）。氏名・生年月日はOCR参考値のため目視確認してください。';
    html += '</div>';
  } else {
    html += '<div style="background:#fff3cd;border-radius:4px;padding:4px 8px;margin-top:6px;font-size:10px;color:#856404;">';
    html += '&#9888; QRコードを検出できませんでした。全項目がOCR参考値です。反映後に必ず目視確認してください。';
    html += '</div>';
  }

  if (!f.insurerNumber && !f.nameKana && !f.dob && !f.symbol) {
    html += '<div style="color:var(--danger);font-size:11px;margin-top:6px;">&#9888; 保険証のテキストを十分に認識できませんでした。<br>画像が鮮明でない場合は、再度撮影してください。</div>';
  }

  area.innerHTML = html;
}
function applyOcrResults() {
  if (!ocrExtracted) return;
  const f = ocrExtracted;

  // フリガナ反映
  if (f.nameKana) {
    document.getElementById('newNameKana').value = f.nameKana;
  }

  // 漢字氏名（推測 or OCR直接）
  if (f.nameGuess) {
    document.getElementById('newName').value = f.nameGuess;
    // 候補がある場合にヒント表示
    if (f.nameGuessCandidates && (f.nameGuessCandidates.surnameCandidates.length > 1 || f.nameGuessCandidates.givenCandidates.length > 1)) {
      const hint = document.getElementById('newNameGuess');
      if (hint) {
        hint.style.display = 'inline';
        const allCombos = [];
        const sc = f.nameGuessCandidates.surnameCandidates;
        const gc = f.nameGuessCandidates.givenCandidates;
        for (const s of (sc.length ? sc : [f.nameKana.split(/[\s　]+/)[0]])) {
          for (const g of (gc.length ? gc : [f.nameKana.split(/[\s　]+/)[1] || ''])) {
            allCombos.push(s + ' ' + g);
          }
        }
        hint.textContent = '他候補: ' + allCombos.slice(1, 5).join(', ');
        hint.title = '全候補: ' + allCombos.join(', ');
      }
    }
  } else if (f.name) {
    document.getElementById('newName').value = f.name;
  }

  // 生年月日
  if (f.dob) {
    document.getElementById('newDob').value = f.dob;
  }

  // 性別
  const sex = f.sex || f.sexGuess;
  if (sex) {
    const radio = document.querySelector('input[name="newSex"][value="' + sex + '"]');
    if (radio) radio.checked = true;
  }

  // 保険者番号
  if (f.insurerNumber) {
    document.getElementById('newInsurerNumber').value = f.insurerNumber;
    onNewInsurerNumberInput(f.insurerNumber);
  }

  // QR由来のソース情報をトースト表示
  if (f._qrResult && f._qrResult.format !== 'unknown') {
    showToast('QRコードから保険番号を取得しました');
  }

  // 郵便番号→住所自動入力
  if (f.postalCode) {
    const cleaned = f.postalCode.replace(/[^0-9]/g, '');
    document.getElementById('newZip').value = f.postalCode;
    // zipcloudで住所を引く
    if (cleaned.length === 7) {
      fetch('https://zipcloud.ibsnet.co.jp/api/search?zipcode=' + cleaned)
        .then(r => r.json())
        .then(data => {
          if (data.results && data.results[0]) {
            const r = data.results[0];
            document.getElementById('newPref').value = r.address1;
            document.getElementById('newCity').value = r.address2 + r.address3;
            // OCRの住所から番地部分を抽出
            if (f.address) {
              const addrParts = OCR_ENGINE.splitAddress(f.address);
              if (addrParts.street) document.getElementById('newStreet').value = addrParts.street;
              if (addrParts.building) document.getElementById('newBuilding').value = addrParts.building;
            }
          }
        }).catch(() => {
          // zipcloud失敗時はOCRの住所をそのまま分割
          if (f.address) {
            const addrParts = OCR_ENGINE.splitAddress(f.address);
            document.getElementById('newPref').value = addrParts.pref;
            document.getElementById('newCity').value = addrParts.city;
            document.getElementById('newStreet').value = addrParts.street;
            document.getElementById('newBuilding').value = addrParts.building;
          }
        });
    }
  } else if (f.address) {
    // 郵便番号なし→OCR住所をそのまま分割
    const addrParts = OCR_ENGINE.splitAddress(f.address);
    document.getElementById('newPref').value = addrParts.pref;
    document.getElementById('newCity').value = addrParts.city;
    document.getElementById('newStreet').value = addrParts.street;
    document.getElementById('newBuilding').value = addrParts.building;
  }

  // 保険証画像をpatient dataに保存するためbase64をキャッシュ
  ocrExtracted._imageData = document.getElementById('ocrPreviewImg').src;

  showToast('読取結果を反映しました（漢字氏名・住所は要確認）');
}
function clearOcrPreview() {
  document.getElementById('ocrPreviewWrap').style.display = 'none';
  document.getElementById('ocrPreviewImg').src = '';
  document.getElementById('ocrResultArea').innerHTML = '';
  document.getElementById('ocrApplyBtn').style.display = 'none';
  ocrExtracted = null;
  const hint = document.getElementById('newNameGuess');
  if (hint) hint.style.display = 'none';
}
let insuranceOcrStream = null;
function startInsuranceOcrCamera() {
  const wrap = document.getElementById('insuranceOcrCameraWrap');
  const video = document.getElementById('insuranceOcrVideo');
  wrap.style.display = '';
  navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}).then(function(stream) {
    insuranceOcrStream = stream;
    video.srcObject = stream;
  }).catch(function(e) { showToast('カメラ起動失敗: ' + e.message); wrap.style.display = 'none'; });
}
function stopInsuranceOcrCamera() {
  if (insuranceOcrStream) { insuranceOcrStream.getTracks().forEach(t => t.stop()); insuranceOcrStream = null; }
  document.getElementById('insuranceOcrCameraWrap').style.display = 'none';
}
function captureInsuranceOcrPhoto() {
  const video = document.getElementById('insuranceOcrVideo');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  stopInsuranceOcrCamera();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  processInsuranceOcrImage(dataUrl);
}
function onInsuranceOcrFileSelected(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) { processInsuranceOcrImage(e.target.result); };
  reader.readAsDataURL(file);
  input.value = '';
}
function processInsuranceOcrImage(dataUrl) {
  document.getElementById('insuranceOcrPreviewWrap').style.display = '';
  document.getElementById('insuranceOcrPreviewImg').src = dataUrl;
  document.getElementById('insuranceOcrProgressArea').style.display = '';
  document.getElementById('insuranceOcrResultArea').style.display = 'none';
  document.getElementById('insuranceOcrApplyBtn').style.display = 'none';
  document.getElementById('insuranceOcrApplyQrOnlyBtn').style.display = 'none';

  // ===== ハイブリッド方式: QRコード優先 → OCR補完（新規登録と同じ方式） =====
  document.getElementById('insuranceOcrProgressText').textContent = 'QRコード検出中...';
  document.getElementById('insuranceOcrProgressFill').style.width = '10%';

  const qrPromise = (typeof QR_DECODER !== 'undefined')
    ? QR_DECODER.decodeFromDataUrl(dataUrl)
    : Promise.resolve(null);

  qrPromise.then(function(qrResult) {
    document.getElementById('insuranceOcrProgressText').textContent = 'OCR実行中...';
    document.getElementById('insuranceOcrProgressFill').style.width = '20%';

    // OCR_ENGINE（ocr_engine.js）がある場合はそちらを使用
    if (typeof OCR_ENGINE !== 'undefined' && OCR_ENGINE.recognize) {
      return OCR_ENGINE.recognize(dataUrl, function(status, pct) {
        document.getElementById('insuranceOcrProgressText').textContent = status;
        document.getElementById('insuranceOcrProgressFill').style.width = (20 + pct * 80) + '%';
      }).then(function(data) { return { qrResult: qrResult, ocrData: data }; });
    } else {
      // fallback: Tesseract直接
      return Tesseract.recognize(dataUrl, 'jpn', {
        logger: function(m) { if (m.progress) { document.getElementById('insuranceOcrProgressFill').style.width = (20 + m.progress * 80) + '%'; document.getElementById('insuranceOcrProgressText').textContent = Math.round(m.progress*100) + '%'; } }
      }).then(function(r) { return { qrResult: qrResult, ocrData: { text: r.data.text } }; });
    }
  }).then(function(result) {
    var qrResult = result.qrResult;
    var ocrData = result.ocrData;
    document.getElementById('insuranceOcrProgressArea').style.display = 'none';

    // OCRフィールド抽出
    var ocrFields = {};
    if (typeof OCR_ENGINE !== 'undefined' && OCR_ENGINE.extractInsuranceFields) {
      ocrFields = ocrData._mergedFields || OCR_ENGINE.extractInsuranceFields(ocrData.text);
      if (typeof validateOcrFields === 'function') validateOcrFields(ocrFields);
    } else {
      ocrFields = { rawText: ocrData.text };
    }

    // QRデータをOCR結果にマージ（QR優先）
    if (typeof mergeQrAndOcr === 'function') {
      ocrFields = mergeQrAndOcr(qrResult, ocrFields);
    } else if (qrResult && qrResult.insurerNumber) {
      ocrFields.insurerNumber = qrResult.insurerNumber;
      if (qrResult.symbol) ocrFields.symbol = qrResult.symbol;
      if (qrResult.memberNumber) ocrFields.memberNumber = qrResult.memberNumber;
      ocrFields._qrResult = qrResult;
    }

    window._insuranceOcrResult = ocrFields;

    // 結果表示
    var area = document.getElementById('insuranceOcrResultArea');
    area.style.display = '';
    area.innerHTML = renderInsuranceOcrResultHTML(ocrFields);
    document.getElementById('insuranceOcrApplyBtn').style.display = '';
    // QRのみ反映ボタンはQR検出成功時のみ表示
    var hasQR = ocrFields._qrResult && ocrFields._qrResult.format !== 'unknown';
    document.getElementById('insuranceOcrApplyQrOnlyBtn').style.display = hasQR ? '' : 'none';
  }).catch(function(e) {
    document.getElementById('insuranceOcrProgressArea').style.display = 'none';
    document.getElementById('insuranceOcrResultArea').style.display = '';
    document.getElementById('insuranceOcrResultArea').textContent = '読取エラー: ' + (e.message || '');
  });

  // 写真としても保存
  var p = patients.find(function(x) { return x.id === currentPatientId; });
  if (p) { p.insurancePhoto = dataUrl; document.getElementById('insurancePhotoPreview').src = dataUrl; document.getElementById('insurancePhotoPreview').style.display = 'block'; document.getElementById('insuranceUploadText2').style.display = 'none'; document.getElementById('insurancePhotoDeleteBtn').style.display = ''; }
}
function renderInsuranceOcrResultHTML(f) {
  var hasQR = f._qrResult && f._qrResult.format !== 'unknown';
  var h = '';
  if (hasQR) {
    h += '<div style="background:#d4edda;border:1px solid #28a745;border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:11px;color:#155724;font-weight:700;">&#10004; QRコード読取成功</div>';
  }
  if (f._validationWarnings && f._validationWarnings.length > 0) {
    h += '<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:4px 8px;margin-bottom:4px;font-size:10px;color:#856404;">&#9888; ' + f._validationWarnings.join('<br>&#9888; ') + '</div>';
  }
  var rows = [
    { l:'保険者番号', v:f.insurerNumber, qr:f._insurerFromQR },
    { l:'記号', v:f.symbol, qr:f._symbolFromQR },
    { l:'番号', v:f.memberNumber, qr:f._memberFromQR },
    { l:'枝番', v:f.edaban, qr:f._edabanFromQR },
    { l:'フリガナ', v:f.nameKana },
    { l:'氏名', v:f.name },
    { l:'生年月日', v:f.dob },
    { l:'住所', v:f.address }
  ];
  rows.forEach(function(r) {
    if (!r.v) return;
    var icon = r.qr ? ' <span style="color:#28a745;font-size:10px;">&#10004;QR</span>' : ' <span style="color:#f59e0b;font-size:10px;">&#9888;要確認</span>';
    h += '<div style="font-size:11px;display:flex;gap:4px;margin-bottom:2px;"><span style="color:var(--text-muted);min-width:70px;">' + r.l + '</span><b>' + esc(r.v) + '</b>' + icon + '</div>';
  });
  if (f.rawText && !f.insurerNumber && !f.nameKana) {
    h += '<div style="font-size:10px;white-space:pre-wrap;max-height:80px;overflow-y:auto;color:var(--text-muted);margin-top:4px;border-top:1px solid var(--border);padding-top:4px;">' + esc(f.rawText) + '</div>';
  }
  if (!hasQR) {
    h += '<div style="font-size:10px;color:#856404;margin-top:4px;">&#9888; QRコード未検出。OCR参考値のため必ず目視確認してください。</div>';
  }
  return h;
}
function applyInsuranceOcrResults(qrOnly) {
  var f = window._insuranceOcrResult;
  if (!f) return;
  if (qrOnly) {
    // QR由来フィールドのみ反映（確実なデータだけ）
    if (f._insurerFromQR && f.insurerNumber) { document.getElementById('insurerNumberInput').value = f.insurerNumber; onInsurerNumberInput(f.insurerNumber); }
    if (f._symbolFromQR && f.symbol) document.getElementById('insSymbol').value = f.symbol;
    if (f._memberFromQR && f.memberNumber) document.getElementById('insNumber').value = f.memberNumber;
    if (f._edabanFromQR && f.edaban) document.getElementById('insEdaban').value = f.edaban;
    showToast('QR読取データのみ反映しました');
  } else {
    // 全項目反映（QR+OCR）
    if (f.insurerNumber) { document.getElementById('insurerNumberInput').value = f.insurerNumber; onInsurerNumberInput(f.insurerNumber); }
    if (f.symbol) document.getElementById('insSymbol').value = f.symbol;
    if (f.memberNumber) document.getElementById('insNumber').value = f.memberNumber;
    if (f.edaban) document.getElementById('insEdaban').value = f.edaban;
    showToast('読取結果を反映しました（内容をご確認ください）');
  }
}
function clearInsuranceOcrPreview() {
  document.getElementById('insuranceOcrPreviewWrap').style.display = 'none';
  window._insuranceOcrResult = null;
}
