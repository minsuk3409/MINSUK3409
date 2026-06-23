// api/alert.mjs

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { region } = req.query;
  if (!region) return res.status(400).json({ error: 'region 파라미터가 필요합니다.' });

  const SERVICE_KEY = process.env.KMA_API_KEY; // ← KMA_API_KEY 사용

  const REGION_CODES = {
    '서울':  ['1100000000'],
    '경기':  ['4100000000'],
    '인천':  ['2300000000'],
    '충남':  ['4400000000', '3000000000'],
    '충북':  ['4300000000'],
    '전북':  ['4500000000'],
    '전남':  ['4600000000', '2900000000'],
    '강원':  ['4200000000'],
    '경북':  ['4700000000', '2700000000'],
    '경남':  ['4800000000', '2600000000', '3100000000'],
    '제주':  ['5000000000'],
  };

  const codes = REGION_CODES[region];
  if (!codes) return res.status(400).json({ type: 'none' });

  try {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const url = new URL('http://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList');
    url.searchParams.set('serviceKey', SERVICE_KEY);
    url.searchParams.set('pageNo', '1');
    url.searchParams.set('numOfRows', '100');
    url.searchParams.set('dataType', 'JSON');
    url.searchParams.set('fromTmFc', today + '0000');
    url.searchParams.set('toTmFc',   today + '2359');

    const apiRes = await fetch(url.toString());
    const json   = await apiRes.json();
    const items  = json?.response?.body?.items?.item ?? [];

    let alertType = 'none';
    
    // 반복문을 통해 모든 특보 목록을 전수 조사합니다.
    for (const item of items) {
      const isTargetRegion = codes.some(code =>
        String(item.stnId).startsWith(code.slice(0, 4))
      );
      if (!isTargetRegion) continue;

      const wrnText = String(item.wrn ?? '') + String(item.wrnVar ?? '');
      if (!wrnText.includes('폭염') && !wrnText.includes('열')) continue;

      const isActive = !item.tmCn;
      if (!isActive) continue;

      const lvl = String(item.wrnLvl ?? item.wrn ?? '');

      if (lvl.includes('중대경보')) { 
          alertType = 'critical'; 
          break; // 최고 단계가 나왔으므로 즉시 종료
      } else if (lvl.includes('경보')) { 
          alertType = 'warning'; 
      } else if (lvl.includes('주의보') && alertType !== 'warning') { 
          alertType = 'watch'; 
      }
    }

    // 최종 분석된 가장 높은 단계를 딱 한 번만 깔끔하게 반환합니다.
    return res.status(200).json({ type: alertType });

  } catch (err) {
    console.error('[alert] error:', err);
    return res.status(200).json({ type: 'none' });
  }
}
