// Vercel 서버리스 함수
// 브라우저 → 이 함수 → 기상청 API (CORS 우회)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { nx, ny, type, curFeels } = req.query; 
  // curFeels: 프론트엔드가 실시간으로 넘겨주는 현재 실황 체감온도 값 (옵션)

  const API_KEY = process.env.KMA_API_KEY;

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const pad = (n) => String(n).padStart(2, '0');
  
  let baseDate = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  let baseTime, endpoint;
  let numOfRows = '100';

  if (type === 'current') {
    // 1. 초단기실황 처리
    const hour = now.getMinutes() < 45 ? now.getHours() - 1 : now.getHours();
    baseTime = `${pad(Math.max(hour, 0))}00`;
    endpoint = 'getUltraSrtNcst';
  } else {
    // 2. 단기예보 처리: 대낮의 과거 정보 유실을 막기 위해 오늘 최초 발표 시각인 새벽 2시(0200)로 강제 고정
    const h = now.getHours();
    if (h < 2 || (h === 2 && now.getMinutes() < 15)) {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      baseDate = `${yesterday.getFullYear()}${pad(yesterday.getMonth() + 1)}${pad(yesterday.getDate())}`;
      baseTime = '2300';
    } else {
      baseTime = '0200'; // ★ 오늘 하루치 24시간 예측 데이터를 통째로 당겨오기 위해 고정
    }
    endpoint = 'getVilageFcst';
    numOfRows = '1000'; // 하루치 전체 카테고리 데이터 확보용
  }

  const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/${endpoint}?serviceKey=${API_KEY}&numOfRows=${numOfRows}&pageNo=1&dataType=JSON&base_date=${baseDate}&base_time=${baseTime}&nx=${nx}&ny=${ny}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    const items = data?.response?.body?.items?.item ?? [];

    if (type === 'current') {
      const find = (cat) => items.find(i => i.category === cat)?.obsrValue;
      const temp     = parseFloat(find('T1H') ?? 0);
      const humidity = parseFloat(find('REH') ?? 0);
      const wind     = parseFloat(find('WSD') ?? 0);
      const pty      = find('PTY') ?? '0';

      const feelsLike = calcFeelsLike(temp, humidity, wind);

      return res.status(200).json({
        temp,
        feelsLike,
        humidity,
        wind,
        pty,
        baseDate,
        baseTime,
      });
    } else {
      // [단기예보 최종 연산 부문]
      const today = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const tmx = items.find(i => i.category === 'TMX' && i.fcstDate === today)?.fcstValue;
      const tmn = items.find(i => i.category === 'TMN' && i.fcstDate === today)?.fcstValue;

      const hourlyT   = items.filter(i => i.category === 'TMP'  && i.fcstDate === today);
      const hourlyW   = items.filter(i => i.category === 'WSD'  && i.fcstDate === today);
      const hourlyREH = items.filter(i => i.category === 'REH'  && i.fcstDate === today);

      const allFeelsLikeValues = [];

      // 프론트엔드에서 현재 측정된 실시간 실측 체감온도를 받아왔다면 바구니에 먼저 탑승시킵니다.
      if (curFeels) {
        allFeelsLikeValues.push(parseFloat(curFeels));
      }

      // 오늘 하루 전체 시간대(00시~24시) 예보 데이터 연산 후 바구니에 삽입
      hourlyT.forEach(t => {
        const time = t.fcstTime;
        const tmp  = parseFloat(t.fcstValue);
        const wsd  = parseFloat(hourlyW.find(w => w.fcstTime === time)?.fcstValue ?? 1);
        const reh  = parseFloat(hourlyREH.find(r => r.fcstTime === time)?.fcstValue ?? 60);
        allFeelsLikeValues.push(calcFeelsLike(tmp, reh, wsd));
      });

      // 예보값 24개와 실시간 실측 체감온도 값 중 단 하나의 진정한 최고/최저를 뽑아냅니다.
      const feelsMax = allFeelsLikeValues.length ? Math.max(...allFeelsLikeValues) : null;
      const feelsMin = allFeelsLikeValues.length ? Math.min(...allFeelsLikeValues) : null;

      return res.status(200).json({
        tempMax: parseFloat(tmx ?? 0),
        tempMin: parseFloat(tmn ?? 0),
        feelsMax: feelsMax ? Math.round(feelsMax * 10) / 10 : null,
        feelsMin: feelsMin ? Math.round(feelsMin * 10) / 10 : null,
        baseDate,
        baseTime,
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// 체감온도 계산용 공통 함수
function calcFeelsLike(temp, humidity, wind) {
  if (temp >= 10) {
    const hi = -8.784695 + 1.61139411 * temp + 2.338549 * (humidity / 100)
      - 0.14611605 * temp * (humidity / 100)
      - 0.01230809 * (temp ** 2)
      - 0.01642482 * ((humidity / 100) ** 2)
      + 0.00221173 * (temp ** 2) * (humidity / 100)
      + 0.00072546 * temp * ((humidity / 100) ** 2)
      - 0.00000358 * (temp ** 2) * ((humidity / 100) ** 2);
    return hi > temp ? hi : temp;
  } else {
    const v016 = Math.pow(wind * 3.6, 0.16);
    return 13.12 + 0.6215 * temp - 11.37 * v016 + 0.3965 * v016 * temp;
  }
}
