/* =========================================================
   v0.8 screen-master.js ― マスタ整備＋薬品追加ウィザード
   穴KPI / セル直接編集→まとめて保存 / レセ電紐付け /
   対象外トグル / 逆ザヤ表示 / 3ステップ追加ウィザード
   互換規約: stock_tracking=false の薬は category も「外用/」で始める。
   逆の不一致（外用なのにtracking=true）は絶対に作らない。
   ========================================================= */
(function () {
  'use strict';
  var U = null;

  var filter = 'cost';
  var edits = {};   // code → {field: value}

  function gapOf(m) {
    return {
      rezept: !m.rezeptCode && !m.gapExempt,
      cost: m.costPerPack === null && !m.gapExempt,
      pack: !m.packSize && !m.gapExempt,
      price: !m.price && !m.gapExempt
    };
  }

  function listFor(f) {
    return P8.store.stock.filter(function (m) {
      var g = gapOf(m);
      if (f === 'cost') return g.cost;
      if (f === 'rezept') return g.rezept;
      if (f === 'pack') return g.pack;
      if (f === 'price') return g.price;
      if (f === 'anygap') return g.cost || g.rezept || g.pack || g.price;
      return true; // all
    });
  }

  function renderKpi() {
    var s = P8.store.gapStats;
    if (!s) { document.getElementById('ms-kpi').innerHTML = ''; return; }
    var pct = Math.round((s.ok_rezept + s.ok_cost + s.ok_pack + s.ok_price) / (s.total * 4) * 100);
    document.getElementById('ms-kpi').innerHTML =
      '<div class="kpi-cell"><div class="kpi-label">仕入原価 未設定</div><div class="kpi-value' + (s.total - s.ok_cost ? ' warn' : ' ok') + '">' + (s.total - s.ok_cost) + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">レセ電コード 未設定</div><div class="kpi-value' + (s.total - s.ok_rezept ? ' warn' : ' ok') + '">' + (s.total - s.ok_rezept) + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">入数 未設定</div><div class="kpi-value">' + (s.total - s.ok_pack) + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">薬価 未設定</div><div class="kpi-value">' + (s.total - s.ok_price) + '</div></div>' +
      '<div class="kpi-cell"><div class="kpi-label">マスタ充足率</div><div class="kpi-value ok">' + pct + '<small>%</small></div></div>';
  }

  function renderReverse() {
    var rev = P8.store.reverseMargins();
    document.getElementById('ms-reverse').innerHTML = rev.length
      ? '<div class="panel danger"><div class="panel-title">💸 逆ザヤ（薬価より仕入原価が高い）</div>' +
      rev.map(function (m) {
        return '<div>・<b>' + U.esc(m.name) + '</b>　原価 ¥' + m.costPerUnit.toFixed(2) + '/' + U.esc(m.unit) +
          ' ＞ 薬価 ¥' + m.price + '　<span class="muted">出すほど1' + U.esc(m.unit) + 'あたり約¥' +
          Math.abs(m.marginPerUnit).toFixed(2) + 'の持ち出し</span></div>';
      }).join('') + '<div class="muted mt8">原価か薬価の入力ミスの可能性もあります。この表で修正できます。</div></div>'
      : '';
  }

  function editedVal(m, field, fallback) {
    if (edits[m.code] && edits[m.code][field] !== undefined) return edits[m.code][field];
    return fallback;
  }

  function render() {
    renderKpi();
    renderReverse();
    var list = listFor(filter);
    var sups = P8.store.suppliers;
    var thead = '<tr><th>薬品名</th><th>レセ電</th><th class="r">薬価</th><th class="r">入数/ロット</th><th class="r">仕入単価/ロット</th><th class="r">発注点</th><th>仕入先</th><th>分類</th><th></th><th></th></tr>';
    var body = list.map(function (m) {
      var g = gapOf(m);
      function inp(field, val, cls, missing, ph) {
        var v = editedVal(m, field, val);
        var edited = edits[m.code] && edits[m.code][field] !== undefined;
        return '<input class="gap-input ' + (cls || '') + (missing && !edited ? ' miss' : '') + (edited ? ' edited' : '') +
          '" data-code="' + U.esc(m.code) + '" data-f="' + field + '" value="' + U.esc(v === null || v === undefined ? '' : v) + '" placeholder="' + (ph || '未') + '">';
      }
      var rezeptCell = m.rezeptCode
        ? '<span class="num">' + U.esc(m.rezeptCode) + '</span>' +
          (m.officialName ? '<div class="muted" style="font-size:10.5px">' + U.esc(m.officialName) + '</div>' : '')
        : (m.gapExempt ? '<span class="bdg ghost">対象外</span>'
          : '<a data-act="dm" data-code="' + U.esc(m.code) + '" style="cursor:pointer">マスタから紐付け</a>');
      if (edits[m.code] && edits[m.code].rezept_code) {
        rezeptCell = '<span class="bdg amber">紐付け予定 ' + U.esc(edits[m.code].rezept_code) + '</span>';
      }
      var supSel = '<select class="gap-input' + (edits[m.code] && edits[m.code].supplier_id !== undefined ? ' edited' : '') +
        '" style="width:120px;text-align:left" data-code="' + U.esc(m.code) + '" data-f="supplier_id">' +
        '<option value="">未設定</option>' +
        sups.map(function (s) {
          var cur = editedVal(m, 'supplier_id', m.supplierId);
          return '<option value="' + s.id + '"' + (String(cur) === String(s.id) ? ' selected' : '') + '>' + U.esc(s.name) + '</option>';
        }).join('') + '</select>';
      return '<tr>' +
        '<td><b>' + U.esc(m.name) + '</b><div class="muted" style="font-size:10.5px">' + U.esc(m.code) + '</div></td>' +
        '<td>' + rezeptCell + '</td>' +
        '<td class="r">' + inp('price', m.price || '', '', g.price) + '</td>' +
        '<td class="r">' + inp('pack_size', m.packSize, '', g.pack) + '</td>' +
        '<td class="r">' + inp('cost_per_pack', m.costPerPack, '', g.cost) + '</td>' +
        '<td class="r">' + inp('threshold', m.threshold, '', false) + '</td>' +
        '<td>' + supSel + '</td>' +
        '<td><input class="gap-input' + (edits[m.code] && edits[m.code].category !== undefined ? ' edited' : '') +
        '" style="width:140px;text-align:left" data-code="' + U.esc(m.code) + '" data-f="category" value="' + U.esc(editedVal(m, 'category', m.category)) + '"></td>' +
        '<td>' + (m.gapExempt
          ? '<a data-act="unexempt" data-code="' + U.esc(m.code) + '" style="cursor:pointer;font-size:11px">対象に戻す</a>'
          : '<a data-act="exempt" data-code="' + U.esc(m.code) + '" class="muted" style="cursor:pointer;font-size:11px">対象外にする</a>') + '</td>' +
        '<td class="r"><button class="btn ghost sm" type="button" data-act="edit" data-code="' + U.esc(m.code) + '">編集</button></td>' +
        '</tr>';
    }).join('');
    document.getElementById('ms-table').innerHTML = thead +
      (body || '<tr><td colspan="10" class="muted" style="padding:14px">該当なし（この穴は埋まっています）</td></tr>');
    updateSaveBar();
  }

  function updateSaveBar() {
    var n = Object.keys(edits).length;
    document.getElementById('ms-save-bar').classList.toggle('show', n > 0);
    document.getElementById('ms-edit-count').textContent = n + '品目に変更があります';
    document.getElementById('ms-save').textContent = '変更を保存（' + n + '件）';
  }

  function setEdit(code, field, value) {
    var m = P8.store.findByCode(code);
    if (!m) return;
    edits[code] = edits[code] || {};
    var num = { price: 1, pack_size: 1, cost_per_pack: 1, threshold: 1 };
    if (num[field]) {
      var v = String(value).trim();
      if (v === '') edits[code][field] = null;
      else {
        var n = field === 'pack_size' || field === 'threshold' ? parseInt(v, 10) : parseFloat(v);
        if (isNaN(n) || n < 0) { delete edits[code][field]; return; }
        edits[code][field] = n;
      }
    } else if (field === 'supplier_id') {
      edits[code][field] = value === '' ? null : Number(value);
    } else {
      edits[code][field] = String(value).trim();
    }
    updateSaveBar();
  }

  async function saveEdits() {
    var codes = Object.keys(edits);
    if (!codes.length) return;
    // 互換規約チェック: 分類を外用/以外に変える場合、stock_tracking=false の薬なら拒否
    for (var i = 0; i < codes.length; i++) {
      var m = P8.store.findByCode(codes[i]);
      var e = edits[codes[i]];
      if (e.category !== undefined && m && m.stockUntracked && !/^外用\//.test(e.category)) {
        P8.ui.toast('「' + m.name + '」は在庫非管理のため、分類は「外用/…」のままにしてください', 'error');
        return;
      }
    }
    var btn = document.getElementById('ms-save');
    P8.ui.busy(btn, 'busy');
    var okCount = 0, ngList = [];
    for (var j = 0; j < codes.length; j++) {
      var code = codes[j];
      var patch = Object.assign({}, edits[code], { last_updated: new Date().toISOString() });
      try {
        var res = await P8.db.write('pharmacy_medicines?code=eq.' + encodeURIComponent(code), 'PATCH', patch);
        if (!res || !res.length) throw new Error('no rows');
        okCount++;
        delete edits[code];
      } catch (e2) {
        var m2 = P8.store.findByCode(code);
        ngList.push(m2 ? m2.name : code);
        console.error('master save error:', code, e2.body || e2.message);
      }
    }
    P8.ui.busy(btn, okCount && !ngList.length ? 'done' : null);
    if (ngList.length) P8.ui.toast(okCount + '件保存・' + ngList.length + '件失敗（' + ngList.join('、') + '）', 'error');
    else P8.ui.toast(okCount + '件の変更を保存しました', 'success');
    await P8.store.refresh();
    render();
    setTimeout(function () { P8.ui.busy(btn, null); }, 900);
  }

  async function setExempt(code, val) {
    var m = P8.store.findByCode(code);
    if (!m) return;
    try {
      var res = await P8.db.write('pharmacy_medicines?code=eq.' + encodeURIComponent(code), 'PATCH',
        { master_gap_exempt: val, last_updated: new Date().toISOString() });
      if (!res || !res.length) throw new Error('no rows');
      P8.ui.toast(m.name + ' を穴チェックの' + (val ? '対象外にしました' : '対象に戻しました'), 'success');
      await P8.store.refresh();
      render();
    } catch (e) {
      P8.ui.toast('更新に失敗しました', 'error');
    }
  }

  // ---- レセ電紐付けモーダル ----
  var dmTargetCode = null, dmTimer = null;
  function dmNormUnit(u) { return String(u || '').normalize('NFKC').trim(); }
  function openDm(code) {
    dmTargetCode = code;
    var m = P8.store.findByCode(code);
    document.getElementById('dm-target').textContent = '紐付け先: ' + m.name + '（単位 ' + (m.unit || '—') + '）';
    document.getElementById('dm-search').value = m.name.slice(0, 6);
    document.getElementById('dm-results').innerHTML = '';
    document.getElementById('dm-modal').classList.add('show');
    dmSearch();
  }
  function dmSearch() {
    clearTimeout(dmTimer);
    dmTimer = setTimeout(async function () {
      var q = document.getElementById('dm-search').value.trim();
      var box = document.getElementById('dm-results');
      if (q.length < 2) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="muted" style="padding:6px">検索中...</div>';
      var enc = encodeURIComponent('*' + q + '*');
      var rows = await P8.db.get('pharmacy_drug_master?select=rezept_code,name,kana,unit,price,form,generic_flag&status=eq.' +
        encodeURIComponent('有効') + '&or=(name.like.' + enc + ',kana.like.' + enc + ')&order=name&limit=20');
      if (!rows || !rows.length) { box.innerHTML = '<div class="muted" style="padding:6px">該当なし</div>'; return; }
      var m = P8.store.findByCode(dmTargetCode);
      box.innerHTML = rows.map(function (r) {
        var unitWarn = m && m.unit && r.unit && dmNormUnit(m.unit) !== dmNormUnit(r.unit)
          ? ' <span class="bdg amber">単位不一致: ' + U.esc(r.unit) + '≠' + U.esc(m.unit) + '</span>' : '';
        return '<div class="dm-hit" data-rz="' + U.esc(r.rezept_code) + '" data-price="' + U.esc(r.price || '') + '">' +
          '<b>' + U.esc(r.name) + '</b>' + unitWarn +
          '<div class="sub">レセ電 ' + U.esc(r.rezept_code) + ' ｜ 薬価 ¥' + U.esc(r.price) + '/' + U.esc(r.unit || '') +
          ' ｜ ' + U.esc(r.form || '') + (r.generic_flag === '1' ? ' ｜ 後発' : '') + '</div></div>';
      }).join('');
    }, 300);
  }

  // ---- 追加ウィザード ----
  var wz = { step: 1, picked: null, manual: false, tracking: true, catForced: false };
  function wzReset() {
    wz = { step: 1, picked: null, manual: false, tracking: true, catForced: false };
    document.getElementById('wz-search').value = '';
    document.getElementById('wz-results').innerHTML = '';
    ['wz-name', 'wz-furigana', 'wz-unit', 'wz-category-custom', 'wz-packsize', 'wz-costpack', 'wz-price'].forEach(function (id) {
      document.getElementById(id).value = '';
    });
    document.getElementById('wz-threshold').value = '10';
    document.getElementById('wz-initial').value = '0';
    document.getElementById('wz-exempt').checked = false;
    document.getElementById('wz-supplier').value = '';
    setTracking(true);
    wzGoto(1);
  }
  function setTracking(on) {
    wz.tracking = on;
    var sw = document.getElementById('wz-tracking');
    sw.classList.toggle('on', on);
    document.getElementById('wz-toggle-box').classList.toggle('off', !on);
    applyCatRule();
  }
  function currentCategory() {
    var custom = document.getElementById('wz-category-custom').value.trim();
    return custom || document.getElementById('wz-category').value;
  }
  // 互換規約: OFFなら分類を「外用/」で強制前置
  function applyCatRule() {
    var note = document.getElementById('wz-cat-forced');
    var cat = currentCategory();
    if (!wz.tracking) {
      if (cat && !/^外用\//.test(cat)) {
        document.getElementById('wz-category-custom').value = '外用/' + cat.replace(/^(成人|小児|検査)\//, '');
        note.textContent = '在庫を減らさない薬のため、分類を「外用/」始まりに自動変更しました（v0.7互換のため必須）。';
        note.hidden = false;
      } else if (cat) { note.hidden = true; }
    } else {
      note.hidden = true;
    }
  }
  function wzGoto(step) {
    wz.step = step;
    [1, 2, 3].forEach(function (i) {
      document.getElementById('wz-tab' + i).className = i === step ? 'on' : (i < step ? 'done' : '');
      document.getElementById('wz-p' + i).classList.toggle('on', i === step);
    });
    document.getElementById('wz-back').hidden = step === 1;
    document.getElementById('wz-next').hidden = step === 3;
    document.getElementById('wz-register').hidden = step !== 3;
    document.getElementById('wz-next').disabled = (step === 1 && !wz.picked && !wz.manual);
  }
  function wzFillCategories(guess) {
    var sel = document.getElementById('wz-category');
    var cats = P8.store.categories();
    sel.innerHTML = '<option value="">選択してください</option>' + cats.map(function (c) {
      return '<option value="' + U.esc(c) + '"' + (c === guess ? ' selected' : '') + '>' + U.esc(c) + '</option>';
    }).join('');
    if (guess && cats.indexOf(guess) < 0) document.getElementById('wz-category-custom').value = guess;
  }
  function wzFillSuppliers() {
    var sel = document.getElementById('wz-supplier');
    sel.innerHTML = '<option value="">未設定</option>' + P8.store.suppliers.map(function (s) {
      return '<option value="' + s.id + '">' + U.esc(s.name) + '</option>';
    }).join('');
  }
  var wzTimer = null;
  function wzSearch() {
    clearTimeout(wzTimer);
    wzTimer = setTimeout(async function () {
      var q = document.getElementById('wz-search').value.trim();
      var box = document.getElementById('wz-results');
      if (q.length < 2) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="muted" style="padding:6px">検索中...</div>';
      var enc = encodeURIComponent('*' + q + '*');
      var rows = await P8.db.get('pharmacy_drug_master?select=rezept_code,name,kana,unit,price,form,generic_flag&status=eq.' +
        encodeURIComponent('有効') + '&or=(name.like.' + enc + ',kana.like.' + enc + ')&order=name&limit=20');
      if (!rows || !rows.length) { box.innerHTML = '<div class="muted" style="padding:6px">該当なし。院内独自品は「手入力で登録」へ</div>'; return; }
      box.innerHTML = rows.map(function (r, i) {
        return '<div class="dm-hit" data-i="' + i + '"><b>' + U.esc(r.name) + '</b>' +
          '<div class="sub">レセ電 ' + U.esc(r.rezept_code) + ' ｜ 薬価 ¥' + U.esc(r.price) + '/' + U.esc(r.unit || '') +
          ' ｜ ' + U.esc(r.form || '') + (r.generic_flag === '1' ? ' ｜ 後発' : '') + '</div></div>';
      }).join('');
      box._rows = rows;
    }, 300);
  }
  function wzPick(r) {
    wz.picked = r;
    wz.manual = false;
    document.getElementById('wz-name').value = r.name || '';
    document.getElementById('wz-furigana').value = r.kana || '';
    document.getElementById('wz-unit').value = r.unit || '';
    document.getElementById('wz-price').value = r.price || '';
    var isExternal = /外用/.test(r.form || '');
    var guess = U.guessCategory(r.name, isExternal ? '外用' : '');
    wzFillCategories(guess);
    document.getElementById('wz-cat-note').hidden = false;
    setTracking(!isExternal);
    wzGoto(2);
  }
  function wzManual(presetName, presetCat) {
    wz.picked = null;
    wz.manual = true;
    document.getElementById('wz-name').value = presetName || '';
    wzFillCategories(presetCat || '');
    document.getElementById('wz-cat-note').hidden = !presetCat;
    document.getElementById('wz-exempt').checked = true; // 院内独自品は対象外を初期提案
    setTracking(true);
    wzGoto(2);
  }
  function wzValidate2() {
    var name = document.getElementById('wz-name').value.trim();
    var unit = document.getElementById('wz-unit').value.trim();
    var cat = currentCategory();
    if (!name) { P8.ui.toast('薬品名を入力してください', 'error'); return false; }
    if (!unit) { P8.ui.toast('単位を入力してください', 'error'); return false; }
    if (!cat) { P8.ui.toast('分類を選んでください（例: 成人/解熱鎮痛剤）', 'error'); return false; }
    // 互換規約: 外用分類×在庫減算ON の組合せは作らない
    if (wz.tracking && /^外用/.test(cat)) {
      P8.ui.toast('分類が「外用」の薬は在庫を減らせません。トグルをOFFにするか分類を変えてください（v0.7互換）', 'error');
      return false;
    }
    if (!wz.tracking && !/^外用\//.test(cat)) {
      applyCatRule();
      if (!/^外用\//.test(currentCategory())) {
        P8.ui.toast('在庫を減らさない薬は分類を「外用/…」にしてください', 'error');
        return false;
      }
    }
    return true;
  }
  async function wzConfirm() {
    if (!wzValidate2()) return;
    var code = null;
    try { code = await P8.db.rpc('pharmacy_next_code'); } catch (e) { code = '（登録時に採番）'; }
    wz.nextCode = (typeof code === 'string') ? code : '（登録時に採番）';
    var f = wzFields();
    document.getElementById('wz-confirm').innerHTML = [
      ['コード', wz.nextCode + '（自動採番）'],
      ['薬品名', f.name], ['ふりがな', f.furigana || '—'], ['単位', f.unit],
      ['分類', f.category],
      ['出庫で在庫を減らす', f.stock_tracking ? 'はい' : 'いいえ（記録のみ・在庫は動かない）'],
      ['レセ電コード', f.rezept_code || '—（未紐付け）'],
      ['薬価', f.price !== null ? '¥' + f.price + '/' + f.unit : '—'],
      ['入数/1ロット', f.pack_size || '—'],
      ['仕入単価/1ロット', f.cost_per_pack !== null ? U.YEN(f.cost_per_pack) : '—'],
      ['仕入先', (P8.store.suppliers.find(function (s) { return s.id === f.supplier_id; }) || {}).name || '—'],
      ['発注点', f.threshold],
      ['初期在庫', f.current_stock + '（>0なら入庫記録が残ります）'],
      ['穴チェック対象外', f.master_gap_exempt ? 'はい' : 'いいえ']
    ].map(function (kv) { return '<tr><td class="muted" style="width:160px">' + kv[0] + '</td><td>' + U.esc(kv[1]) + '</td></tr>'; }).join('');
    wzGoto(3);
  }
  function wzFields() {
    return {
      name: document.getElementById('wz-name').value.trim(),
      furigana: document.getElementById('wz-furigana').value.trim(),
      unit: document.getElementById('wz-unit').value.trim(),
      category: currentCategory(),
      price: parseFloat(document.getElementById('wz-price').value) || null,
      threshold: parseInt(document.getElementById('wz-threshold').value, 10) || 0,
      current_stock: parseInt(document.getElementById('wz-initial').value, 10) || 0,
      pack_size: parseInt(document.getElementById('wz-packsize').value, 10) || null,
      cost_per_pack: parseFloat(document.getElementById('wz-costpack').value) || null,
      supplier_id: document.getElementById('wz-supplier').value ? Number(document.getElementById('wz-supplier').value) : null,
      rezept_code: wz.picked ? wz.picked.rezept_code : null,
      stock_tracking: wz.tracking,
      master_gap_exempt: document.getElementById('wz-exempt').checked
    };
  }
  async function wzRegister() {
    var btn = document.getElementById('wz-register');
    P8.ui.busy(btn, 'busy');
    var f = wzFields();
    try {
      var code = await P8.db.rpc('pharmacy_next_code');
      var row = Object.assign({ code: code, csv_group: 'master', usage_text: '' }, f);
      var inserted = null;
      try {
        inserted = await P8.db.write('pharmacy_medicines', 'POST', row);
      } catch (e) {
        if (e.status === 409 || (e.body && e.body.indexOf('23505') >= 0)) {
          // 採番衝突 → 再採番して1回だけリトライ
          code = await P8.db.rpc('pharmacy_next_code');
          row.code = code;
          inserted = await P8.db.write('pharmacy_medicines', 'POST', row);
        } else { throw e; }
      }
      if (!inserted || !inserted.length) throw new Error('登録結果を確認できません');
      // 初期在庫>0 は入庫トランザクションとして記録（出どころを残す）
      if (f.current_stock > 0) {
        await P8.db.write('pharmacy_transactions', 'POST', {
          medicine_code: code, transaction_type: 'in', quantity: f.current_stock,
          note: '新規登録時の初期在庫', occurred_on: U.todayJst(), source: 'app'
        });
      }
      P8.ui.busy(btn, 'done');
      P8.ui.toast('「' + f.name + '」を ' + code + ' で登録しました', 'success');
      // カルテ突合の解消分を反映
      var wasMissing = P8.store.missingDrugs.length > 0;
      P8.store.missingDrugs = P8.store.missingDrugs.filter(function (d) {
        return P8.util.normalizeName(d.name) !== P8.util.normalizeName(f.name);
      });
      await P8.store.refresh();
      render();
      setTimeout(async function () {
        P8.ui.busy(btn, null);
        document.getElementById('wizard').classList.remove('show');
        if (wasMissing && P8.store.missingDrugs.length) {
          var next = P8.store.missingDrugs[0];
          var ok = await P8.ui.modal({
            title: 'カルテ未登録の薬が残っています',
            bodyHTML: '<p>残り ' + P8.store.missingDrugs.length + ' 件。次は「<b>' + U.esc(next.name) + '</b>」を登録しますか？</p>',
            okText: '続けて登録'
          });
          if (ok) openWizardForMissing(next);
        }
      }, 900);
    } catch (e) {
      console.error('wizard register error:', e.body || e.message);
      P8.ui.busy(btn, null);
      P8.ui.toast('登録に失敗しました: ' + e.message, 'error');
    }
  }
  function openWizard() {
    wzReset();
    wzFillSuppliers();
    document.getElementById('wizard').classList.add('show');
    setTimeout(function () { document.getElementById('wz-search').focus(); }, 100);
  }
  function openWizardForMissing(d) {
    wzReset();
    wzFillSuppliers();
    document.getElementById('wizard').classList.add('show');
    document.getElementById('wz-search').value = d.name;
    wzSearch();
    // 手入力ルートにも名称と推定分類を流し込んでおく
    wzManual(d.name, U.guessCategory(d.name, d.category));
    wzGoto(1);
    document.getElementById('wz-next').disabled = false;
  }

  /* =========================================================
     薬品マスタ 追加／編集フォーム
       2枚の「薬品マスタ」シートの1行目項目名を統合した35項目を、
       新規追加と既存編集で同じ1つのフォームから扱う。
     ========================================================= */

  // id → DB列 の対応。type は送信時の変換に使う
  var MF_TEXT = [
    ['mf-code', 'code'], ['mf-name', 'name'], ['mf-furigana', 'furigana'], ['mf-category', 'category'],
    ['mf-cat1', 'cat1'], ['mf-cat2', 'cat2'], ['mf-cat3', 'cat3'], ['mf-cat4', 'cat4'], ['mf-cat5', 'cat5'],
    ['mf-stockclass', 'stock_class'], ['mf-maker', 'maker'], ['mf-brand', 'brand_suffix'],
    ['mf-group', 'group_name'], ['mf-form', 'form'], ['mf-spec', 'spec'], ['mf-unit', 'unit'],
    ['mf-orderunit', 'order_unit'], ['mf-yjbase', 'yj_base_code'], ['mf-yj', 'yj_code'],
    ['mf-rezept', 'rezept_code'], ['mf-rezept2', 'rezept_code2'],
    ['mf-hot7', 'hot_code'], ['mf-hot9', 'hot9'], ['mf-hot13', 'hot13'], ['mf-usage', 'usage_text']
  ];
  var MF_INT = [['mf-packsize', 'pack_size'], ['mf-threshold', 'threshold']];
  var MF_DEC = [['mf-costpack', 'cost_per_pack'], ['mf-price', 'price'],
                ['mf-priceofficial', 'unit_price_official'], ['mf-totalg', 'total_g']];
  // 画面の値 → 事前に読み込んだマスタのプロパティ名
  var MF_PREFILL = {
    'mf-code': 'code', 'mf-name': 'name', 'mf-furigana': 'furigana', 'mf-category': 'category',
    'mf-cat1': 'cat1', 'mf-cat2': 'cat2', 'mf-cat3': 'cat3', 'mf-cat4': 'cat4', 'mf-cat5': 'cat5',
    'mf-stockclass': 'stockClass', 'mf-maker': 'maker', 'mf-brand': 'brandSuffix',
    'mf-group': 'groupName', 'mf-form': 'form', 'mf-spec': 'spec', 'mf-unit': 'unit',
    'mf-orderunit': 'orderUnit', 'mf-yjbase': 'yjBaseCode', 'mf-yj': 'yjCode',
    'mf-rezept': 'rezeptCode', 'mf-rezept2': 'rezeptCode2',
    'mf-hot7': 'hot7', 'mf-hot9': 'hot9', 'mf-hot13': 'hot13', 'mf-usage': 'usage',
    'mf-packsize': 'packSize', 'mf-threshold': 'threshold',
    'mf-costpack': 'costPerPack', 'mf-price': 'price',
    'mf-priceofficial': 'unitPriceOfficial', 'mf-totalg': 'totalG'
  };
  var MF_DATALISTS = [
    ['dl-mf-cat1', 'cat1'], ['dl-mf-cat2', 'cat2'], ['dl-mf-cat3', 'cat3'], ['dl-mf-cat4', 'cat4'],
    ['dl-mf-cat5', 'cat5'], ['dl-mf-maker', 'maker'], ['dl-mf-group', 'groupName'],
    ['dl-mf-stockclass', 'stockClass'], ['dl-mf-form', 'form'], ['dl-mf-unit', 'unit'],
    ['dl-mf-orderunit', 'orderUnit'], ['dl-mf-category', 'category']
  ];

  var mf = { code: null, tracking: true };

  function $(id) { return document.getElementById(id); }
  function mfVal(id) { return String($(id).value || '').trim(); }

  function mfFillDatalists() {
    MF_DATALISTS.forEach(function (d) {
      var el = $(d[0]);
      if (!el) return;
      el.innerHTML = P8.store.distinct(d[1]).map(function (v) {
        return '<option value="' + U.esc(v) + '">';
      }).join('');
    });
    var sel = $('mf-supplier');
    sel.innerHTML = '<option value="">未設定</option>' + P8.store.suppliers.map(function (s) {
      return '<option value="' + s.id + '">' + U.esc(s.name) + '</option>';
    }).join('');
  }

  function mfSetTracking(on) {
    mf.tracking = on;
    $('mf-tracking').classList.toggle('on', on);
    $('mf-toggle-box').classList.toggle('off', !on);
    mfApplyCatRule();
  }

  // 互換規約: 在庫を減らさない薬（stock_tracking=false）は分類も「外用/」始まりにする。
  // 逆の不一致（分類が外用なのに減算ON）は作らせない。ビューの stock_untracked と式をそろえるため。
  function mfApplyCatRule() {
    var note = $('mf-cat-forced');
    var cat = mfVal('mf-category');
    if (!mf.tracking && cat && !/^外用\//.test(cat)) {
      $('mf-category').value = '外用/' + cat.replace(/^(成人|小児|検査|兼用)\//, '');
      note.textContent = '在庫を減らさない薬のため、分類を「外用/」始まりに自動変更しました（v0.7互換のため必須）。';
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  // 原価と「総量×薬価」は保存対象ではなく、入力の妥当性をその場で確かめるための表示
  function mfRecalc() {
    var pack = parseFloat(mfVal('mf-packsize'));
    var cost = parseFloat(mfVal('mf-costpack'));
    $('mf-costunit').value = (pack > 0 && !isNaN(cost))
      ? '¥' + (cost / pack).toFixed(4) + ' / ' + (mfVal('mf-unit') || '単位') : '—';
    var g = parseFloat(mfVal('mf-totalg'));
    var up = parseFloat(mfVal('mf-priceofficial'));
    $('mf-lotvalue').value = (!isNaN(g) && !isNaN(up)) ? '¥' + (g * up).toFixed(2) : '—';
  }

  async function openForm(code) {
    U = P8.util;
    mfFillDatalists();
    var m = code ? P8.store.findByCode(code) : null;
    mf.code = m ? m.code : null;

    MF_TEXT.concat(MF_INT, MF_DEC).forEach(function (p) {
      var v = m ? m[MF_PREFILL[p[0]]] : '';
      $(p[0]).value = (v === null || v === undefined) ? '' : String(v);
    });
    $('mf-supplier').value = m && m.supplierId ? String(m.supplierId) : '';
    $('mf-exempt').checked = !!(m && m.gapExempt);
    $('mf-code').readOnly = !!m;
    $('mf-delete').hidden = !m;   // 新規登録中は削除ボタンを出さない

    if (m) {
      $('mf-title').textContent = '薬品を編集';
      $('mf-sub').textContent = m.code + '　在庫 ' + (m.stock || 0) + (m.unit || '') +
        (m.supplierName ? '　仕入先 ' + m.supplierName : '');
      $('mf-initial-wrap').hidden = true;
      // 明示値が無い薬は分類による旧ロジックの判定結果に合わせる
      mfSetTracking(m.stockTracking === null ? !m.stockUntracked : m.stockTracking);
    } else {
      $('mf-title').textContent = '薬品を追加';
      $('mf-initial-wrap').hidden = false;
      $('mf-initial').value = '0';
      $('mf-threshold').value = '10';
      $('mf-code').value = '採番中...';
      $('mf-sub').textContent = 'コードは自動採番されます。手で変えることもできます。';
      mfSetTracking(true);
      try {
        var next = await P8.db.rpc('pharmacy_next_code');
        if (typeof next === 'string') $('mf-code').value = next;
      } catch (e) { $('mf-code').value = ''; }
    }
    mfRecalc();
    $('mf-modal').classList.add('show');
    setTimeout(function () { $('mf-name').focus(); }, 80);
  }

  // 空文字は null で送る。'' のまま入れると「未設定」判定が崩れる
  function mfPayload() {
    var p = {};
    MF_TEXT.forEach(function (t) {
      if (t[1] === 'code') return;   // code は別扱い（新規のみ・編集時は不変）
      p[t[1]] = mfVal(t[0]) || null;
    });
    MF_INT.forEach(function (t) {
      var v = mfVal(t[0]);
      p[t[1]] = v === '' ? null : (isNaN(parseInt(v, 10)) ? null : parseInt(v, 10));
    });
    MF_DEC.forEach(function (t) {
      var v = mfVal(t[0]);
      p[t[1]] = v === '' ? null : (isNaN(parseFloat(v)) ? null : parseFloat(v));
    });
    p.supplier_id = $('mf-supplier').value ? Number($('mf-supplier').value) : null;
    p.stock_tracking = mf.tracking;
    p.master_gap_exempt = $('mf-exempt').checked;
    // cost_per_unit は生成列。ペイロードに入れるとエラーになるので絶対に足さない
    return p;
  }

  function mfValidate() {
    if (!mfVal('mf-name')) { P8.ui.toast('薬品名を入力してください', 'error'); return false; }
    if (!mfVal('mf-unit')) { P8.ui.toast('薬剤単位を入力してください（包 / 錠 / 本 など）', 'error'); return false; }
    if (!mf.code && !mfVal('mf-code')) { P8.ui.toast('院内管理IDを入力してください', 'error'); return false; }
    var cat = mfVal('mf-category');
    if (mf.tracking && /^外用/.test(cat)) {
      P8.ui.toast('分類が「外用」の薬は在庫を減らせません。トグルをOFFにするか分類を変えてください（v0.7互換）', 'error');
      return false;
    }
    if (!mf.tracking) {
      if (!cat) { P8.ui.toast('在庫を減らさない薬は分類を「外用/…」にしてください', 'error'); return false; }
      mfApplyCatRule();
      if (!/^外用\//.test(mfVal('mf-category'))) {
        P8.ui.toast('在庫を減らさない薬は分類を「外用/…」にしてください', 'error');
        return false;
      }
    }
    return true;
  }

  async function mfSave() {
    if (!mfValidate()) return;
    var btn = $('mf-save');
    P8.ui.busy(btn, 'busy');
    var payload = mfPayload();
    try {
      if (mf.code) {
        payload.last_updated = new Date().toISOString();
        var upd = await P8.db.write('pharmacy_medicines?code=eq.' + encodeURIComponent(mf.code), 'PATCH', payload);
        if (!upd || !upd.length) throw new Error('更新結果を確認できません');
        P8.ui.busy(btn, 'done');
        P8.ui.toast('「' + payload.name + '」を保存しました', 'success');
      } else {
        var code = mfVal('mf-code');
        var initial = parseInt(mfVal('mf-initial'), 10);
        if (isNaN(initial) || initial < 0) initial = 0;
        var row = Object.assign({ code: code, csv_group: 'master', current_stock: initial }, payload);
        var ins = null;
        try {
          ins = await P8.db.write('pharmacy_medicines', 'POST', row);
        } catch (e) {
          if (e.status === 409 || (e.body && e.body.indexOf('23505') >= 0)) {
            // 採番衝突 → 再採番して1回だけリトライ
            code = await P8.db.rpc('pharmacy_next_code');
            row.code = code;
            ins = await P8.db.write('pharmacy_medicines', 'POST', row);
          } else { throw e; }
        }
        if (!ins || !ins.length) throw new Error('登録結果を確認できません');
        if (initial > 0) {
          await P8.db.write('pharmacy_transactions', 'POST', {
            medicine_code: code, transaction_type: 'in', quantity: initial,
            note: '新規登録時の初期在庫', occurred_on: U.todayJst(), source: 'app'
          });
        }
        P8.ui.busy(btn, 'done');
        P8.ui.toast('「' + payload.name + '」を ' + code + ' で登録しました', 'success');
      }
      await P8.store.refresh();
      render();
      setTimeout(function () {
        P8.ui.busy(btn, null);
        $('mf-modal').classList.remove('show');
      }, 800);
    } catch (e) {
      console.error('master form save error:', e.body || e.message);
      P8.ui.busy(btn, null);
      P8.ui.toast('保存に失敗しました: ' + e.message, 'error');
    }
  }

  /* ---- 削除 ----------------------------------------------------------
     必ず確認ウィンドウを1枚挟む。押しただけでは絶対に消えない。
     発注・入荷・棚卸の記録がある薬品は削除しない（業務記録を壊さないため）。
     出庫入庫の記録は「一緒に消える」と確認ウィンドウに明記したうえでのみ消す。
     -------------------------------------------------------------------- */
  async function mfRelated(code) {
    var enc = encodeURIComponent(code);
    var r = await Promise.all([
      P8.db.count('pharmacy_transactions?medicine_code=eq.' + enc),
      P8.db.count('pharmacy_lots?medicine_code=eq.' + enc),
      P8.db.count('pharmacy_order_items?medicine_code=eq.' + enc),
      P8.db.count('pharmacy_stocktakes?medicine_code=eq.' + enc)
    ]);
    return { tx: r[0] || 0, lots: r[1] || 0, orders: r[2] || 0, stocktakes: r[3] || 0 };
  }

  async function mfDelete() {
    var code = mf.code;
    if (!code) return;
    var m = P8.store.findByCode(code);
    var nameHtml = '<b>' + U.esc(m ? m.name : code) + '</b>（' + U.esc(code) + '）';

    var rel;
    try { rel = await mfRelated(code); }
    catch (e) { P8.ui.toast('関連する記録を確認できませんでした。時間をおいて試してください', 'error'); return; }

    // 業務記録があるものは消さない。理由を出して終わり（削除ボタンは出さない）
    var blockers = [];
    if (rel.lots) blockers.push('入荷ロット ' + rel.lots + '件');
    if (rel.orders) blockers.push('発注明細 ' + rel.orders + '件');
    if (rel.stocktakes) blockers.push('棚卸 ' + rel.stocktakes + '件');
    if (blockers.length) {
      await P8.ui.modal({
        title: 'この薬品は削除できません',
        bodyHTML: '<p>' + nameHtml + ' には ' + U.esc(blockers.join('・')) + ' の記録があります。</p>' +
          '<p class="muted">入荷・発注・棚卸は業務の記録なので、薬品ごと消すことはできません。' +
          '使わなくなった薬は削除ではなく、在庫を0にして運用から外してください。</p>',
        okText: '閉じる', hideCancel: true, danger: true
      });
      return;
    }

    var warn = rel.tx
      ? '<p class="t-dn"><b>この薬品の入出庫記録 ' + rel.tx + '件も一緒に削除されます。</b></p>'
      : '<p class="muted">この薬品に紐づく記録はありません。</p>';
    var ok = await P8.ui.modal({
      title: '薬品を削除しますか？',
      bodyHTML: '<p>' + nameHtml + ' をマスタから削除します。</p>' +
        '<p class="muted">現在庫 ' + (m ? (m.stock || 0) + U.esc(m.unit || '') : '—') + '</p>' +
        warn + '<p class="t-dn">この操作は取り消せません。</p>',
      okText: '削除する', cancelText: 'やめる', danger: true
    });
    if (!ok) return;

    var btn = $('mf-delete');
    P8.ui.busy(btn, 'busy');
    try {
      if (rel.tx) await P8.db.del('pharmacy_transactions?medicine_code=eq.' + encodeURIComponent(code));
      var gone = await P8.db.del('pharmacy_medicines?code=eq.' + encodeURIComponent(code));
      // 空配列＝1行も消えていない。DELETEポリシーが無いと204で黙って素通りするので必ず見る
      if (!gone || !gone.length) throw new Error('削除できませんでした（DB側で許可されていません）');
      P8.ui.busy(btn, 'done');
      P8.ui.toast('「' + (m ? m.name : code) + '」を削除しました', 'success');
      await P8.store.refresh();
      render();
      setTimeout(function () {
        P8.ui.busy(btn, null);
        $('mf-modal').classList.remove('show');
      }, 800);
    } catch (e) {
      console.error('master delete error:', e.body || e.message);
      P8.ui.busy(btn, null);
      var msg = (e.body && e.body.indexOf('23503') >= 0)
        ? 'ほかの記録から参照されているため削除できません'
        : e.message;
      P8.ui.toast(msg, 'error');
    }
  }

  P8.screens = P8.screens || {};
  P8.screens.master = {
    show: function (params) {
      U = P8.util;
      if (params && params.filter) {
        filter = params.filter;
        document.querySelectorAll('#ms-chips .chip').forEach(function (c) {
          c.classList.toggle('on', c.getAttribute('data-f') === filter);
        });
      }
      if (params && params.wizard) {
        if (params.missing && P8.store.missingDrugs.length) openWizardForMissing(P8.store.missingDrugs[0]);
        else openWizard();
      }
      render();
      // 今日の状態の一覧から行を押したとき。表を描いてからフォームを開く
      if (params && params.edit) {
        if (filter !== 'all') {
          filter = 'all';
          document.querySelectorAll('#ms-chips .chip').forEach(function (c) {
            c.classList.toggle('on', c.getAttribute('data-f') === 'all');
          });
          render();
        }
        openForm(params.edit);
      }
    },
    hide: function () {},
    openWizard: openWizard,
    openForm: openForm
  };

  document.addEventListener('DOMContentLoaded', function () {
    U = P8.util;
    document.querySelectorAll('#ms-chips .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        filter = c.getAttribute('data-f');
        document.querySelectorAll('#ms-chips .chip').forEach(function (x) { x.classList.toggle('on', x === c); });
        render();
      });
    });
    var tbl = document.getElementById('ms-table');
    tbl.addEventListener('change', function (e) {
      var t = e.target.closest('[data-f]');
      if (t) setEdit(t.getAttribute('data-code'), t.getAttribute('data-f'), t.value);
    });
    tbl.addEventListener('click', function (e) {
      var a = e.target.closest('[data-act]');
      if (!a) return;
      var code = a.getAttribute('data-code');
      var act = a.getAttribute('data-act');
      if (act === 'dm') openDm(code);
      if (act === 'edit') openForm(code);
      if (act === 'exempt') setExempt(code, true);
      if (act === 'unexempt') setExempt(code, false);
    });
    document.getElementById('ms-save').addEventListener('click', saveEdits);
    document.getElementById('ms-discard').addEventListener('click', function () { edits = {}; render(); });

    // レセ電モーダル
    document.getElementById('dm-search').addEventListener('input', dmSearch);
    document.getElementById('dm-close').addEventListener('click', function () {
      document.getElementById('dm-modal').classList.remove('show');
    });
    document.getElementById('dm-modal').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('show');
    });
    document.getElementById('dm-results').addEventListener('click', function (e) {
      var hit = e.target.closest('.dm-hit');
      if (!hit || !dmTargetCode) return;
      setEdit(dmTargetCode, 'rezept_code', hit.getAttribute('data-rz'));
      var m = P8.store.findByCode(dmTargetCode);
      if (m && !m.price && hit.getAttribute('data-price')) setEdit(dmTargetCode, 'price', hit.getAttribute('data-price'));
      document.getElementById('dm-modal').classList.remove('show');
      P8.ui.toast('紐付けを設定しました。「変更を保存」で確定します', 'success');
      render();
    });

    // ウィザード
    document.getElementById('btn-wizard').addEventListener('click', openWizard);
    document.getElementById('wz-cancel').addEventListener('click', function () {
      document.getElementById('wizard').classList.remove('show');
    });
    document.getElementById('wz-search').addEventListener('input', wzSearch);
    document.getElementById('wz-results').addEventListener('click', function (e) {
      var hit = e.target.closest('.dm-hit');
      if (!hit) return;
      var rows2 = document.getElementById('wz-results')._rows || [];
      var r = rows2[parseInt(hit.getAttribute('data-i'), 10)];
      if (r) wzPick(r);
    });
    document.getElementById('wz-manual').addEventListener('click', function () { wzManual('', ''); });
    document.getElementById('wz-tracking').addEventListener('click', function () { setTracking(!wz.tracking); });
    document.getElementById('wz-category').addEventListener('change', applyCatRule);
    document.getElementById('wz-category-custom').addEventListener('change', applyCatRule);
    document.getElementById('wz-back').addEventListener('click', function () { wzGoto(wz.step - 1); });
    document.getElementById('wz-next').addEventListener('click', function () {
      if (wz.step === 1) {
        if (!wz.picked && !wz.manual) return;
        wzGoto(2);
      } else if (wz.step === 2) {
        wzConfirm();
      }
    });
    document.getElementById('wz-register').addEventListener('click', wzRegister);

    // ---- 追加／編集フォーム ----
    $('btn-detail-add').addEventListener('click', function () { openForm(null); });
    $('mf-cancel').addEventListener('click', function () { $('mf-modal').classList.remove('show'); });
    $('mf-modal').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('show');
    });
    $('mf-save').addEventListener('click', mfSave);
    $('mf-delete').addEventListener('click', mfDelete);
    $('mf-tracking').addEventListener('click', function () { mfSetTracking(!mf.tracking); });
    $('mf-category').addEventListener('change', mfApplyCatRule);
    ['mf-packsize', 'mf-costpack', 'mf-totalg', 'mf-priceofficial', 'mf-unit'].forEach(function (id) {
      $(id).addEventListener('input', mfRecalc);
    });
    // 見出しクリックで折りたたむ。項目が35個あるので初期は全部開いておく
    document.querySelectorAll('#mf-modal .mf-sec-head').forEach(function (h) {
      h.addEventListener('click', function () { h.parentNode.classList.toggle('closed'); });
    });
  });
})();
