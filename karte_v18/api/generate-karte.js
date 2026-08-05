/**
 * カルテ生成API (Vercel Serverless Function)
 * Anthropic Claude API で文字起こしテキストからSOAP形式カルテを生成
 * POST /api/generate-karte  JSON { transcript, template, memo, customPrompt }
 */

export const config = { maxDuration: 30 };

// 個人情報マスキング
function maskPersonalInfo(text) {
  let t = text;
  t = t.replace(/0\d{1,4}-\d{1,4}-\d{4}/g, '[電話番号]');
  t = t.replace(/0\d{9,10}/g, '[電話番号]');
  t = t.replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, '[メール]');
  t = t.replace(/(.{2,3}[都道府県])(.{1,6}[市区町村郡])/g, '[住所]');
  t = t.replace(/〒?\d{3}-?\d{4}/g, '[郵便番号]');
  t = t.replace(/(昭和|平成|令和)\d{1,2}年\d{1,2}月\d{1,2}日/g, '[生年月日]');
  t = t.replace(/(19|20)\d{2}年\d{1,2}月\d{1,2}日/g, '[生年月日]');
  t = t.replace(/(19|20)\d{2}\/\d{1,2}\/\d{1,2}/g, '[生年月日]');
  return t;
}

// 相対日付→具体日付変換
function convertRelativeDates(text) {
  const today = new Date();
  const fmt = (d) => `${d.getMonth()+1}/${d.getDate()}`;
  const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate()-n); return fmt(d); };
  const weeksAgo = (n) => { const d = new Date(today); d.setDate(d.getDate()-n*7); return fmt(d)+'頃'; };
  const monthsAgo = (n) => { const d = new Date(today); d.setMonth(d.getMonth()-n); return `${d.getMonth()+1}月頃`; };

  let r = text;
  r = r.replace(/(\d+)\s*日前/g, (_, n) => daysAgo(parseInt(n)));
  r = r.replace(/(\d+)\s*週間前/g, (_, n) => weeksAgo(parseInt(n)));
  r = r.replace(/(\d+)\s*ヶ月前/g, (_, n) => monthsAgo(parseInt(n)));
  r = r.replace(/一昨日|おととい/g, daysAgo(2));
  r = r.replace(/昨日/g, daysAgo(1));
  r = r.replace(/今日/g, daysAgo(0));
  r = r.replace(/今朝/g, `${today.getMonth()+1}/${today.getDate()}朝`);
  r = r.replace(/先週/g, weeksAgo(1));
  r = r.replace(/先月/g, monthsAgo(1));
  return r;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const { transcript, template, memo, customPrompt } = req.body || {};

    if (!transcript) {
      return res.status(400).json({ error: '文字起こしデータがありません' });
    }

    // マスキング
    const masked = maskPersonalInfo(transcript);

    // プロンプト選択
    let prompt;
    if (customPrompt) {
      prompt = customPrompt;
    } else {
      const prompts = (await import('../prompts_data.js')).default;
      const pd = prompts[template] || prompts['karte'] || {};
      prompt = pd.prompt || '';
    }

    // コンテンツ組み立て
    let content = prompt;
    if (memo) {
      content += `\n\n【事前情報・診察メモ】\n${memo}\n\n【音声文字起こし】\n`;
    }
    content += masked;

    // Claude API呼び出し
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Claude API error:', claudeRes.status, errText);
      return res.status(502).json({ error: `Claude API error: ${claudeRes.status}` });
    }

    const result = await claudeRes.json();
    let karte = result.content?.[0]?.text || '';

    // 相対日付変換
    karte = convertRelativeDates(karte);

    return res.status(200).json({ success: true, karte });

  } catch (e) {
    console.error('Generate karte error:', e);
    return res.status(500).json({ error: e.message });
  }
}
