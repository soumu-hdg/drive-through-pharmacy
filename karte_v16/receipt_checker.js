/**
 * receipt_checker.js - レセプト算定チェッカー
 * SSK医科電子点数表(背反/包括/算定回数テーブル)を使った高度チェック
 *
 * 依存: MasterLoader (master_loader.js)
 *
 * チェック項目:
 *  1. 未解決コード (マスター未登録)
 *  2. 年齢制限 (乳幼児/小児加算)
 *  3. 同一コード重複
 *  4. 背反チェック - 同日 (テーブル1)
 *  5. 背反チェック - 同月 (テーブル2)
 *  6. 背反チェック - 同時 (テーブル3)
 *  7. 背反チェック - 週  (テーブル4)
 *  8. 包括チェック (包括テーブル)
 *  9. 算定回数超過チェック (算定回数テーブル)
 */
const ReceiptChecker = (() => {

  /**
   * マスターデータを使った追加チェックを実行
   * receipt_viewer.jsのcheckReceipt()の後に呼ばれる
   */
  function runAdvancedChecks(receipt) {
    if (!MasterLoader.isLoaded()) return;

    checkUnresolvedCodes(receipt);
    checkAgeRestrictions(receipt);
    checkDuplicateProcedures(receipt);
    checkHaihanDaily(receipt);
    checkHaihanMonthly(receipt);
    checkHaihanSimultaneous(receipt);
    checkHaihanWeekly(receipt);
    // ★v0.14 包括チェックは無効化。保有する包括マスタは「基本料＋加算のファミリー」を
    //   グループ化しており（例: 再診料＋時間外対応体制加算＋外来感染対策向上加算…）、
    //   「同一グループ＝別途算定不可」と解釈すると正当な加算を全て誤検知する（実UKEで242件全て誤検知）。
    //   正しい包括判定には「AがBを包括する」方向性を持つマスタ（記載要領/レセコン会社データ＝外部）が必要。
    //   → 誤検知でスタッフを混乱させるより、正確なデータが入るまで無効化する。checkHoukatsu()は残置。
    // checkHoukatsu(receipt);
    checkSanteiCount(receipt);
    checkByomeiRequirement(receipt);
    checkStandaloneDisease(receipt);
    checkInoutRestriction(receipt);
    checkVisitConsistency(receipt);
    checkMemoReminders(receipt);
  }

  /** 実日数整合: 初診料・再診料・外来診療料の算定回数は実日数を超えられない（1日1回まで）
   *  v0.15: 自院マスタ（診療行為名）で判定。超過は診察料の過剰算定＝査定リスク。 */
  function checkVisitConsistency(r) {
    const jitsu = r.jitsuNissu || (r.integrity && r.integrity.jitsuNissu) ||
                  (r.visitDays ? r.visitDays.length : 0);
    if (!jitsu) return;
    let shinsatsu = 0;
    for (const p of r.procedures) {
      if (p.isDrug || !p.code) continue;
      const nm = MasterLoader.getProcedureName(p.code) || p.name || '';
      if (nm === '初診料' || nm === '再診料' || nm === '外来診療料') {
        shinsatsu += (p.count || 1);
      }
    }
    if (shinsatsu > 0 && shinsatsu > jitsu) {
      r.warnings.push({
        severity: 'mid',
        message: '実日数整合: 初診・再診料の算定 ' + shinsatsu + '回が実日数 ' + jitsu + '日を超えています（診察料の過剰算定の可能性）'
      });
    }
  }

  // ============================================================
  // 基本チェック
  // ============================================================

  /** 未解決コードチェック: マスターに存在しないコードを警告 */
  function checkUnresolvedCodes(r) {
    for (const p of r.procedures) {
      if (p.isDrug) {
        if (p.code && !MasterLoader.getDrug(p.code) && !p.name) {
          r.warnings.push({
            severity: 'low',
            message: '薬品マスター未登録: ' + p.code
          });
        }
      } else {
        if (p.code && !MasterLoader.getProcedure(p.code) && !p.name) {
          r.warnings.push({
            severity: 'low',
            message: '診療行為マスター未登録: ' + p.code
          });
        }
      }
    }
  }

  /** 年齢制限チェック */
  function checkAgeRestrictions(r) {
    if (!r.dob || r.dob.length < 8) return;

    const birthYear = parseInt(r.dob.substring(0, 4));
    const birthMonth = parseInt(r.dob.substring(4, 6));
    const billingYear = parseInt(r.billingMonth.substring(0, 4));
    const billingMonthNum = parseInt(r.billingMonth.substring(4, 6));

    let age = billingYear - birthYear;
    if (billingMonthNum < birthMonth) age--;

    if (isNaN(age)) return;

    for (const p of r.procedures) {
      if (p.isDrug || !p.code) continue;
      const nm = codeName(p.code);
      // マスタの年齢制限(下限/上限・数値)を優先。上限年齢hiは「hi歳未満まで有効」
      const ageInfo = MasterLoader.getProcAge ? MasterLoader.getProcAge(p.code) : null;
      if (ageInfo) {
        if (typeof ageInfo.hi === 'number' && age >= ageInfo.hi) {
          r.warnings.push({
            severity: 'high',
            message: '年齢制限: ' + (ageInfo.name || nm) + ' は' + ageInfo.hi + '歳未満が対象（患者' + age + '歳）'
          });
        } else if (typeof ageInfo.lo === 'number' && age < ageInfo.lo) {
          r.warnings.push({
            severity: 'high',
            message: '年齢制限: ' + (ageInfo.name || nm) + ' は' + ageInfo.lo + '歳以上が対象（患者' + age + '歳）'
          });
        }
      } else {
        // マスタ未収載時は名称ベースの簡易判定（fallback）
        if (nm.includes('乳幼児') && age >= 6) {
          r.warnings.push({ severity: 'mid', message: '年齢注意: ' + nm + ' は6歳未満対象の可能性（患者' + age + '歳）' });
        } else if (nm.includes('小児') && age >= 15) {
          r.warnings.push({ severity: 'low', message: '年齢注意: ' + nm + '（患者' + age + '歳）' });
        }
      }
    }
  }

  /** 同一コード重複チェック */
  function checkDuplicateProcedures(r) {
    const codeCounts = {};
    for (const p of r.procedures) {
      if (p.isDrug) continue;
      if (!p.code) continue;
      codeCounts[p.code] = (codeCounts[p.code] || 0) + 1;
    }
    for (const [code, count] of Object.entries(codeCounts)) {
      if (count >= 3) {
        const name = MasterLoader.getProcedureName(code) || code;
        r.warnings.push({
          severity: 'low',
          message: '同一行為が' + count + '回記録: ' + name
        });
      }
    }
  }

  // ============================================================
  // 背反チェック
  // ============================================================

  /** 診療行為コード一覧を取得 (薬品除く) */
  function getProcedureCodes(r) {
    return r.procedures
      .filter(p => !p.isDrug && p.code)
      .map(p => p.code);
  }

  /** コードから名称を取得 */
  function codeName(code) {
    return MasterLoader.getProcedureName(code) || code;
  }

  /** 指定コードが算定された日リストを収集（UKE算定日情報 days を利用） */
  function daysForCode(r, code) {
    const set = new Set();
    for (const p of r.procedures) {
      if (p.code === code && Array.isArray(p.days)) {
        p.days.forEach(d => set.add(d));
      }
    }
    return set;
  }

  /** 背反テーブル1: 同日に併算定不可
   *  算定日情報(days)がある場合は「実際に同じ日に算定されたか」まで確認し、別日なら警告しない(誤検知抑制) */
  function checkHaihanDaily(r) {
    const codes = getProcedureCodes(r);
    if (codes.length < 2) return;
    const pairs = MasterLoader.findHaihanPairs('Daily', codes);
    const seen = new Set();
    for (const [c1, c2] of pairs) {
      const key = [c1, c2].sort().join('-');
      if (seen.has(key)) continue;
      // 両コードの算定日が判明していれば、共通の日がある場合のみ背反。日情報が無ければ従来通り警告
      const d1 = daysForCode(r, c1);
      const d2 = daysForCode(r, c2);
      if (d1.size && d2.size) {
        const sameDay = [...d1].some(d => d2.has(d));
        if (!sameDay) continue; // 別日算定 → 同日背反にあたらない
      }
      seen.add(key);
      r.warnings.push({
        severity: 'high',
        message: '背反(同日): ' + codeName(c1) + ' と ' + codeName(c2) + ' は同日併算定不可'
      });
    }
  }

  /** 背反テーブル2: 同月に併算定不可 */
  function checkHaihanMonthly(r) {
    const codes = getProcedureCodes(r);
    if (codes.length < 2) return;
    const pairs = MasterLoader.findHaihanPairs('Monthly', codes);
    const seen = new Set();
    for (const [c1, c2] of pairs) {
      const key = [c1, c2].sort().join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      r.warnings.push({
        severity: 'high',
        message: '背反(同月): ' + codeName(c1) + ' と ' + codeName(c2) + ' は同月併算定不可'
      });
    }
  }

  /** 背反テーブル3: 同時算定不可 */
  function checkHaihanSimultaneous(r) {
    const codes = getProcedureCodes(r);
    if (codes.length < 2) return;
    const pairs = MasterLoader.findHaihanPairs('Simultaneous', codes);
    const seen = new Set();
    for (const [c1, c2] of pairs) {
      const key = [c1, c2].sort().join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      r.warnings.push({
        severity: 'high',
        message: '背反(同時): ' + codeName(c1) + ' と ' + codeName(c2) + ' は同時算定不可'
      });
    }
  }

  /** 背反テーブル4: 1週間以内に併算定不可 */
  function checkHaihanWeekly(r) {
    const codes = getProcedureCodes(r);
    if (codes.length < 2) return;
    const pairs = MasterLoader.findHaihanPairs('Weekly', codes);
    const seen = new Set();
    for (const [c1, c2] of pairs) {
      const key = [c1, c2].sort().join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      r.warnings.push({
        severity: 'mid',
        message: '背反(週): ' + codeName(c1) + ' と ' + codeName(c2) + ' は同一週に併算定不可'
      });
    }
  }

  // ============================================================
  // 包括チェック
  // ============================================================

  /** 包括テーブル: 包括される行為が個別算定されている場合に警告 */
  function checkHoukatsu(r) {
    const codes = getProcedureCodes(r);
    if (codes.length < 2) return;

    // 各コードが属する包括グループを調べる
    const codeGroups = {};
    for (const code of codes) {
      const group = MasterLoader.findHoukatsuGroup(code);
      if (group) {
        if (!codeGroups[group]) codeGroups[group] = [];
        codeGroups[group].push(code);
      }
    }

    // 同一グループに2つ以上のコードがある場合 = 包括される可能性
    const seen = new Set();
    for (const [group, groupCodes] of Object.entries(codeGroups)) {
      if (groupCodes.length >= 2) {
        const key = group;
        if (seen.has(key)) continue;
        seen.add(key);
        const names = groupCodes.slice(0, 3).map(c => codeName(c));
        const suffix = groupCodes.length > 3 ? ' 他' + (groupCodes.length - 3) + '件' : '';
        r.warnings.push({
          severity: 'mid',
          message: '包括注意(グループ' + group + '): ' + names.join(', ') + suffix + ' が同一包括グループに属しています'
        });
      }
    }
  }

  // ============================================================
  // 算定回数チェック
  // ============================================================

  /** 算定回数テーブル: 上限回数を超過している場合に警告 */
  function checkSanteiCount(r) {
    // レセプト内の各コードの出現回数を集計
    const codeCounts = {};
    for (const p of r.procedures) {
      if (p.isDrug) continue;
      if (!p.code) continue;
      const qty = p.quantity || 1;
      codeCounts[p.code] = (codeCounts[p.code] || 0) + qty;
    }

    for (const [code, count] of Object.entries(codeCounts)) {
      const limit = MasterLoader.getSanteiCount(code);
      if (!limit || !limit.max) continue;

      const maxCount = typeof limit.max === 'number' ? limit.max : parseInt(limit.max);
      if (isNaN(maxCount) || maxCount <= 0) continue;

      if (count > maxCount) {
        const unitName = limit.un || '';
        r.warnings.push({
          severity: 'high',
          message: '算定回数超過: ' + codeName(code) + ' は' + unitName + maxCount + '回限り（' + count + '回算定）'
        });
      }
    }
  }

  // ============================================================
  // 病名要件チェック（傷病名関連区分 × 特定疾患/難病区分）
  // ============================================================

  // 診療行為の傷病名関連区分(sy) → 必要な傷病名フラグ
  const SY_REQUIRE = {
    '3': { field: 'tk', val: '03', label: '皮膚科特定疾患' },
    '4': { field: 'tk', val: '04', label: '皮膚科特定疾患' },
    '5': { field: 'tk', val: '05', label: '特定疾患' },
    '7': { field: 'tk', val: '07', label: 'てんかん' },
    '9': { field: 'nb', val: '09', label: '難病外来指導管理料対象' },
  };

  /** 指導管理料等に必要な傷病名が付いているか（特定疾患療養管理料・てんかん指導料・難病外来指導管理料等） */
  function checkByomeiRequirement(r) {
    if (!MasterLoader.getSyRelation) return;
    for (const p of r.procedures) {
      if (p.isDrug || !p.code) continue;
      const rel = MasterLoader.getSyRelation(p.code);
      if (!rel) continue;
      const req = SY_REQUIRE[rel.sy];
      if (!req) continue;
      const hasReqDisease = r.diseases.some(d => {
        const f = d.code && MasterLoader.getDiseaseFlags(d.code);
        return f && f[req.field] === req.val;
      });
      if (!hasReqDisease) {
        r.warnings.push({
          severity: 'high',
          message: '病名要件: ' + (rel.name || codeName(p.code)) + ' に必要な' + req.label + '病名が見当たりません'
        });
      }
    }
  }

  /** 単独使用禁止傷病名: 修飾語（部位等）なしで単独記録されている包括的病名を警告 */
  function checkStandaloneDisease(r) {
    if (!MasterLoader.getDiseaseFlags) return;
    for (const d of r.diseases) {
      if (!d.code) continue;
      const f = MasterLoader.getDiseaseFlags(d.code);
      if (f && f.tan === '01' && !d.modifier) {
        r.warnings.push({
          severity: 'mid',
          message: '単独使用禁止: ' + (MasterLoader.getDiseaseName(d.code) || d.code) + ' は部位等の修飾語との併記が必要です'
        });
      }
    }
  }

  /** 入外区分チェック: 外来レセプトに入院限定(inout=1)の診療行為が混入していないか
   *  ドライブスルー診療＝外来のみのため、入院限定行為は算定不可 */
  function checkInoutRestriction(r) {
    for (const p of r.procedures) {
      if (p.isDrug || !p.code) continue;
      const proc = MasterLoader.getProcedure(p.code);
      if (proc && Number(proc.inout) === 1) {
        r.warnings.push({
          severity: 'high',
          message: '入院限定: ' + codeName(p.code) + ' は入院でのみ算定可（外来レセプトで算定不可）'
        });
      }
    }
  }

  // ============================================================
  // 摘要要否リマインド（E案+D案）: 断定せず「確認してください」と注意表示
  //  ※ 摘要記載が必要になりやすい項目を検知。誤検知ゼロ方針（エラーではなく確認喚起）。
  //     ルールは memo_reminder_rules.json（医師・事務が随時調整）。
  // ============================================================
  function checkMemoReminders(r) {
    if (!MasterLoader.getMemoRules) return;
    const rules = MasterLoader.getMemoRules();
    if (!rules.length) return;
    // レセプト内の診療行為名を集める（マスタ名＋レコード名）
    const names = r.procedures
      .filter(p => !p.isDrug && p.code)
      .map(p => (MasterLoader.getProcedureName(p.code) || p.name || ''));
    if (!names.length) return;
    for (const rule of rules) {
      const kws = rule.matchKeywords || [];
      const hit = names.some(nm => kws.some(kw => kw && nm.indexOf(kw) !== -1));
      if (hit) {
        r.warnings.push({
          severity: 'low',
          message: '摘要確認: ' + (rule.memo || '摘要記載が必要な場合があります') + '（記載漏れにご注意ください）'
        });
      }
    }
    // ★v0.16 別表Ⅰ（公式）ベースの摘要リマインド。
    //   請求された診療行為の「無条件の記載事項」が摘要(CO)に無い場合のみ低警告。
    //   条件付き記載事項（（…場合））は該当状況を機械判定できないため発火しない＝誤検知ゼロ方針。
    checkBeppyoMemo(r);
  }

  function checkBeppyoMemo(r) {
    if (!MasterLoader.getBeppyoRulesByProc) return;
    const coSet = new Set((r.comments || []).map(c => c.code).filter(Boolean));
    const seenKubun = new Set();
    for (const p of (r.procedures || [])) {
      if (p.isDrug || !p.code) continue;
      const ref = MasterLoader.getBeppyoRulesByProc(p.code);
      if (!ref || seenKubun.has(ref.kubun)) continue;
      seenKubun.add(ref.kubun);
      let hasUncondReq = false, satisfied = false;
      for (const g of ref.groups) {
        for (const it of g.items) {
          if (!/^\d{9}$/.test(it.code)) continue;
          const cond = (it.cond || '').trim();
          const uncond = !cond || !(cond[0] === '（' || cond[0] === '(');
          if (!uncond) continue;
          hasUncondReq = true;
          if (coSet.has(it.code)) satisfied = true;
        }
      }
      if (hasUncondReq && !satisfied) {
        r.warnings.push({
          severity: 'low',
          message: '摘要確認(別表Ⅰ): 「' + (ref.groups[0].name || '') + '」は摘要への記載事項があります（詳細は下部の別表Ⅰ記載事項をご確認ください）'
        });
      }
    }
  }

  return {
    runAdvancedChecks,
  };
})();
