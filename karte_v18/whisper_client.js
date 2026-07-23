/**
 * Whisper-Karte クライアント (v0.6 カルテ統合版)
 * Vercel Serverless Functions 経由で Groq Whisper + Claude API と通信
 * localhost不要 — クラウドAPI常時接続
 */

// ========================================
// 設定
// ========================================
// Vercel API (常時稼働) を使用。localhostは不要
const WHISPER_API = (function() {
  // Vercelデプロイ時: 同一ドメインの /api
  if (location.hostname.includes('vercel.app')) return '/api';
  // GitHub Pages等の外部デプロイ: Vercel URLを直接指定
  return 'https://kartev06whisper.vercel.app/api';
})();
let whisperRecording = false;
let whisperMediaRecorder = null;
let whisperAudioChunks = [];
let whisperRecordTimer = null;
let whisperRecordSeconds = 0;
let whisperStream = null;

// 語句登録テンプレート（診療科別）
const VOCAB_TEMPLATES = {
  '循環器': '心房細動,心室頻拍,大動脈弁狭窄症,僧帽弁閉鎖不全,心不全,狭心症,心筋梗塞,ワルファリン,アミオダロン,DOAC',
  '消化器': '逆流性食道炎,胃潰瘍,十二指腸潰瘍,クローン病,潰瘍性大腸炎,ヘリコバクター・ピロリ,PPI,ランソプラゾール',
  '呼吸器': '気管支喘息,COPD,間質性肺炎,肺気腫,気胸,胸水,吸入ステロイド,LABA,LAMA',
  '整形': '変形性膝関節症,腰椎椎間板ヘルニア,脊柱管狭窄症,骨粗鬆症,関節リウマチ,大腿骨頸部骨折',
  '皮膚科': 'アトピー性皮膚炎,蕁麻疹,帯状疱疹,白癬,乾癬,ステロイド外用',
  '検査値': 'HbA1c,eGFR,BNP,CRP,AST,ALT,γ-GTP,Cr,BUN,WBC,Hb,PLT,PT-INR',
  '内服薬': 'アムロジピン,メトホルミン,リナグリプチン,ロサルタン,アトルバスタチン,ランソプラゾール,レバミピド',
  '症状': '倦怠感,食欲不振,呼吸困難,浮腫,動悸,めまい,悪心,嘔吐,下痢,便秘,発熱,頭痛'
};

// ========================================
// 語句登録
// ========================================
function whisperLoadVocab() {
  try {
    return JSON.parse(localStorage.getItem('whisper_vocab') || '[]');
  } catch { return []; }
}

function whisperSaveVocab(words) {
  localStorage.setItem('whisper_vocab', JSON.stringify(words));
}

function whisperGetInitialPrompt() {
  const words = whisperLoadVocab();
  if (words.length === 0) return '';
  // Whisperのinitial_promptとして語句をカンマ区切りで結合
  return words.join('、');
}

function whisperAddVocabWords(text) {
  const existing = whisperLoadVocab();
  const newWords = text.split(/[,、\n\s]+/).map(w => w.trim()).filter(w => w && !existing.includes(w));
  if (newWords.length === 0) return;
  const updated = [...existing, ...newWords];
  whisperSaveVocab(updated);
  whisperRenderVocabList();
}

function whisperRemoveVocab(word) {
  const words = whisperLoadVocab().filter(w => w !== word);
  whisperSaveVocab(words);
  whisperRenderVocabList();
}

function whisperClearVocab() {
  whisperSaveVocab([]);
  whisperRenderVocabList();
}

function whisperRenderVocabList() {
  const container = document.getElementById('whisperVocabList');
  if (!container) return;
  const words = whisperLoadVocab();
  if (words.length === 0) {
    container.innerHTML = '<span style="color:var(--text-muted);font-size:11px;">登録語句なし</span>';
    return;
  }
  container.innerHTML = words.map(w => {
    const safe = escapeHtml(w);
    const safeAttr = safe.replace(/'/g, '&#39;');
    return `<span class="whisper-vocab-tag">${safe}<button onclick="whisperRemoveVocab('${safeAttr}')" title="削除">&times;</button></span>`;
  }).join('');
}

function whisperApplyTemplate() {
  const sel = document.getElementById('whisperVocabTemplate');
  if (!sel) return;
  const key = sel.value;
  if (!key || !VOCAB_TEMPLATES[key]) return;
  whisperAddVocabWords(VOCAB_TEMPLATES[key]);
  sel.value = '';
}

function whisperToggleVocabPanel() {
  const panel = document.getElementById('whisperVocabPanel');
  if (!panel) return;
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : '';
  if (!visible) whisperRenderVocabList();
}

// ========================================
// 初期化
// ========================================
async function whisperInit() {
  // マイク権限を取得してからデバイス列挙（権限なしだとdeviceId/labelが空になる）
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach(t => t.stop()); // 即解放

    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === 'audioinput');
    const select = document.getElementById('whisperMicSelect');
    select.innerHTML = '<option value="__default__">既定のマイク</option>';
    mics.forEach(mic => {
      const opt = document.createElement('option');
      opt.value = mic.deviceId || '__default__';
      opt.textContent = mic.label || `マイク ${select.options.length}`;
      select.appendChild(opt);
    });
    // 常に録音可能（既定のマイクがある）
    document.getElementById('whisperRecBtn').disabled = false;
  } catch (e) {
    console.warn('マイク列挙失敗:', e);
    // 権限拒否でも既定マイクで録音を試みられるようにする
    const select = document.getElementById('whisperMicSelect');
    select.innerHTML = '<option value="__default__">既定のマイク</option>';
    document.getElementById('whisperRecBtn').disabled = false;
  }

  // 語句登録リスト描画
  whisperRenderVocabList();

  // プロンプト一覧を取得
  try {
    const res = await fetch(`${WHISPER_API}/prompts`);
    if (res.ok) {
      const data = await res.json();
      const sel = document.getElementById('whisperPromptSelect');
      sel.innerHTML = '';
      data.prompts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        sel.appendChild(opt);
      });
      whisperSetStatus('音声カルテ 接続OK', 'success');
    } else {
      whisperSetStatus('音声カルテ API応答エラー', 'error');
    }
  } catch (e) {
    console.warn('Whisper API接続失敗:', e);
    whisperSetStatus('音声カルテ APIに接続できません', 'error');
  }
}

// ========================================
// 録音開始/停止
// ========================================
async function whisperToggleRecord() {
  if (whisperRecording) {
    whisperStopRecord();
  } else {
    await whisperStartRecord();
  }
}

async function whisperStartRecord() {
  const micId = document.getElementById('whisperMicSelect').value;

  try {
    const audioConstraints = (micId && micId !== '__default__')
      ? { deviceId: { exact: micId } }
      : true;
    whisperStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints
    });
    whisperMediaRecorder = new MediaRecorder(whisperStream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm'
    });
    whisperAudioChunks = [];

    whisperMediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) whisperAudioChunks.push(e.data);
    };

    whisperMediaRecorder.onstop = () => {
      whisperOnRecordStop();
    };

    whisperMediaRecorder.start(1000); // 1秒ごとにチャンク
    whisperRecording = true;

    // UI更新
    const btn = document.getElementById('whisperRecBtn');
    btn.classList.add('recording');
    btn.innerHTML = '<span class="rec-dot active"></span> 停止';
    document.getElementById('whisperBody').style.display = '';
    document.getElementById('whisperTranscript').value = '';
    document.getElementById('whisperKarte').value = '';
    document.getElementById('whisperGenBtn').disabled = true;
    document.getElementById('whisperApplyBtn').disabled = true;

    // タイマー
    whisperRecordSeconds = 0;
    whisperRecordTimer = setInterval(() => {
      whisperRecordSeconds++;
      const m = String(Math.floor(whisperRecordSeconds / 60)).padStart(2, '0');
      const s = String(whisperRecordSeconds % 60).padStart(2, '0');
      document.getElementById('whisperTime').textContent = `${m}:${s}`;
    }, 1000);

    whisperSetStatus('録音中...', 'recording');
  } catch (e) {
    whisperSetStatus('マイクアクセス失敗: ' + e.message, 'error');
  }
}

function whisperStopRecord() {
  if (whisperMediaRecorder && whisperMediaRecorder.state !== 'inactive') {
    whisperMediaRecorder.stop();
  }
  if (whisperStream) {
    whisperStream.getTracks().forEach(t => t.stop());
    whisperStream = null;
  }
  whisperRecording = false;
  clearInterval(whisperRecordTimer);

  const btn = document.getElementById('whisperRecBtn');
  btn.classList.remove('recording');
  btn.innerHTML = '<span class="rec-dot"></span> 録音';

  whisperSetStatus('文字起こし中...', 'processing');
}

// ========================================
// 録音停止後: 文字起こしAPI呼び出し
// ========================================
async function whisperOnRecordStop() {
  const blob = new Blob(whisperAudioChunks, { type: 'audio/webm' });
  const vocabPrompt = whisperGetInitialPrompt();
  const UPLOAD_LIMIT = 4 * 1024 * 1024;
  const t0 = performance.now();

  try {
    // 小さい録音はそのまま送信
    if (blob.size <= UPLOAD_LIMIT) {
      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      if (vocabPrompt) formData.append('initial_prompt', vocabPrompt);
      const res = await fetch(`${WHISPER_API}/transcribe`, { method: 'POST', body: formData });
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      if (!res.ok) {
        let errMsg;
        try { const err = await res.json(); errMsg = err.error; } catch { errMsg = `HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`; }
        whisperSetStatus(`文字起こしエラー: ${errMsg}`, 'error');
        return;
      }
      const data = await res.json();
      document.getElementById('whisperTranscript').value = data.transcript;
      document.getElementById('whisperGenBtn').disabled = false;
      whisperSetStatus(`文字起こし完了 (${elapsed}秒)`, 'success');
      return;
    }

    // 大きい録音: デコード→チャンク分割→並列送信
    whisperSetStatus('長時間録音をデコード中...', 'processing');
    const audioBuffer = await whisperDecodeAudio(blob);
    const duration = audioBuffer.duration;
    const numChunks = Math.ceil(duration / CHUNK_DURATION_SEC);
    whisperSetStatus(`${numChunks}分割で文字起こし中...`, 'processing');

    const promises = [];
    for (let i = 0; i < numChunks; i++) {
      const start = Math.max(0, i * CHUNK_DURATION_SEC - (i > 0 ? CHUNK_OVERLAP_SEC : 0));
      const end = Math.min(duration, (i + 1) * CHUNK_DURATION_SEC);
      const wavBlob = audioBufferSliceToWav(audioBuffer, start, end);
      promises.push(
        whisperTranscribeChunk(wavBlob, `chunk_${i}.wav`, vocabPrompt)
          .then(text => ({ index: i, text, ok: true }))
          .catch(err => ({ index: i, text: '', ok: false, error: err.message }))
      );
    }
    const results = await Promise.all(promises);
    results.sort((a, b) => a.index - b.index);
    const transcript = results.filter(r => r.ok).map(r => r.text).join('\n');
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    document.getElementById('whisperTranscript').value = transcript;
    document.getElementById('whisperGenBtn').disabled = false;
    whisperSetStatus(`文字起こし完了 (${elapsed}秒, ${numChunks}分割)`, 'success');
  } catch (e) {
    whisperSetStatus('API通信エラー: ' + e.message, 'error');
  }
}

// ========================================
// カルテ生成
// ========================================
async function whisperGenerate() {
  const transcript = document.getElementById('whisperTranscript').value.trim();
  if (!transcript) return;

  const template = document.getElementById('whisperPromptSelect').value;
  const memoEl = document.getElementById('whisperMemo');
  const memo = memoEl ? memoEl.value.trim() : '';

  whisperSetStatus('カルテ生成中...', 'processing');
  document.getElementById('whisperGenBtn').disabled = true;

  try {
    const t0 = performance.now();
    const payload = { transcript, template };
    if (memo) payload.memo = memo;

    const res = await fetch(`${WHISPER_API}/generate-karte`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

    if (!res.ok) {
      let errMsg;
      try { const err = await res.json(); errMsg = err.error; } catch { errMsg = `HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`; }
      whisperSetStatus(`生成エラー: ${errMsg}`, 'error');
      document.getElementById('whisperGenBtn').disabled = false;
      return;
    }

    const data = await res.json();
    document.getElementById('whisperKarte').value = data.karte;
    document.getElementById('whisperGenBtn').disabled = false;
    document.getElementById('whisperApplyBtn').disabled = false;
    whisperSetStatus(`カルテ生成完了 (${elapsed}秒)`, 'success');

    // 録音履歴に保存
    whisperSaveHistory(transcript, data.karte, template);
  } catch (e) {
    whisperSetStatus('API通信エラー: ' + e.message, 'error');
    document.getElementById('whisperGenBtn').disabled = false;
  }
}

// ========================================
// カルテフィールドに反映
// ========================================
function whisperApplyToFields() {
  const karteText = document.getElementById('whisperKarte').value;
  if (!karteText) return;

  // AIカルテ出力をパース → 各フィールドにマッピング
  const sections = parseKarteSections(karteText);

  // 主訴フィールド
  if (sections.chiefComplaint) {
    const cc = document.getElementById('chiefComplaint');
    if (cc) cc.value = sections.chiefComplaint;
  }

  // 所見エディタ（リッチテキスト）に構造化して反映
  const editor = document.getElementById('findingsEditor');
  if (editor) {
    const hasParsedSections = sections.presentIllness || sections.physicalExam || sections.labFindings || sections.assessment || sections.plan;

    const isEmptySection = (val) => !val || /^[（(]?(記載なし|情報なし|なし|特記なし|特記事項なし)[）)]?$/i.test(val.trim());

    let html = '';
    if (hasParsedSections) {
      // パースできた場合：構造化して表示（「記載なし」セクションはスキップ）
      if (!isEmptySection(sections.presentIllness)) {
        html += `<b style="color:#059669">[現病歴]</b><br>${escapeHtml(sections.presentIllness).replace(/\n/g, '<br>')}<br><br>`;
      }
      if (!isEmptySection(sections.physicalExam)) {
        html += `<b style="color:#059669">[身体所見]</b><br>${escapeHtml(sections.physicalExam).replace(/\n/g, '<br>')}<br><br>`;
      }
      if (!isEmptySection(sections.labFindings)) {
        html += `<b style="color:#059669">[検査所見]</b><br>${escapeHtml(sections.labFindings).replace(/\n/g, '<br>')}<br><br>`;
      }
      if (sections.isAssessmentPlanCombined) {
        // A&P統合型：1セクションで表示
        if (sections.assessment) {
          html += `<b style="color:#2563eb">[A&P]</b><br>${escapeHtml(sections.assessment).replace(/\n/g, '<br>')}`;
        }
      } else {
        // A/P分離型
        if (sections.assessment) {
          html += `<b style="color:#2563eb">[A]</b><br>${escapeHtml(sections.assessment).replace(/\n/g, '<br>')}<br><br>`;
        }
        if (sections.plan) {
          html += `<b style="color:#2563eb">[P]</b><br>${escapeHtml(sections.plan).replace(/\n/g, '<br>')}`;
        }
      }
    } else {
      // パースできなかった場合：全文をそのまま表示
      html = escapeHtml(karteText).replace(/\n/g, '<br>');
    }

    const existing = editor.innerText.trim();
    if (existing) {
      editor.innerHTML += '<br><hr><br>' + html;
    } else {
      editor.innerHTML = html;
    }
  }

  // バイタルサインのパース・反映
  if (sections.vitals) {
    const v = sections.vitals;
    if (v.t) { const el = document.getElementById('vitalT'); if (el) el.value = v.t; }
    if (v.bps) { const el = document.getElementById('vitalBPS'); if (el) el.value = v.bps; }
    if (v.bpd) { const el = document.getElementById('vitalBPD'); if (el) el.value = v.bpd; }
    if (v.spo2) { const el = document.getElementById('vitalSpO2'); if (el) el.value = v.spo2; }
    if (v.p) { const el = document.getElementById('vitalP'); if (el) el.value = v.p; }
  }

  whisperSetStatus('カルテフィールドに反映しました', 'success');
  if (typeof showToast === 'function') showToast('音声カルテを反映しました');
}

/**
 * AIカルテ出力から各セクションをパース
 * 【】形式 と ＜S＞＜O＞＜A＞＜P＞形式の両方に対応
 */
function parseKarteSections(text) {
  const result = {
    chiefComplaint: '',
    presentIllness: '',   // 現病歴
    physicalExam: '',     // 身体所見
    labFindings: '',      // 検査所見
    assessment: '',       // A (評価)
    plan: '',             // P (計画)
    subjective: '',       // S (SOAP)
    objective: '',        // O (SOAP)
    isAssessmentPlanCombined: false, // A&P統合型か
    vitals: null,
    fullText: text
  };

  // === 【】形式のパース ===
  const bracketSections = {
    '主訴': 'chiefComplaint',
    '現病歴': 'presentIllness',
    '身体所見': 'physicalExam',
    '検査所見': 'labFindings',
    '理学所見': 'physicalExam',
    '評価': 'assessment',
    '計画': 'plan',
    'Assessment': 'assessment',
    'Plan': 'plan',
    'A': 'assessment',
    'P': 'plan',
    'A&P': 'assessment',
    'アセスメント＆プラン': 'assessment',
    'アセスメント&プラン': 'assessment',
    'アセスメントとプラン': 'assessment',
  };

  const combinedAPLabels = ['A&P', 'アセスメント＆プラン', 'アセスメント&プラン', 'アセスメントとプラン'];

  for (const [label, key] of Object.entries(bracketSections)) {
    const regex = new RegExp(`【${label}】\\s*(.+?)(?=\\n【|$)`, 's');
    const m = text.match(regex);
    if (m) {
      const val = m[1].trim();
      result[key] = val;
      if (combinedAPLabels.includes(label)) {
        result.isAssessmentPlanCombined = true;
      }
    }
  }

  // === SOAP形式 ＜S＞＜O＞＜A＞＜P＞ のパース ===
  const soapPatterns = [
    { regex: /[＜<]S[＞>]\s*(.+?)(?=[＜<][SOAP][＞>]|$)/s, key: 'subjective' },
    { regex: /[＜<]O[＞>]\s*(.+?)(?=[＜<][SAP][＞>]|$)/s, key: 'objective' },
    { regex: /[＜<]A[＞>]\s*(.+?)(?=[＜<][SOP][＞>]|$)/s, key: 'assessment' },
    { regex: /[＜<]P[＞>]\s*(.+?)(?=[＜<][SOA][＞>]|$)/s, key: 'plan' },
  ];
  for (const { regex, key } of soapPatterns) {
    const m = text.match(regex);
    if (m) result[key] = m[1].trim();
  }

  // SOAPが取れた場合、主訴・現病歴にフォールバック
  if (!result.chiefComplaint && result.subjective) {
    // Sの最初の行を主訴として抽出
    const firstLine = result.subjective.split('\n')[0].trim();
    result.chiefComplaint = firstLine;
  }
  if (!result.presentIllness && result.subjective) {
    result.presentIllness = result.subjective;
  }
  if (!result.physicalExam && result.objective) {
    result.physicalExam = result.objective;
  }

  // === バイタルサイン抽出 ===
  const vitals = {};
  const tempMatch = text.match(/(\d{2}\.\d)\s*[°℃]/);
  if (tempMatch) vitals.t = tempMatch[1];

  const bpMatch = text.match(/(\d{2,3})\s*[\/／]\s*(\d{2,3})\s*mmHg/i);
  if (bpMatch) { vitals.bps = bpMatch[1]; vitals.bpd = bpMatch[2]; }

  const spo2Match = text.match(/SpO[₂2]\s*[:：]?\s*(\d{2,3})\s*%/i);
  if (spo2Match) vitals.spo2 = spo2Match[1];

  const pMatch = text.match(/[脈拍PR]\s*[:：]?\s*(\d{2,3})\s*[\/回]/);
  if (pMatch) vitals.p = pMatch[1];

  if (Object.keys(vitals).length > 0) result.vitals = vitals;

  return result;
}

// ========================================
// ユーティリティ
// ========================================
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function whisperSetStatus(msg, type) {
  const el = document.getElementById('whisperStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'whisper-status';
  if (type) el.classList.add('whisper-status-' + type);
}

// ========================================
// 音声デコード＆チャンク分割 (高速・非リアルタイム)
// ========================================
const CHUNK_DURATION_SEC = 120; // 2分ごとに分割
const CHUNK_OVERLAP_SEC = 1;   // 1秒オーバーラップ（単語切れ防止）
const TARGET_SAMPLE_RATE = 16000;

/**
 * 音声Blobをデコード → 16kHz mono PCMに変換
 * OfflineAudioContextで一瞬で完了（リアルタイム再生不要）
 */
async function whisperDecodeAudio(audioBlob) {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let decoded;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    audioCtx.close();
  }
  const offlineLen = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, offlineLen, TARGET_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  return await offline.startRendering();
}

/**
 * AudioBufferの一部をWAV Blobに変換（一瞬で完了）
 */
function audioBufferSliceToWav(audioBuffer, startSec, endSec) {
  const rate = audioBuffer.sampleRate;
  const ch = audioBuffer.getChannelData(0);
  const s0 = Math.floor(startSec * rate);
  const s1 = Math.min(Math.ceil(endSec * rate), ch.length);
  const samples = ch.subarray(s0, s1);
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  // RIFF header
  [0x52,0x49,0x46,0x46].forEach((b,i) => v.setUint8(i, b));
  v.setUint32(4, 36 + dataSize, true);
  [0x57,0x41,0x56,0x45].forEach((b,i) => v.setUint8(8+i, b));
  [0x66,0x6D,0x74,0x20].forEach((b,i) => v.setUint8(12+i, b));
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  [0x64,0x61,0x74,0x61].forEach((b,i) => v.setUint8(36+i, b));
  v.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * 1チャンクをAPIに送信して文字起こし
 */
async function whisperTranscribeChunk(wavBlob, chunkName, vocabPrompt) {
  const formData = new FormData();
  formData.append('audio', wavBlob, chunkName);
  if (vocabPrompt) formData.append('initial_prompt', vocabPrompt);
  const res = await fetch(`${WHISPER_API}/transcribe`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    let errMsg;
    try { const err = await res.json(); errMsg = err.error; } catch { errMsg = `HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`; }
    throw new Error(errMsg);
  }
  const data = await res.json();
  return data.transcript;
}

// ========================================
// 音声ファイルアップロード → 文字起こし
// ========================================
async function whisperUploadFile(input) {
  const file = input.files[0];
  if (!file) return;

  const nameEl = document.getElementById('whisperFileName');
  if (nameEl) nameEl.textContent = file.name;

  document.getElementById('whisperBody').style.display = '';
  document.getElementById('whisperTranscript').value = '';
  document.getElementById('whisperKarte').value = '';
  document.getElementById('whisperGenBtn').disabled = true;
  document.getElementById('whisperApplyBtn').disabled = true;

  const UPLOAD_LIMIT = 4 * 1024 * 1024;
  const vocabPrompt = whisperGetInitialPrompt();
  const t0 = performance.now();

  try {
    // 小さいファイルはそのまま送信
    if (file.size <= UPLOAD_LIMIT) {
      whisperSetStatus('文字起こし中...', 'processing');
      const formData = new FormData();
      formData.append('audio', file, file.name);
      if (vocabPrompt) formData.append('initial_prompt', vocabPrompt);
      const res = await fetch(`${WHISPER_API}/transcribe`, { method: 'POST', body: formData });
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      if (!res.ok) {
        let errMsg;
        try { const err = await res.json(); errMsg = err.error; } catch { errMsg = `HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`; }
        whisperSetStatus(`文字起こしエラー: ${errMsg}`, 'error');
        return;
      }
      const data = await res.json();
      document.getElementById('whisperTranscript').value = data.transcript;
      document.getElementById('whisperGenBtn').disabled = false;
      whisperSetStatus(`文字起こし完了 (${elapsed}秒) — ${file.name}`, 'success');
      input.value = '';
      return;
    }

    // === 大きいファイル: デコード → チャンク分割 → 並列送信 ===
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    whisperSetStatus(`音声デコード中... (${sizeMB}MB)`, 'processing');

    const audioBuffer = await whisperDecodeAudio(file);
    const duration = audioBuffer.duration;
    const numChunks = Math.ceil(duration / CHUNK_DURATION_SEC);

    whisperSetStatus(`${numChunks}分割で文字起こし中... (${Math.round(duration)}秒の音声)`, 'processing');

    // チャンクWAV生成（一瞬）& 並列アップロード
    const promises = [];
    for (let i = 0; i < numChunks; i++) {
      const start = Math.max(0, i * CHUNK_DURATION_SEC - (i > 0 ? CHUNK_OVERLAP_SEC : 0));
      const end = Math.min(duration, (i + 1) * CHUNK_DURATION_SEC);
      const wavBlob = audioBufferSliceToWav(audioBuffer, start, end);
      promises.push(
        whisperTranscribeChunk(wavBlob, `chunk_${i}.wav`, vocabPrompt)
          .then(text => ({ index: i, text, ok: true }))
          .catch(err => ({ index: i, text: '', ok: false, error: err.message }))
      );
    }

    const results = await Promise.all(promises);
    results.sort((a, b) => a.index - b.index);

    const failed = results.filter(r => !r.ok);
    if (failed.length === results.length) {
      whisperSetStatus(`全チャンク失敗: ${failed[0].error}`, 'error');
      input.value = '';
      return;
    }

    const transcript = results.filter(r => r.ok).map(r => r.text).join('\n');
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

    document.getElementById('whisperTranscript').value = transcript;
    document.getElementById('whisperGenBtn').disabled = false;

    const warn = failed.length > 0 ? ` (${failed.length}チャンク失敗)` : '';
    whisperSetStatus(`文字起こし完了 (${elapsed}秒, ${numChunks}分割)${warn} — ${file.name}`, 'success');

  } catch (e) {
    whisperSetStatus('エラー: ' + e.message, 'error');
  }

  input.value = '';
}

// ========================================
// 録音履歴
// ========================================
const WHISPER_HISTORY_KEY = 'whisper_history';
const WHISPER_HISTORY_MAX = 50;

function whisperLoadHistory() {
  try {
    return JSON.parse(localStorage.getItem(WHISPER_HISTORY_KEY) || '[]');
  } catch { return []; }
}

function whisperSaveHistory(transcript, karte, template) {
  const history = whisperLoadHistory();
  history.unshift({
    id: Date.now(),
    date: new Date().toLocaleString('ja-JP'),
    transcript: transcript,
    karte: karte,
    template,
  });
  // 上限超過分を削除
  if (history.length > WHISPER_HISTORY_MAX) history.length = WHISPER_HISTORY_MAX;
  localStorage.setItem(WHISPER_HISTORY_KEY, JSON.stringify(history));
}

function whisperDeleteHistory(id) {
  const history = whisperLoadHistory().filter(h => h.id !== id);
  localStorage.setItem(WHISPER_HISTORY_KEY, JSON.stringify(history));
  whisperRenderHistory();
}

function whisperClearHistory() {
  if (!confirm('録音履歴を全て削除しますか？')) return;
  localStorage.removeItem(WHISPER_HISTORY_KEY);
  whisperRenderHistory();
}

function whisperRestoreHistory(id) {
  const entry = whisperLoadHistory().find(h => h.id === id);
  if (!entry) return;
  document.getElementById('whisperBody').style.display = '';
  document.getElementById('whisperTranscript').value = entry.transcript;
  document.getElementById('whisperKarte').value = entry.karte;
  document.getElementById('whisperGenBtn').disabled = false;
  document.getElementById('whisperApplyBtn').disabled = false;
  whisperSetStatus(`履歴を復元しました (${entry.date})`, 'success');
}

function whisperRenderHistory(filter) {
  const container = document.getElementById('whisperHistoryList');
  if (!container) return;
  let history = whisperLoadHistory();
  if (filter) {
    const q = filter.toLowerCase();
    history = history.filter(h =>
      h.transcript.toLowerCase().includes(q) ||
      h.karte.toLowerCase().includes(q) ||
      h.date.includes(q)
    );
  }
  if (history.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:4px;">履歴なし</div>';
    return;
  }
  container.innerHTML = history.map(h => `
    <div class="whisper-history-item">
      <div class="whisper-history-meta">
        <span class="whisper-history-date">${escapeHtml(h.date)}</span>
        <span class="whisper-history-template">${escapeHtml(h.template)}</span>
        <button class="whisper-history-restore" onclick="whisperRestoreHistory(${h.id})" title="復元">復元</button>
        <button class="whisper-history-delete" onclick="whisperDeleteHistory(${h.id})" title="削除">&times;</button>
      </div>
      <div class="whisper-history-text">${escapeHtml(h.transcript.substring(0, 80))}${h.transcript.length > 80 ? '...' : ''}</div>
    </div>
  `).join('');
}

function whisperToggleHistoryPanel() {
  const panel = document.getElementById('whisperHistoryPanel');
  if (!panel) return;
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : '';
  if (!visible) whisperRenderHistory();
}

function whisperCopy(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  navigator.clipboard.writeText(el.value).then(() => {
    if (typeof showToast === 'function') showToast('コピーしました');
  });
}

// ページ読み込み時に初期化
document.addEventListener('DOMContentLoaded', () => {
  // カルテ画面に遷移した時に初期化する（遅延初期化）
  // すぐ呼んでもOK（マイク権限は録音時に要求）
  setTimeout(whisperInit, 1000);
});
