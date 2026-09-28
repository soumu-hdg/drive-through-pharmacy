// ===== uke_ext.js — 第2段階: UKE の差分（湯浅版 receipt_uke_builder.py の考え方を JS に写した） =====
// v22 の UKE（uke_format.js / uke_generator.js / uke_validate.js）はそのまま。ここで足すのは次の5つ。
//   1) 項目ごとの CP932 変換可否とバイト長の検証（患者氏名40・カナ80・コメント76・症状詳記2400）
//   2) CO（コメント）・SJ（症状詳記）・TO（特定器材）の本番生成
//      元データ = カルテの「レセプト摘要・症状詳記」（karteData[id].receiptNotes ＝ kartes.receipt_notes）
//   3) 書き出す前の点検（preflight）＝患者・保険・公費・傷病名・明細・コメントの整合
//   4) 出来上がりの追加点検（CP932・長さ・CO/SJ/TO の項目）
//   5) 提出用の警告ゲート（指摘があるときは提出用ファイルを作らない。点検用はいつでも作れる）
(function () {
  'use strict';

  var LIMIT = { name: 40, kana: 80, comment: 76, symptom: 2400, course: 100 };
  var SOCIAL_LAW = ['01', '02', '03', '04', '06', '07', '31', '32', '33', '34', '63', '72', '73', '74', '75'];
  var KOKUHO_LAW = ['67'];                     // 8桁の国保は国保組合（67）。市町村国保は6桁
  var ELDERLY_LAW = ['39'];
  var KNOWN_LAW = SOCIAL_LAW.concat(KOKUHO_LAW, ELDERLY_LAW);
  var PUBLIC_LAW = ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '28', '29', '30', '38',
                    '51', '52', '53', '54', '62', '66', '79', '86', '80', '81', '82', '83', '84', '85', '89'];
  var FREE_COMMENT_CODE = '810000001';

  // ---------- 文字コード ----------
  // Shift_JIS(CP932) にして戻し、同じ文字に戻るかで判定する（外字・環境依存文字は '?' や別の字になる）
  function canEncode(text) {
    text = String(text == null ? '' : text);
    if (!text) return true;
    if (typeof Encoding === 'undefined' || !Encoding.convert) return !/[\uD800-\uDFFF]/.test(text);   // 変換不能: サロゲート（𠮷 など）だけ見る
    try {
      var sjis = Encoding.convert(Encoding.stringToCode(text), { to: 'SJIS', from: 'UNICODE' });
      var back = Encoding.codeToString(Encoding.convert(sjis, { to: 'UNICODE', from: 'SJIS' }));
      return back === text;
    } catch (e) { return false; }
  }
  function byteLength(text) {
    text = String(text == null ? '' : text);
    if (typeof Encoding === 'undefined' || !Encoding.convert) { var n = 0; for (var i = 0; i < text.length; i++) n += text.charCodeAt(i) > 0x7F ? 2 : 1; return n; }
    try { return Encoding.convert(Encoding.stringToCode(text), { to: 'SJIS', from: 'UNICODE' }).length; } catch (e) { return text.length * 2; }
  }
  // maxBytes ごとに分ける（文字の途中で切らない）
  function splitBytes(text, maxBytes) {
    var chunks = [], cur = '', size = 0;
    var chars = Array.from(String(text == null ? '' : text));
    for (var i = 0; i < chars.length; i++) {
      var b = byteLength(chars[i]);
      if (cur && size + b > maxBytes) { chunks.push(cur); cur = ''; size = 0; }
      cur += chars[i]; size += b;
    }
    if (cur) chunks.push(cur);
    return chunks;
  }
  function digits(v) { return String(v == null ? '' : v).replace(/\D+/g, ''); }
  function validYmd(s) {
    if (!/^\d{8}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6);
    if (m < 1 || m > 12 || d < 1) return false;
    return d <= new Date(y, m, 0).getDate();
  }
  // 元号つき年月日（コメントの日付形式: 元号1桁＋年2桁＋月2桁＋日2桁）
  function validEraDate(v) {
    if (!/^[1-5]\d{6}$/.test(v)) return false;
    var eras = { '1': [1867, '18680125', '19120729'], '2': [1911, '19120730', '19261224'], '3': [1925, '19261225', '19890107'], '4': [1988, '19890108', '20190430'], '5': [2018, '20190501', '99991231'] };
    var e = eras[v[0]];
    var w = String(e[0] + parseInt(v.slice(1, 3), 10)) + v.slice(3);
    return validYmd(w) && w >= e[1] && w <= e[2];
  }

  // ---------- コメントの記録形式（コードの先頭2桁で決まる） ----------
  //   81=自由記載 82=定型 83=定型＋文字 84=定型＋数値 85=定型＋日付 86/88/89=定型＋文字等
  function commentMode(code) {
    return { '81': '10', '82': '20', '83': '30', '84': '40', '85': '50', '86': '30', '88': '30', '89': '30' }[String(code || '').slice(0, 2)] || '';
  }
  function commentWarnings(c) {
    var w = [];
    var code = digits(c.code), text = String(c.text || '').trim();
    if (!code) { w.push('コメントコードが空です'); return w; }
    if (code.length !== 9) w.push('コメントコードは9桁で入力してください: ' + code);
    if (code.charAt(0) !== '8') w.push('コメントコードは8から始まる9桁コードを確認してください: ' + code);
    var mode = commentMode(code);
    if (!mode) w.push('コメントコードの体系（81〜89）を確認してください: ' + code);
    if (mode === '20' && text) w.push('定型コメント ' + code + ' に任意文字列は記録できません。自由記載は ' + FREE_COMMENT_CODE + ' で入力してください');
    if (mode === '30' && !text) w.push('文字列コメント ' + code + ' の本文が未入力です');
    if (mode === '40' && !/^[+-]?[0-9]+(\.[0-9]+)?$/.test(text.normalize ? text.normalize('NFKC') : text)) w.push('数値コメント ' + code + ' の入力値を確認してください');
    if (mode === '50' && !validEraDate(text.normalize ? text.normalize('NFKC') : text)) w.push('日付コメント ' + code + ' は元号を含む有効な年月日7桁で入力してください');
    if (mode === '10') {
      if (!text) w.push('自由記載コメントの本文が未入力です');
      else {
        var full = ukeTextMode(text, true);
        if (!canEncode(full)) w.push('コメントにレセ電文字コードで扱えない文字が含まれています');
        else if (byteLength(full) > LIMIT.comment) w.push('自由記載コメントは1レコード38文字以内に分けてください（自動で分割します）');
      }
    } else if (text && !canEncode(text)) w.push('コメントにレセ電文字コードで扱えない文字が含まれています: ' + code);
    if (typeof MasterLoader !== 'undefined' && MasterLoader.getBeppyoComment) {
      var off = MasterLoader.getBeppyoComment(code);
      if (off && /\*{3,}/.test(off.d || '') && !text) w.push('コメント ' + code + ' は「' + String(off.d).replace(/\*+/g, '…') + '」の文字列が必要です');
    }
    return w;
  }

  // ---------- カルテの「レセプト摘要・症状詳記」 ----------
  function notesOf(k) {
    var n = (k && k.receiptNotes) || {};
    return { comments: Array.isArray(n.comments) ? n.comments : [], symptoms: Array.isArray(n.symptoms) ? n.symptoms : [], materials: Array.isArray(n.materials) ? n.materials : [] };
  }
  function notesEmpty(k) { var n = notesOf(k); return !n.comments.length && !n.symptoms.length && !n.materials.length; }
  // 月次で1患者にまとめるとき: 受診ごとの入力を重複なく合わせる
  function mergeNotes(kartes) {
    var out = { comments: [], symptoms: [], materials: [] }, seen = {};
    kartes.forEach(function (k) {
      var n = notesOf(k);
      n.comments.forEach(function (c) { var key = 'c|' + (c.position || 'upper') + '|' + digits(c.code) + '|' + (c.text || ''); if (!seen[key]) { seen[key] = 1; out.comments.push(c); } });
      n.symptoms.forEach(function (s) { var key = 's|' + (s.category || '01') + '|' + (s.text || ''); if (!seen[key]) { seen[key] = 1; out.symptoms.push(s); } });
      n.materials.forEach(function (m) { out.materials.push(m); });
    });
    return out;
  }

  // CO レコード（位置: upper=傷病名の後／lower=明細の後）
  //   自由記載（コード空 or 810000001）は 76バイト（全角38文字）ごとに分ける。定型は本文を空で記録。
  function commentRecords(notes, position, burden) {
    var out = [];
    (notes.comments || []).forEach(function (c) {
      var pos = c.position || 'upper';
      if (pos !== position) return;
      var code = digits(c.code) || FREE_COMMENT_CODE;
      var text = String(c.text || '').trim();
      var mode = commentMode(code);
      if (mode === '10') {
        text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (para) {
          splitBytes(ukeTextMode(para, true), LIMIT.comment).forEach(function (chunk) {
            out.push(ukeMakeRecord('CO', { 2: c.service || '01', 3: c.burden || '', 4: code, 5: chunk }));   // 段階B: 負担区分は指定があるときだけ（基準版と同じ）
          });
        });
      } else {
        out.push(ukeMakeRecord('CO', { 2: c.service || '01', 3: c.burden || '', 4: code, 5: mode === '20' ? '' : text }));
      }
    });
    return out;
  }
  // SJ レコード（症状詳記）: 2400バイトごと。区分は最初の行だけ
  function symptomRecords(notes) {
    var out = [];
    (notes.symptoms || []).forEach(function (s) {
      var text = String(s.text || '').trim(); if (!text) return;
      var cat = ukeZeroFill(digits(s.category) || '01', 2).slice(-2);
      var first = true;
      text.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (para) {
        splitBytes(para, LIMIT.symptom).forEach(function (chunk) {
          out.push(ukeMakeRecord('SJ', { 2: first ? cat : '', 3: chunk }));
          first = false;
        });
      });
    });
    return out;
  }
  // 特定器材 → 明細（TO）の元。点数が空なら「単価×数量を10で割って五捨五超入」で出す
  function materialItems(k) {
    return notesOf(k).materials.map(function (m) {
      var qty = Number(m.qty) || 0, price = Number(m.unitPrice) || 0;
      var pts = (m.points !== undefined && m.points !== null && m.points !== '') ? Number(m.points)
              : Math.max(0, (typeof goshagochoNyuu === 'function') ? goshagochoNyuu(price * qty / 10) : Math.round(price * qty / 10));
      return { cat: m.service || '40', code: digits(m.code), qty: qty, points: pts, unitCode: m.unitCode || '', unitPrice: price ? String(price) : '', name: m.name || '' };
    });
  }

  // ---------- 書き出す前の点検（1レセプト） ----------
  //   rc = { p, kartes, serviceMonth, reviewOrg, insurer, hasInsurance, pubs, syList, si:[], iy:[], to:[], comments, totalPoints }
  //   戻り値 { warnings:[提出を止める], notes:[知らせるだけ] }
  function preflightReceipt(rc) {
    var w = [], n = [];
    var p = rc.p || {};
    var push = function (m) { if (w.indexOf(m) === -1) w.push(m); };
    var note = function (m) { if (n.indexOf(m) === -1) n.push(m); };

    if (!String(p.id || '').trim()) push('患者番号が未入力です');
    var name = ukeTextMode(p.name);
    if (!name) push('患者氏名が未入力です');
    else if (!canEncode(name)) push('患者氏名にレセ電文字コードで扱えない文字が含まれています');
    else if (byteLength(name) > LIMIT.name) push('患者氏名がレセ電の40バイト上限を超えています');
    var kana = ukeKana(p.nameKana || p.kana || '');
    if (kana) {
      if (!canEncode(kana)) push('患者カナにレセ電文字コードで扱えない文字が含まれています');
      else if (!/^[ァ-ヶー]+$/.test(kana) || byteLength(kana) > LIMIT.kana) push('患者カナは空白・数字を含まない全角カタカナ40文字以内で入力してください');
    } else note('患者カナが未入力です（任意）');
    var dob = ukeDate(p.dob);
    if (!dob) push('患者生年月日が未入力です');
    else if (!validYmd(dob)) push('患者生年月日が日付として不正です');
    var sex = String(p.sex || '').replace(/性$/, '');
    if (sex !== '男' && sex !== '女') push('患者性別が未入力です');

    if (rc.totalPoints > 0 && rc.hasInsurance) {
      var ins = rc.insurer;
      if (!ins) push('保険者番号が未入力です');
      else if (ins.length !== 6 && ins.length !== 8) push('保険者番号は6桁または8桁で入力してください');
      else if (ins.length === 8) {
        var law = ins.slice(0, 2);
        if (KNOWN_LAW.indexOf(law) === -1) push('保険者番号の法別番号がマスター未確認です: ' + law);
        if (rc.reviewOrg === '1' && SOCIAL_LAW.indexOf(law) === -1) push('社保請求ですが保険者番号の法別番号が社保系ではありません: ' + law);
        if (rc.reviewOrg === '2' && KOKUHO_LAW.concat(ELDERLY_LAW).indexOf(law) === -1) push('国保請求ですが保険者番号の法別番号が国保・後期系ではありません: ' + law);
        if (/後期/.test(String(p.insurance || '')) && ELDERLY_LAW.indexOf(law) === -1) push('後期高齢者医療ですが保険者番号の法別番号が39ではありません: ' + law);
      }
      var eda = digits(p.insEdaban);
      if (eda && eda.length !== 2) push('保険証の枝番は2桁で入力してください');
      if (!String(p.insSymbol || '').trim() && !String(p.insNumber || '').trim() && !String(p.insuranceNumber || '').trim()) push('保険証の記号・番号が未入力です');
      if (p.ratio === undefined || p.ratio === null || p.ratio === '' || isNaN(Number(p.ratio))) push('負担割合が未入力です');
    }
    (rc.pubs || []).forEach(function (pub) {
      var payer = digits(pub.payer), rcp = digits(pub.recipient);
      if (!payer) push('公費負担者番号が未入力です');
      else if (payer.length !== 8) push('公費負担者番号は8桁で入力してください');
      else if (PUBLIC_LAW.indexOf(payer.slice(0, 2)) === -1) push('公費の法別番号がマスター未確認です: ' + payer.slice(0, 2));
      if (!rcp) push('公費受給者番号が未入力です');
      else if (rcp.length !== 7) push('公費受給者番号は7桁で入力してください');
    });

    var sy = rc.syList || [];
    if (rc.totalPoints > 0) {
      if (!sy.length) push('傷病名が未登録です');
      else if (!sy.some(function (s) { return s.explicitMain; })) note('主病名が未設定のため先頭の傷病名を主病名として記録します');
    }
    sy.forEach(function (s) {
      var label = s.name || s.code;
      if (s.code === '0000999') { note('未コード化傷病名として記録します: ' + label); if (!s.name) push('未コード化傷病名の名称が未入力です'); }
      else if (!/^\d{7}$/.test(s.code)) push('傷病名コードは7桁で入力してください: ' + label);
      if (!s.start) push('傷病名開始日が未入力です: ' + label);
      else if (!validYmd(s.start)) push('傷病名開始日が日付として不正です: ' + label);
      if (s.name && !canEncode(s.name)) push('傷病名にレセ電文字コードで扱えない文字が含まれています: ' + label);
    });

    var details = (rc.si || []).length + (rc.iy || []).length + (rc.to || []).length;
    if (rc.totalPoints > 0 && !details) push('算定明細がありません');
    (rc.si || []).forEach(function (s) { if (!/^\d{9}$/.test(String(s.code))) push('診療行為コードは9桁で入力してください: ' + s.code); });
    (rc.iy || []).forEach(function (x) {
      if (!/^\d{9}$/.test(String(x.code))) push('医薬品コード（レセ電9桁）が引けません: ' + (x.name || x.code) + '（医薬品マスタに登録のある名称にしてください）');
      if (!(Number(x.qty) > 0)) push('薬剤数量は0より大きい値で入力してください: ' + (x.name || x.code));
    });
    (rc.to || []).forEach(function (t) {
      if (!/^\d{9}$/.test(String(t.code))) push('特定器材コードは9桁で入力してください: ' + (t.name || t.code));
      if (!(Number(t.qty) > 0)) push('特定器材数量は0より大きい値で入力してください: ' + (t.name || t.code));
      if (!t.unitCode) push('特定器材の単位コードが未入力です: ' + (t.name || t.code));
      if (t.name && !canEncode(t.name)) push('特定器材名にレセ電文字コードで扱えない文字が含まれています: ' + t.name);
    });
    ((rc.notes && rc.notes.comments) || []).forEach(function (c) {
      commentWarnings({ code: digits(c.code) || FREE_COMMENT_CODE, text: c.text }).forEach(function (m) {
        if (/自動で分割/.test(m)) note(m); else push(m);
      });
    });
    ((rc.notes && rc.notes.symptoms) || []).forEach(function (s) {
      if (s.text && !canEncode(s.text)) push('症状詳記にレセ電文字コードで扱えない文字が含まれています');
      var cat = digits(s.category);
      if (cat && cat.length > 2) push('症状詳記の区分は2桁で入力してください');
    });
    return { warnings: w, notes: n };
  }

  // 医療機関情報（IR）の点検
  function preflightFacility(inst) {
    inst = inst || (typeof UKE_INST !== 'undefined' ? UKE_INST : {});
    var w = [];
    if (!/^\d{7}$/.test(String(inst.code || ''))) w.push('医療機関コードは7桁で登録してください');
    if (!/^\d{2}$/.test(String(inst.pref || ''))) w.push('都道府県コードは2桁で登録してください');
    var nm = ukeTextMode(inst.name, true);
    if (!nm) w.push('医療機関名が未登録です');
    else if (!canEncode(nm)) w.push('医療機関名にレセ電文字コードで扱えない文字が含まれています');
    if (!ukePhone(inst.phone)) w.push('医療機関の電話番号が未登録です');
    return w.map(function (m) { return '医療機関: ' + m; });
  }

  // ---------- 出来上がりの追加点検（uke_validate.js の後に掛ける） ----------
  function validateExt(content) {
    var w = [];
    var add = function (m) { if (w.indexOf(m) === -1) w.push(m); };
    if (!content) return w;
    if (!canEncode(content)) add('UKEにCP932で記録できない文字が含まれています');
    var rows = content.replace(/\x1A$/, '').replace(/\r\n$/, '').split('\r\n').map(function (l) { return l.split(','); });
    var patient = '', sjFirst = true;
    rows.forEach(function (row) {
      var kind = row[0];
      if (kind === 'RE') {
        patient = row[13] || row[4]; sjFirst = true;
        if (row[4] && byteLength(row[4]) > LIMIT.name) add(patient + ': UKE氏名が40バイトを超えています');
        if (row[36] && byteLength(row[36]) > LIMIT.kana) add(patient + ': UKEカタカナ氏名が80バイトを超えています');
      } else if (kind === 'KO') {
        if (row[6] && !/^[0-9]{1,8}$/.test(row[6])) add(patient + ': UKE KO公費負担金額は8桁以内の非負整数です');
      } else if (kind === 'CO') {
        commentWarnings({ code: row[3], text: row[4] }).forEach(function (m) { add(patient + ': ' + m); });
        if (row[3] === FREE_COMMENT_CODE && row[4] !== ukeTextMode(row[4], true)) add(patient + ': UKE自由記載コメントは全角で記録してください');
      } else if (kind === 'SJ') {
        if (sjFirst && !/^\d{2}$/.test(row[1] || '')) add(patient + ': UKE SJの先頭行に症状詳記区分（2桁）がありません');
        sjFirst = false;
        if (!row[2]) add(patient + ': UKE SJの本文が空です');
        else if (byteLength(row[2]) > LIMIT.symptom) add(patient + ': UKE SJは1レコード2400バイト以内に分けてください');
      } else if (kind === 'TO') {
        if (!/^\d{9}$/.test(row[3] || '')) add(patient + ': UKE TOの特定器材コードは9桁です');
        if (!(Number(row[4]) > 0)) add(patient + ': UKE TOの数量は0より大きい値です');
        if (!row[7]) add(patient + ': UKE TOの単位コードがありません');
      } else if (kind === 'SI' || kind === 'IY') {
        if (row[3] && !/^\d{9}$/.test(row[3])) add(patient + ': UKE ' + kind + 'のコードは9桁です（' + row[3] + '）');
      }
    });
    return w;
  }

  // ---------- 提出用の警告ゲート ----------
  //   warnings が1件でもあれば提出用は作らない（allow=true のときだけ責任者確認のうえ作る）
  function submissionGate(warnings, allow) {
    var n = (warnings || []).length;
    return { blocked: n > 0 && !allow, count: n };
  }

  // ---------- カルテ画面: レセプト摘要・症状詳記・特定器材の入力 ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function curKarte() { return (typeof karteData !== 'undefined' && typeof currentPatientId !== 'undefined' && currentPatientId) ? karteData[currentPatientId] : null; }
  function ensureNotes(k) { if (!k.receiptNotes) k.receiptNotes = { comments: [], symptoms: [], materials: [] }; ['comments', 'symptoms', 'materials'].forEach(function (x) { if (!Array.isArray(k.receiptNotes[x])) k.receiptNotes[x] = []; }); return k.receiptNotes; }
  function renderEditor() {
    var box = document.getElementById('receiptNotesBody'); if (!box) return;
    var k = curKarte();
    if (!k) { box.innerHTML = ''; return; }
    var n = ensureNotes(k);
    var h = '';
    h += '<div class="rn-sec"><div class="rn-head">摘要コメント（CO）<button class="rn-add" onclick="UkeNotes.add(\'comments\')">＋追加</button></div>';
    if (!n.comments.length) h += '<div class="rn-empty">なし（自由記載は 810000001。コードを空にすると自由記載）</div>';
    n.comments.forEach(function (c, i) {
      h += '<div class="rn-row">' +
        '<select onchange="UkeNotes.set(\'comments\',' + i + ',\'position\',this.value)"><option value="upper"' + (c.position !== 'lower' ? ' selected' : '') + '>上段</option><option value="lower"' + (c.position === 'lower' ? ' selected' : '') + '>下段</option></select>' +
        '<input class="rn-code" placeholder="コード9桁" maxlength="9" value="' + esc(c.code || '') + '" oninput="UkeNotes.set(\'comments\',' + i + ',\'code\',this.value)">' +
        '<input class="rn-text" placeholder="本文（自由記載は38文字ごとに自動分割）" value="' + esc(c.text || '') + '" oninput="UkeNotes.set(\'comments\',' + i + ',\'text\',this.value)">' +
        '<button class="rn-del" onclick="UkeNotes.remove(\'comments\',' + i + ')" title="削除">×</button></div>';
    });
    h += '</div>';
    h += '<div class="rn-sec"><div class="rn-head">症状詳記（SJ）<button class="rn-add" onclick="UkeNotes.add(\'symptoms\')">＋追加</button></div>';
    if (!n.symptoms.length) h += '<div class="rn-empty">なし</div>';
    n.symptoms.forEach(function (s, i) {
      h += '<div class="rn-row rn-sj">' +
        '<select onchange="UkeNotes.set(\'symptoms\',' + i + ',\'category\',this.value)">' +
        [['01', '01 症状詳記'], ['02', '02 治療内容'], ['03', '03 検査結果'], ['04', '04 経過'], ['05', '05 その他'], ['06', '06 長期・多剤'], ['07', '07 手術'], ['08', '08 高額']].map(function (o) { return '<option value="' + o[0] + '"' + ((s.category || '01') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        '<textarea rows="2" placeholder="症状詳記の本文" oninput="UkeNotes.set(\'symptoms\',' + i + ',\'text\',this.value)">' + esc(s.text || '') + '</textarea>' +
        '<button class="rn-del" onclick="UkeNotes.remove(\'symptoms\',' + i + ')" title="削除">×</button></div>';
    });
    h += '</div>';
    h += '<div class="rn-sec"><div class="rn-head">特定器材（TO）<button class="rn-add" onclick="UkeNotes.add(\'materials\')">＋追加</button></div>';
    if (!n.materials.length) h += '<div class="rn-empty">なし</div>';
    n.materials.forEach(function (m, i) {
      h += '<div class="rn-row rn-to">' +
        '<select onchange="UkeNotes.set(\'materials\',' + i + ',\'service\',this.value)">' + [['40', '40 処置'], ['50', '50 手術'], ['60', '60 検査'], ['70', '70 画像'], ['30', '30 注射'], ['80', '80 その他']].map(function (o) { return '<option value="' + o[0] + '"' + ((m.service || '40') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        '<input class="rn-code" placeholder="器材コード9桁" maxlength="9" value="' + esc(m.code || '') + '" oninput="UkeNotes.set(\'materials\',' + i + ',\'code\',this.value)">' +
        '<input class="rn-text" placeholder="品名・規格" value="' + esc(m.name || '') + '" oninput="UkeNotes.set(\'materials\',' + i + ',\'name\',this.value)">' +
        '<input class="rn-num" placeholder="数量" value="' + esc(m.qty || '') + '" oninput="UkeNotes.set(\'materials\',' + i + ',\'qty\',this.value)">' +
        '<input class="rn-unit" placeholder="単位ｺｰﾄﾞ" maxlength="3" value="' + esc(m.unitCode || '') + '" oninput="UkeNotes.set(\'materials\',' + i + ',\'unitCode\',this.value)">' +
        '<input class="rn-num" placeholder="単価(円)" value="' + esc(m.unitPrice || '') + '" oninput="UkeNotes.set(\'materials\',' + i + ',\'unitPrice\',this.value)">' +
        '<button class="rn-del" onclick="UkeNotes.remove(\'materials\',' + i + ')" title="削除">×</button></div>';
    });
    h += '</div>';
    box.innerHTML = h;
  }
  var UkeNotes = {
    render: renderEditor,
    add: function (kind) { var k = curKarte(); if (!k) return; var n = ensureNotes(k); n[kind].push(kind === 'comments' ? { code: '', text: '', position: 'upper' } : kind === 'symptoms' ? { category: '01', text: '' } : { service: '40', code: '', name: '', qty: 1, unitCode: '', unitPrice: '' }); renderEditor(); },
    remove: function (kind, i) { var k = curKarte(); if (!k) return; ensureNotes(k)[kind].splice(i, 1); renderEditor(); },
    set: function (kind, i, key, v) { var k = curKarte(); if (!k) return; var it = ensureNotes(k)[kind][i]; if (it) it[key] = v; }
  };
  function installEditor() {
    if (typeof renderAllKarte === 'function') { var orig = renderAllKarte; renderAllKarte = function () { var r = orig.apply(this, arguments); try { renderEditor(); } catch (e) { console.warn('[UKE] 摘要欄の描画に失敗:', e); } return r; }; }
    if (typeof switchPatient === 'function') { var o2 = switchPatient; switchPatient = function () { var r = o2.apply(this, arguments); try { renderEditor(); } catch (e) {} return r; }; }
    renderEditor();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installEditor); else installEditor();

  // DB へ入れる形（空なら null）
  function notesForDb(k) { return notesEmpty(k) ? null : notesOf(k); }

  // 公開
  window.UkeNotes = UkeNotes;
  window.ukeCanEncodeCp932 = canEncode;
  window.ukeCp932Length = byteLength;
  window.ukeSplitCp932 = splitBytes;
  window.ukeCommentMode = commentMode;
  window.ukeCommentWarnings = commentWarnings;
  window.ukeNotesOf = notesOf;
  window.ukeMergeNotes = mergeNotes;
  window.ukeCommentRecords = commentRecords;
  window.ukeSymptomRecords = symptomRecords;
  window.ukeMaterialItems = materialItems;
  window.ukePreflightReceipt = preflightReceipt;
  window.ukePreflightFacility = preflightFacility;
  window.ukeValidateExt = validateExt;
  window.ukeSubmissionGate = submissionGate;
  window.ukeNotesForDb = notesForDb;
  window.UKE_TEXT_LIMITS = LIMIT;
})();
