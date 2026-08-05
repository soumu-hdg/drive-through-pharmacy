/**
 * プロンプト一覧取得API
 * GET /api/prompts
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const prompts = (await import('../prompts_data.js')).default;
  const list = Object.entries(prompts).map(([id, val]) => ({
    id,
    name: val.name,
    prompt: val.prompt,
  }));

  return res.status(200).json({ prompts: list });
}
