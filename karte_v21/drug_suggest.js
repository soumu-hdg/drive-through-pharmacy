// ===== 病名→候補薬 提示モジュール (drug_suggest.js) 2026-07-03 =====
// 案2: 候補提示 ＋ 医師チェック。病名を入れると合いそうな薬の候補を提示し、
// 医師（医療補助）が選んで処方に確定する。当院の運用（病名確定→薬を用意→医師確認）を支援。
// ★暫定・医師監修前: 候補は施設の症状→薬データ(disease_drug_suggest.json)由来。必ず医師が確認・調整。
// 依存(実行時): karteData, currentPatientId, patients, showToast, renderRxList, recalcBilling, esc (app.js)

let __ddsData = null;
let __ddsLoading = false;
let __ddsCurrent = [];

async function loadDrugSuggest() {
  if (__ddsData || __ddsLoading) return __ddsData;
  __ddsLoading = true;
  try {
    __ddsData = await (await fetch('disease_drug_suggest.json')).json();
  } catch (e) {
    console.warn('disease_drug_suggest 読込失敗', e);
    __ddsData = { conditions: [], allergyRules: [] };
  } finally { __ddsLoading = false; }
  return __ddsData;
}

// 選択中の病名リストから候補薬を集約（病名がconditionのmatchキーワードを含めばヒット）
function suggestDrugsForDiseases(names) {
  if (!__ddsData || !__ddsData.conditions) return [];
  const seen = new Set(); const out = [];
  for (const dn of names) {
    if (!dn) continue;
    for (const c of __ddsData.conditions) {
      if (c.match && c.match.some(m => dn.indexOf(m) !== -1)) {
        for (const dr of c.drugs) {
          const label = dr.brand || dr.generic;
          if (!label || seen.has(label)) continue;
          seen.add(label);
          out.push({ label: label, generic: dr.generic || '', dose: dr.dose || '', freq: dr.frequency || '', days: dr.days || 7, cond: c.label });
        }
      }
    }
  }
  return out;
}

// 患者アレルギーと交差しうる候補にフラグ（アレルギー登録がある場合のみ）
function ddsAllergyFlag(drug) {
  try {
    const p = (typeof patients !== 'undefined') ? patients.find(x => x.id === currentPatientId) : null;
    const allergies = (p && p.allergies) || [];
    if (!allergies.length || !__ddsData.allergyRules) return '';
    for (const rule of __ddsData.allergyRules) {
      const avoid = (rule.avoid || []).concat(rule.crossReaction || []);
      const patHit = allergies.some(a => (rule.allergen && String(a).indexOf(rule.allergen) !== -1) || avoid.some(x => String(a).indexOf(x) !== -1));
      if (patHit && avoid.some(x => drug.label.indexOf(x) !== -1 || (drug.generic && drug.generic.indexOf(x) !== -1))) {
        return rule.message || 'アレルギー交差の可能性';
      }
    }
  } catch (e) { /* noop */ }
  return '';
}

// 候補薬パネルを #drugSuggestArea に描画
function renderDrugSuggestions() {
  const el = document.getElementById('drugSuggestArea');
  if (!el) return;
  if (typeof currentPatientId === 'undefined' || !currentPatientId || !karteData[currentPatientId]) { el.innerHTML = ''; return; }
  if (!__ddsData) { loadDrugSuggest().then(renderDrugSuggestions); el.innerHTML = ''; return; }
  const k = karteData[currentPatientId];
  const names = (k.selectedDiseases || []).map(d => d.name);
  if (!names.length) { el.innerHTML = ''; return; }
  const sugg = suggestDrugsForDiseases(names);
  __ddsCurrent = sugg;
  if (!sugg.length) { el.innerHTML = ''; return; }
  let html = '<div style="margin-top:8px;padding:8px 10px;border:1px dashed #c9821f;border-radius:6px;background:#fdf6e9;">';
  html += '<div style="font-size:11px;font-weight:700;color:#a8721a;margin-bottom:6px;">&#128138; 病名からの推奨薬（暫定・<b>医師が必ず確認</b>／タップで処方候補に追加）</div>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:5px;">';
  html += sugg.map(function (dr, i) {
    const alg = ddsAllergyFlag(dr);
    const warn = alg ? '<span style="color:#dc2626;font-weight:700;">&#9888; </span>' : '';
    const tip = esc(dr.cond + (dr.freq ? ' / ' + dr.freq : '') + (dr.days ? ' / ' + dr.days + '日' : '') + (alg ? ' / ' + alg : ''));
    return '<button type="button" title="' + tip + '" onclick="addSuggestedDrug(' + i + ')" style="font-size:11px;padding:3px 10px;border:1px solid ' + (alg ? '#dc2626' : '#d9c9a0') + ';background:#fff;border-radius:12px;cursor:pointer;">' +
      warn + '&#43; ' + esc(dr.label) + (dr.dose ? ' <span style="color:#999;">' + esc(dr.dose) + '</span>' : '') + '</button>';
  }).join('');
  html += '</div></div>';
  el.innerHTML = html;
}

// 候補を処方に追加（院内・価格0の暫定。量・日数・要否は医師が調整）
function addSuggestedDrug(i) {
  const dr = __ddsCurrent[i];
  if (!dr) return;
  const k = karteData[currentPatientId];
  if (!k) return;
  const ex = k.prescriptions.find(function (rx) { return rx.drug.name === dr.label; });
  if (ex) { ex.qty += 1; }
  else {
    k.prescriptions.push({ drug: { id: 'sg_' + Date.now() + '_' + i, name: dr.label, price: 0, unit: 'T', category: '院内(推奨)' }, qty: 1, days: dr.days || k.rxDays || 7, note: dr.freq || '' });
  }
  if (typeof showToast === 'function') showToast(dr.label + ' を処方候補に追加（医師確認）');
  if (typeof renderRxList === 'function') renderRxList();
  if (typeof recalcBilling === 'function') recalcBilling();
}
