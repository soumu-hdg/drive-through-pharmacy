/* 検索の読み替え（全デモ共通）
   KanaSearch.norm(s)        : 比較用の正規化（NFKC・ひらがな→カタカナ・空白/記号除去・小文字）
   KanaSearch.romaji(s)      : ローマ字 → カタカナ（karonaru→カロナール, shi/si, tsu/tu, nn, 促音, 長音の揺れ）
   KanaSearch.match(query, fields) : fields（文字列の配列）のどれかに query が含まれるか。ローマ字でも判定
   KanaSearch.filter(list, query, fn) : fn(item) → 照合する文字列の配列
*/
(function () {
  var T = {
    kya:'キャ',kyu:'キュ',kyo:'キョ',sha:'シャ',shu:'シュ',sho:'ショ',she:'シェ',sya:'シャ',syu:'シュ',syo:'ショ',
    cha:'チャ',chu:'チュ',cho:'チョ',che:'チェ',tya:'チャ',tyu:'チュ',tyo:'チョ',cya:'チャ',cyu:'チュ',cyo:'チョ',
    nya:'ニャ',nyu:'ニュ',nyo:'ニョ',hya:'ヒャ',hyu:'ヒュ',hyo:'ヒョ',mya:'ミャ',myu:'ミュ',myo:'ミョ',
    rya:'リャ',ryu:'リュ',ryo:'リョ',gya:'ギャ',gyu:'ギュ',gyo:'ギョ',ja:'ジャ',ju:'ジュ',jo:'ジョ',je:'ジェ',
    jya:'ジャ',jyu:'ジュ',jyo:'ジョ',zya:'ジャ',zyu:'ジュ',zyo:'ジョ',bya:'ビャ',byu:'ビュ',byo:'ビョ',pya:'ピャ',pyu:'ピュ',pyo:'ピョ',
    dya:'ヂャ',dyu:'ヂュ',dyo:'ヂョ',thi:'ティ',dhi:'ディ',fa:'ファ',fi:'フィ',fe:'フェ',fo:'フォ',vu:'ヴ',va:'ヴァ',vi:'ヴィ',ve:'ヴェ',vo:'ヴォ',
    tsu:'ツ',shi:'シ',chi:'チ',fu:'フ',ji:'ジ',
    ka:'カ',ki:'キ',ku:'ク',ke:'ケ',ko:'コ',sa:'サ',si:'シ',su:'ス',se:'セ',so:'ソ',ta:'タ',ti:'チ',tu:'ツ',te:'テ',to:'ト',
    na:'ナ',ni:'ニ',nu:'ヌ',ne:'ネ',no:'ノ',ha:'ハ',hi:'ヒ',hu:'フ',he:'ヘ',ho:'ホ',ma:'マ',mi:'ミ',mu:'ム',me:'メ',mo:'モ',
    ya:'ヤ',yu:'ユ',yo:'ヨ',ra:'ラ',ri:'リ',ru:'ル',re:'レ',ro:'ロ',la:'ラ',li:'リ',lu:'ル',le:'レ',lo:'ロ',wa:'ワ',wo:'ヲ',
    ga:'ガ',gi:'ギ',gu:'グ',ge:'ゲ',go:'ゴ',za:'ザ',zi:'ジ',zu:'ズ',ze:'ゼ',zo:'ゾ',da:'ダ',di:'ヂ',du:'ヅ',de:'デ',do:'ド',
    ba:'バ',bi:'ビ',bu:'ブ',be:'ベ',bo:'ボ',pa:'パ',pi:'ピ',pu:'プ',pe:'ペ',po:'ポ',
    a:'ア',i:'イ',u:'ウ',e:'エ',o:'オ','-':'ー'
  };
  function romaji(s) {
    s = String(s || '').toLowerCase(); var out = '', i = 0;
    while (i < s.length) {
      var c = s[i];
      if (!/[a-z\-]/.test(c)) { out += c; i++; continue; }
      if (c === 'n' && (i + 1 >= s.length || s[i + 1] === "'" || (!/[aiueoyn]/.test(s[i + 1])))) { out += 'ン'; i += (s[i + 1] === "'" ? 2 : 1); continue; }
      if (c === 'n' && s[i + 1] === 'n') { out += 'ン'; i += 2; continue; }
      if (i + 1 < s.length && c === s[i + 1] && /[bcdfghjklmpqrstvwxyz]/.test(c)) { out += 'ッ'; i++; continue; }
      var hit = false;
      for (var L = 3; L >= 1; L--) {
        var k = s.substr(i, L);
        if (T[k]) { out += T[k]; i += L; hit = true; break; }
      }
      if (!hit) { out += c; i++; }
    }
    return out;
  }
  function norm(s) {
    s = String(s || '').normalize('NFKC').toLowerCase();
    s = s.replace(/[ぁ-ゖ]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) + 0x60); }); // ひら→カタ
    return s.replace(/[\s　・「」（）()\[\]、。,]/g, '');
  }
  // 長音の揺れ（カロナール ≒ カロナル）を吸収する比較キー
  function loose(s) { return norm(s).replace(/ー/g, ''); }
  function variants(q) {
    var n = norm(q), v = [n];
    if (/[a-z]/.test(n)) { var r = norm(romaji(n)); v.push(r); }
    return v.filter(Boolean);
  }
  function match(q, fields) {
    if (!q) return true;
    // 空白区切りは「すべて含む」（例: 'karo 0.3'）
    var toks = String(q).normalize('NFKC').trim().split(/\s+/).filter(Boolean);
    if (toks.length > 1) return toks.every(function (t) { return match(t, fields); });
    var vs = variants(q);
    for (var i = 0; i < fields.length; i++) {
      var f = norm(fields[i]), fl = loose(fields[i]);
      for (var j = 0; j < vs.length; j++) {
        if (f.indexOf(vs[j]) >= 0 || fl.indexOf(vs[j].replace(/ー/g, '')) >= 0) return true;
      }
    }
    return false;
  }
  function filter(list, q, fn) { return (list || []).filter(function (x) { return match(q, fn(x)); }); }
  window.KanaSearch = { norm: norm, romaji: romaji, match: match, filter: filter, variants: variants };
})();
