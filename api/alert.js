// api/alert.js  ← Vercel 프로젝트의 /api/ 폴더에 이 파일을 추가하세요
//
// 기상청 기상특보 조회서비스 (WthrWrnInfoService / getWthrWrnList)
// 공공데이터포털: https://www.data.go.kr/data/15000415/openapi.do
//
// 환경변수: WEATHER_API_KEY  (기존 날씨 API 키와 동일하게 사용 가능)
// 호출: GET /api/alert?region=서울

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { region } = req.query;
  if (!region) return res.status(400).json({ error: 'region 파라미터가 필요합니다.' });

  const SERVICE_KEY = process.env.WEATHER_API_KEY; // Vercel 환경변수

  // ── 권역 → 기상청 특보 지역 코드(stnId) 매핑 ───────────────────────
  // 기상청 WthrWrnInfoService 특보현황은 시·군 단위 178개 지역 코드 사용
  // 여기선 권역 대표 도시의 코드를 사용 (복수 코드로 OR 검색)
  // 코드 출처: 기상청 특보코드조회 API (getWthrWrnCode)
  const REGION_CODES = {
    '서울':  ['1100000000'],           // 서울특별시
    '경기':  ['4100000000'],           // 경기도
    '인천':  ['2300000000'],           // 인천광역시
    '충남':  ['4400000000', '3000000000'], // 충청남도 + 대전광역시
    '충북':  ['4300000000'],           // 충청북도
    '전북':  ['4500000000'],           // 전라북도
    '전남':  ['4600000000', '2900000000'], // 전라남도 + 광주광역시
    '강원':  ['4200000000'],           // 강원도
    '경북':  ['4700000000', '2700000000'], // 경상북도 + 대구광역시
    '경남':  ['4800000000', '2600000000', '3100000000'], // 경상남도 + 부산 + 울산
    '제주':  ['5000000000'],           // 제주특별자치도
  };

  const codes = REGION_CODES[region];
  if (!codes) return res.status(400).json({ error: `알 수 없는 권역: ${region}` });

  try {
    // 기상청 기상특보목록 조회 (현재 발효 중인 특보만)
    // pageNo=1, numOfRows=100으로 전체 특보 목록을 받아 필터링
    const url = new URL('http://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList');
    url.searchParams.set('serviceKey', SERVICE_KEY);
    url.searchParams.set('pageNo', '1');
    url.searchParams.set('numOfRows', '100');
    url.searchParams.set('dataType', 'JSON');
    // 오늘 날짜 기준 (YYYYMMDD)
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    url.searchParams.set('fromTmFc', today + '0000');
    url.searchParams.set('toTmFc',   today + '2359');

    const apiRes = await fetch(url.toString());
    const json   = await apiRes.json();

    const items = json?.response?.body?.items?.item ?? [];

    // ── 응답 필드 설명 ────────────────────────────────────────────────
    // wrnId   : 특보 ID
    // stnId   : 지역 코드 (예: "1100000000" = 서울)
    // wrnVar  : 특보 종류 (폭염 = "열")  ← "폭염" 또는 한자/코드로 올 수 있음
    // wrnLvl  : 특보 수준 ("주의보" / "경보")
    // wrn     : 특보 명칭 전체 (예: "폭염주의보", "폭염경보")
    // tmEf    : 발효시간
    // tmCn    : 해제시간 (발효 중이면 비어있음)
    // ─────────────────────────────────────────────────────────────────

    // 해당 권역 & 폭염 특보만 필터
    let alertType = 'none';
    for (const item of items) {
      const isTargetRegion = codes.some(code => String(item.stnId).startsWith(code.slice(0, 4)));
      if (!isTargetRegion) continue;

      const wrnText = String(item.wrn ?? '') + String(item.wrnVar ?? '');
      const isHeat  = wrnText.includes('폭염') || wrnText.includes('열');
      if (!isHeat) continue;

      const isActive = !item.tmCn; // 해제시간 없으면 현재 발효 중
      if (!isActive) continue;

      const lvl = String(item.wrnLvl ?? item.wrn ?? '');
      if (lvl.includes('경보')) {
        alertType = 'warning'; // 경보가 최우선
        break;
      } else if (lvl.includes('주의보')) {
        alertType = 'watch';   // 주의보는 경보가 없을 때
      }
    }

    return res.status(200).json({ type: alertType });

  } catch (err) {
    console.error('[alert] 기상특보 API 오류:', err);
    // 오류 시 null 반환 → 프론트에서 배지 숨김 처리
    return res.status(200).json({ type: 'none' });
  }
}
