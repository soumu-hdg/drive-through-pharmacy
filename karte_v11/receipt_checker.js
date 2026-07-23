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
    checkHoukatsu(receipt);
    checkSanteiCount(receipt);
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

    for (const p of r.procedures) {
      const proc = MasterLoader.getProcedure(p.code);
      if (!proc) continue;
      const name = proc.name || '';
      if (name.includes('乳幼児') && age >= 6) {
        r.warnings.push({
          severity: 'mid',
          message: '年齢制限: ' + name + ' は6歳未満対象（患者' + age + '歳）'
        });
      }
      if (name.includes('小児') && !name.includes('乳幼児') && age >= 15) {
        r.warnings.push({
          severity: 'low',
          message: '年齢注意: ' + name + '（患者' + age + '歳）'
        });
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

  /** 背反テーブル1: 同日に併算定不可 */
  function checkHaihanDaily(r) {
    const codes = getProcedureCodes(r);
    if (codes.length < 2) return;
    const pairs = MasterLoader.findHaihanPairs('Daily', codes);
    const seen = new Set();
    for (const [c1, c2] of pairs) {
      const key = [c1, c2].sort().join('-');
      if (seen.has(key)) continue;
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

  return {
    runAdvancedChecks,
  };
})();
