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
    var thead = '<tr><th>薬品名</th><th>レセ電</th><th class="r">薬価</th><th class="r">入数/ロット</th><th class="r">仕入単価/ロット</th><th class="r">発注点</th><th>仕入先</th><th>分類</th><th></th></tr>';
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
        '</tr>';
    }).join('');
    document.getElementById('ms-table').innerHTML = thead +
      (body || '<tr><td colspan="9" class="muted" style="padding:14px">該当なし（この穴は埋まっています）</td></tr>');
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
    },
    hide: function () {},
    openWizard: openWizard
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
  });
})();
