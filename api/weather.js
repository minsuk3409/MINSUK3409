// Vercel 서버리스 함수
// 브라우저 → 이 함수 → 기상청 API (CORS 우회)

export default async function handler(req, res) {
  // CORS 허용 (내 GitHub Pages 도메인에서 호출 가능하게)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { nx, ny, type } = req.query;
  // type: 'current' (초단기실황) or 'forecast' (단기예보)

  const API_KEY = process.env.KMA_API_KEY; // Vercel 환경변수에서 가져옴

  // 현재 시각 기반으로 발표시각 계산
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const pad = (n) => String(n).padStart(2, '0');
  
  let baseDate = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  let baseTime, endpoint;
  let numOfRows = '100';

  if (type === 'current') {
    // 초단기실황: 매시 40분 이후 호출 가능, 정각 기준
    const hour = now.getMinutes() < 45 ? now.getHours() - 1 : now.getHours();
    baseTime = `${pad(Math.max(hour, 0))}00`;
    endpoint = 'getUltraSrtNcst';
  } else {
    // 단기예보: 0200,0500,0800,1100,1400,1700,2000,2300 발표
    const FCST_TIMES = [2, 5, 8, 11, 14, 17, 20, 23];
    const h = now.getHours();
    
    // 만약 현재 시각이 0시~1시 사이라면 baseDate는 어제가 되어야 23시 발표 데이터를 가져옴
    if (h === 0 || (h === 1 && now.getMinutes() < 10)) {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      baseDate = `${yesterday.getFullYear()}${pad(yesterday.getMonth() + 1)}${pad(yesterday.getDate())}`;
      baseTime = '2300';
    } else {
      const latest = FCST_TIMES.filter(t => t <= h - 1).pop() ?? 23;
      baseTime = `${pad(latest)}00`;
    }
    
    endpoint = 'getVilageFcst';
    numOfRows = '500'; // ★ 하루치 데이터(24시간 * 항목들)를 잘림 없이 다 가져오기 위해 크게 확장
  }

  const url = new URL(
    `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/${endpoint}`
  );
  url.searchParams.set('serviceKey', API_KEY);
  url.searchParams.set('numOfRows', numOfRows);
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('dataType', 'JSON');
  url.searchParams.set('base_date', baseDate);
  url.searchParams.set('base_time', baseTime);
  url.searchParams.set('nx', nx);
  url.searchParams.set('ny', ny);

  try {
    const response = await fetch(url.toString());
    const data = await response.json();

    const items = data?.response?.body?.items?.item ?? [];

    if (type === 'current') {
      // 초단기실황: T1H(기온), REH(습도), WSD(풍속), PTY(강수형태)
      const find = (cat) => items.find(i => i.category === cat)?.obsrValue;
      const temp     = parseFloat(find('T1H') ?? 0);
      const humidity = parseFloat(find('REH') ?? 0);
      const wind     = parseFloat(find('WSD') ?? 0);
      const pty      = find('PTY') ?? '0';

      let feelsLike;
      if (temp >= 10) {
        const hi = -8.784695 + 1.61139411 * temp + 2.338549 * (humidity / 100)
          - 0.14611605 * temp * (humidity / 100)
          - 0.01230809 * (temp ** 2)
          - 0.01642482 * ((humidity / 100) ** 2)
          + 0.00221173 * (temp ** 2) * (humidity / 100)
          + 0.00072546 * temp * ((humidity / 100) ** 2)
          - 0.00000358 * (temp ** 2) * ((humidity / 100) ** 2);
        feelsLike = hi > temp ? Math.round(hi * 10) / 10 : temp;
      } else {
        const v016 = Math.pow(wind * 3.6, 0.16);
        feelsLike = Math.round((13.12 + 0.6215 * temp - 11.37 * v016 + 0.3965 * v016 * temp) * 10) / 10;
      }

      res.status(200).json({
        temp,
        feelsLike,
        humidity,
        wind,
        pty,
        baseDate,
        baseTime,
      });
    } else {
      // 단기예보: 오늘의 최고(TMX)/최저(TMN) 기온
      // 항상 '오늘' 기준의 하루 최고/최저 체감온도를 구하기 위해 targetDate를 오늘 날짜로 명시
      const targetDate = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      
      const tmx = items.find(i => i.category === 'TMX' && i.fcstDate === targetDate)?.fcstValue;
      const tmn = items.find(i => i.category === 'TMN' && i.fcstDate === targetDate)?.fcstValue;

      // 오늘 하루(00시~24시)에 해당하는 시간별 기온·풍속·습도 추출
      const hourlyT   = items.filter(i => i.category === 'TMP'  && i.fcstDate === targetDate);
      const hourlyW   = items.filter(i => i.category === 'WSD'  && i.fcstDate === targetDate);
      const hourlyREH = items.filter(i => i.category === 'REH'  && i.fcstDate === targetDate);

      let feelsMax = -999, feelsMin = 999;
      hourlyT.forEach(t => {
        const time = t.fcstTime;
        const tmp  = parseFloat(t.fcstValue);
        const wsd  = parseFloat(hourlyW.find(w => w.fcstTime === time)?.fcstValue ?? 1);
        const reh  = parseFloat(hourlyREH.find(r => r.fcstTime === time)?.fcstValue ?? 60);
        let fl;
        if (tmp >= 10) {
          const hi = -8.784695 + 1.61139411 * tmp + 2.338549 * (reh / 100)
            - 0.14611605 * tmp * (reh / 100)
            - 0.01230809 * (tmp ** 2)
            - 0.01642482 * ((reh / 100) ** 2)
            + 0.00221173 * (tmp ** 2) * (reh / 100)
            + 0.00072546 * tmp * ((reh / 100) ** 2)
            - 0.00000358 * (tmp ** 2) * ((reh / 100) ** 2);
          fl = hi > tmp ? hi : tmp;
        } else {
          const v016 = Math.pow(wsd * 3.6, 0.16);
          fl = 13.12 + 0.6215 * tmp - 11.37 * v016 + 0.3965 * v016 * tmp;
        }
        if (fl > feelsMax) feelsMax = fl;
        if (fl < feelsMin) feelsMin = fl;
      });

      res.status(200).json({
        tempMax: parseFloat(tmx ?? 0),
        tempMin: parseFloat(tmn ?? 0),
        feelsMax: feelsMax === -999 ? null : Math.round(feelsMax * 10) / 10,
        feelsMin: feelsMin === 999  ? null : Math.round(feelsMin * 10) / 10,
        baseDate,
        baseTime,
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
