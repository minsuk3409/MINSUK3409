// Vercel 서버리스 함수
// 브라우저 → 이 함수 → 기상청 API (CORS 우회)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { nx, ny, type } = req.query;
  const API_KEY = process.env.KMA_API_KEY;

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const pad = (n) => String(n).padStart(2, '0');
  
  const todayStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;

  // 1. 단일 실시간 실황 요청 (?type=current)
  if (type === 'current') {
    const hour = now.getMinutes() < 45 ? now.getHours() - 1 : now.getHours();
    const baseTime = `${pad(Math.max(hour, 0))}00`;
    
    const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?serviceKey=${API_KEY}&numOfRows=100&pageNo=1&dataType=JSON&base_date=${todayStr}&base_time=${baseTime}&nx=${nx}&ny=${ny}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      const items = data?.response?.body?.items?.item ?? [];
      
      const find = (cat) => items.find(i => i.category === cat)?.obsrValue;
      const temp = parseFloat(find('T1H') ?? 0);
      const humidity = parseFloat(find('REH') ?? 0);
      const wind = parseFloat(find('WSD') ?? 0);
      const pty = find('PTY') ?? '0';

      const feelsLike = calcFeelsLike(temp, humidity, wind);

      return res.status(200).json({ temp, feelsLike, humidity, wind, pty, baseDate: todayStr, baseTime });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // 2. [핵심] 오늘 전체 최고/최저 체감온도 요청 (?type=forecast)
  // 예보 데이터(새벽 2시 발표)와 지금까지의 실제 실황 데이터를 모두 수집해 합산 연산합니다.
  try {
    const allFeelsLikeValues = [];

    // [파트 A] 오늘 새벽 2시 기준 하루 전체 예보 데이터 긁어오기
    let fcstBaseDate = todayStr;
    let fcstBaseTime = '0200';
    
    // 새벽 0시 ~ 2시 15분 사이 예외 처리 (어제 23시 예보 활용)
    if (now.getHours() < 2 || (now.getHours() === 2 && now.getMinutes() < 15)) {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      fcstBaseDate = `${yesterday.getFullYear()}${pad(yesterday.getMonth() + 1)}${pad(yesterday.getDate())}`;
      fcstBaseTime = '2300';
    }

    const fcstUrl = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${API_KEY}&numOfRows=1000&pageNo=1&dataType=JSON&base_date=${fcstBaseDate}&base_time=${fcstBaseTime}&nx=${nx}&ny=${ny}`;
    const fcstRes = await fetch(fcstUrl);
    const fcstData = await fcstRes.json();
    const fcstItems = fcstData?.response?.body?.items?.item ?? [];

    const hourlyT = fcstItems.filter(i => i.category === 'TMP' && i.fcstDate === todayStr);
    const hourlyW = fcstItems.filter(i => i.category === 'WSD' && i.fcstDate === todayStr);
    const hourlyREH = fcstItems.filter(i => i.category === 'REH' && i.fcstDate === todayStr);

    hourlyT.forEach(t => {
      const time = t.fcstTime;
      const tmp = parseFloat(t.fcstValue);
      const wsd = parseFloat(hourlyW.find(w => w.fcstTime === time)?.fcstValue ?? 1);
      const reh = parseFloat(hourlyREH.find(r => r.fcstTime === time)?.fcstValue ?? 60);
      allFeelsLikeValues.push(calcFeelsLike(tmp, reh, wsd));
    });

    // [파트 B] 오늘 00시부터 현재 시간까지 매 시간 정시의 실제 [실황(실측) 데이터] 긁어와서 합치기
    // 기상청 초단기실황 API를 현재 지나간 시간만큼 반복 호출하여 실측 체감온도를 확보합니다.
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    const limitHour = currentMin < 45 ? currentHour - 1 : currentHour; // 실황 반영 가능 시간 체크

    const actualFetchPromises = [];
    for (let h = 0; h <= limitHour; h++) {
      const targetTime = `${pad(h)}00`;
      const actualUrl = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?serviceKey=${API_KEY}&numOfRows=50&pageNo=1&dataType=JSON&base_date=${todayStr}&base_time=${targetTime}&nx=${nx}&ny=${ny}`;
      
      actualFetchPromises.push(
        fetch(actualUrl)
          .then(r => r.json())
          .then(d => d?.response?.body?.items?.item ?? [])
          .catch(() => [])
      );
    }

    const actualResults = await Promise.all(actualFetchPromises);
    actualResults.forEach(items => {
      if (items.length > 0) {
        const find = (cat) => items.find(i => i.category === cat)?.obsrValue;
        const temp = parseFloat(find('T1H') ?? 0);
        const humidity = parseFloat(find('REH') ?? 0);
        const wind = parseFloat(find('WSD') ?? 0);
        if (find('T1H') !== undefined) {
          allFeelsLikeValues.push(calcFeelsLike(temp, humidity, wind));
        }
      }
    });

    // [마지막 단계] 예보값 + 오늘 실제 지나간 실황값 전체 중에서 진짜 최고/최저 추출
    const feelsMax = allFeelsLikeValues.length ? Math.max(...allFeelsLikeValues) : null;
    const feelsMin = allFeelsLikeValues.length ? Math.min(...allFeelsLikeValues) : null;

    const tmx = fcstItems.find(i => i.category === 'TMX' && i.fcstDate === todayStr)?.fcstValue;
    const tmn = items.find(i => i.category === 'TMN' && i.fcstDate === todayStr)?.fcstValue;

    return res.status(200).json({
      tempMax: parseFloat(tmx ?? 0),
      tempMin: parseFloat(tmn ?? 0),
      feelsMax: feelsMax ? Math.round(feelsMax * 10) / 10 : null,
      feelsMin: feelsMin ? Math.round(feelsMin * 10) / 10 : null,
      baseDate: todayStr,
      baseTime: fcstBaseTime,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// 기상청 표준 체감온도 계산 함수 공통화
function calcFeelsLike(temp, humidity, wind) {
  if (temp >= 10) {
    // 여름철 열지수 기반 체감온도 공식
    const hi = -8.784695 + 1.61139411 * temp + 2.338549 * (humidity / 100)
      - 0.14611605 * temp * (humidity / 100)
      - 0.01230809 * (temp ** 2)
      - 0.01642482 * ((humidity / 100) ** 2)
      + 0.00221173 * (temp ** 2) * (humidity / 100)
      + 0.00072546 * temp * ((humidity / 100) ** 2)
      - 0.00000358 * (temp ** 2) * ((humidity / 100) ** 2);
    return hi > temp ? hi : temp;
  } else {
    // 겨울철 체감온도 공식
    const v016 = Math.pow(wind * 3.6, 0.16);
    return 13.12 + 0.6215 * temp - 11.37 * v016 + 0.3965 * v016 * temp;
  }
}
