const DISPLAY_REGIONS = ['서울','경기','인천','강원','충북','충남','대전','경북','대구','경남','부산','울산','전북','전남','광주','제주'];
const SOURCE_REGION = { 대전:'충남', 대구:'경북', 부산:'경남', 울산:'경남', 광주:'전남' };
const dashboardState = {
  weather: {},
  alerts: {},
  selectedRegion: null,
  selectedSite: null,
  mode: 'now',
  geojson: null,
};

function allSites() {
  return Object.entries(SITES).flatMap(([region, sites]) => sites.map((site, index) => ({ ...site, region, index })));
}

function sitesForDisplayRegion(region) {
  const source = SOURCE_REGION[region] || region;
  const sites = (SITES[source] || []).map((site, index) => ({ ...site, region: source, index }));
  if (region === '대전') return sites.filter(s => s.addr.includes('대전'));
  if (region === '대구') return sites.filter(s => s.addr.includes('대구'));
  if (region === '부산') return sites.filter(s => s.addr.includes('부산'));
  if (region === '울산') return sites.filter(s => s.addr.includes('울산'));
  if (region === '광주') return sites.filter(s => s.addr.includes('광주'));
  if (region === '충남') return sites.filter(s => !s.addr.includes('대전'));
  if (region === '경북') return sites.filter(s => !s.addr.includes('대구'));
  if (region === '경남') return sites.filter(s => !s.addr.includes('부산') && !s.addr.includes('울산'));
  if (region === '전남') return sites.filter(s => !s.addr.includes('광주'));
  return sites;
}

function displayRegionForSite(site) {
  if (site.addr.includes('대전')) return '대전';
  if (site.addr.includes('대구')) return '대구';
  if (site.addr.includes('부산')) return '부산';
  if (site.addr.includes('울산')) return '울산';
  if (site.addr.includes('광주')) return '광주';
  return site.region;
}

function weatherFor(region) { return dashboardState.weather[SOURCE_REGION[region] || region] || null; }
function alertFor(region) { return dashboardState.alerts[SOURCE_REGION[region] || region] || { type:'none' }; }
function fmt(value, unit='') { return value == null || Number.isNaN(Number(value)) ? '-' : `${value}${unit}`; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }

function metricCard(label, value='-', sub='', color='#176fd1') {
  return `<article class="metric-card">
    <span class="metric-label">${label}</span>
    <span class="metric-gauge" style="--fill:${color}"></span>
    <strong class="metric-value" style="color:${color}">${value}</strong>
    <small class="metric-sub">${sub}</small>
  </article>`;
}

function renderWeatherMetrics(targetId, data, siteName='') {
  const target = document.getElementById(targetId);
  if (!target) return;
  if (!data) {
    target.innerHTML = [
      metricCard('강수','-','1시간 강수량'), metricCard('온도','-','℃','#f59e0b'), metricCard('습도','-','%','#16a34a'),
      metricCard('체감온도','-','현장 선택','#8b8f96'), metricCard('풍속','-','m/s'), metricCard('풍향','-','방위'),
      metricCard('미세먼지 PM10','-','㎍/㎥','#8b8f96'), metricCard('미세먼지 PM2.5','-','㎍/㎥','#8b8f96')
    ].join('');
    return;
  }
  const cur = data.cur || {};
  const fcst = data.fcst || {};
  const feels = cur.feelsLike ?? cur.temp;
  const meta = tempMeta(Number(feels ?? 0));
  const isForecast = dashboardState.mode === 'forecast';
  const forecastTempMax = fcst.tomorrowTempMax ?? fcst.tempMax;
  const forecastTempMin = fcst.tomorrowTempMin ?? fcst.tempMin;
  const forecastFeelsMax = fcst.tomorrowFeelsMax ?? fcst.feelsMax;
  const forecastFeelsMin = fcst.tomorrowFeelsMin ?? fcst.feelsMin;
  const tempValue = isForecast ? fmt(forecastTempMax, '℃') : fmt(cur.temp, '℃');
  const feelsValue = isForecast ? fmt(forecastFeelsMax, '℃') : fmt(feels, '℃');
  const tempSub = isForecast ? `최저 ${fmt(forecastTempMin,'℃')}` : ptyDesc(cur.pty);
  const feelsSub = isForecast ? `최저 ${fmt(forecastFeelsMin,'℃')}` : meta.label;
  target.innerHTML = [
    metricCard('강수', cur.pty === '0' ? '없음' : ptyDesc(cur.pty), isForecast ? '예보 기준' : '현재 상태', '#2d8fda'),
    metricCard(isForecast ? '내일 온도' : '온도', tempValue, tempSub, '#f59e0b'),
    metricCard('습도', fmt(cur.humidity,'%'), '상대습도', '#16a34a'),
    metricCard(isForecast ? '내일 최고 체감' : '체감온도', feelsValue, feelsSub, meta.color),
    metricCard('풍속', fmt(cur.wind,'m/s'), '현재 풍속', '#2d8fda'),
    metricCard('풍향', '-', '수집 준비중', '#8b8f96'),
    metricCard('미세먼지 PM10', '-', '수집 준비중', '#8b8f96'),
    metricCard('미세먼지 PM2.5', '-', '수집 준비중', '#8b8f96')
  ].join('');
  if (siteName) target.setAttribute('aria-label', `${siteName} 기상정보`);
}

function alertLabel(type) {
  return { critical:'폭염중대경보', warning:'폭염경보', watch:'폭염주의보', none:'특보 미발효' }[type] || '특보 미발효';
}

function buildBreakdown(type) {
  const counts = DISPLAY_REGIONS.map(region => {
    const sourceAlert = alertFor(region).type;
    const matched = type === 'warning'
      ? ['warning','critical'].includes(sourceAlert)
      : sourceAlert === type;
    return [region, matched ? sitesForDisplayRegion(region).length : 0];
  }).filter(([, count]) => count > 0);
  return counts.length ? counts.map(([r,c]) => `${r} ${c}`).join('　') : '발효 지역 없음';
}

function renderHeadquarters() {
  const sites = allSites();
  const alertSites = sites.filter(site => alertFor(site.region).type !== 'none').length;
  const dangerSites = sites.filter(site => {
    const w = weatherFor(site.region);
    return Number(w?.cur?.feelsLike ?? -99) >= 35;
  }).length;
  document.getElementById('totalSiteCount').textContent = `${sites.length}개`;
  document.getElementById('alertSiteCount').textContent = `${alertSites}개`;
  document.getElementById('dangerSiteCount').textContent = `${dangerSites}개`;

  const rows = [
    ['폭염경보','warning'], ['폭염주의보','watch'], ['호우주의보','rain'],
    ['강풍주의보','wind'], ['풍랑주의보','wave'], ['건조주의보','dry']
  ];
  document.getElementById('alertSummaryRows').innerHTML = rows.map(([name,type]) => {
    const count = type === 'warning'
      ? sites.filter(s => ['warning','critical'].includes(alertFor(s.region).type)).length
      : type === 'watch' ? sites.filter(s => alertFor(s.region).type === 'watch').length : 0;
    const detail = ['warning','watch'].includes(type) ? buildBreakdown(type) : '발효 지역 없음';
    return `<article class="alert-row"><div class="alert-name"><span>${name}</span><b>${count}개</b></div><div class="alert-breakdown">${detail}</div></article>`;
  }).join('');

  const divisions = ['건축사업본부','토목사업본부','플랜트사업본부','글로벌인프라본부'];
  const grouped = Object.fromEntries(divisions.map(name => [name, []]));
  sites.forEach(site => grouped[classifyDivision(site)].push(site));
  document.getElementById('divisionTableBody').innerHTML = divisions.map(name => {
    const list = grouped[name];
    const special = list.filter(site => alertFor(site.region).type !== 'none').length;
    const danger = list.filter(site => Number(weatherFor(site.region)?.cur?.feelsLike ?? -99) >= 35).length;
    return `<tr><td>${name}</td><td>${list.length}개</td><td>${special}개</td><td>${danger}개</td></tr>`;
  }).join('');
}

function classifyDivision(site) {
  const civil = /(고속도로|철도|GTX|도로|터널|항만|방파|호안|산업단지|댐|공구|기반시설|비행장|매립장)/;
  const plant = /(발전|원전|데이터센터|연구용원자로|터미널|전기시설|급유시설)/;
  if (plant.test(site.name)) return '플랜트사업본부';
  if (civil.test(site.name)) return '토목사업본부';
  return '건축사업본부';
}

function renderRegionTabs() {
  const html = DISPLAY_REGIONS.map(region => `<button type="button" class="region-tab${dashboardState.selectedRegion===region?' active':''}" data-region="${region}">${region}</button>`).join('');
  ['regionTabs','siteRegionTabs'].forEach(id => {
    const nav = document.getElementById(id);
    nav.innerHTML = html;
    nav.querySelectorAll('.region-tab').forEach(btn => btn.addEventListener('click', () => openRegionSites(btn.dataset.region)));
  });
}

function openRegionSites(region) {
  dashboardState.selectedRegion = region;
  renderRegionTabs();
  const sites = sitesForDisplayRegion(region);
  document.getElementById('modal-title').textContent = `${region} 지역 · 현장 ${sites.length}개`;
  document.getElementById('modal-body').innerHTML = sites.length ? `<ul class="site-list">${sites.map(site => `
    <li class="site-item" data-region="${escapeHtml(site.region)}" data-index="${site.index}">
      <div class="site-name">${escapeHtml(site.name)}</div><div class="site-addr">${escapeHtml(site.addr)}</div>
    </li>`).join('')}</ul>` : '<div class="sw-loading">등록된 현장이 없습니다.</div>';
  document.querySelectorAll('#modal-body .site-item').forEach(item => item.addEventListener('click', () => {
    const site = SITES[item.dataset.region][Number(item.dataset.index)];
    selectSite({ ...site, region:item.dataset.region, index:Number(item.dataset.index) });
    closeModalDirect();
  }));
  document.getElementById('modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

openModal = function(regionName) { openRegionSites(regionName); };
showSiteWeather = function(regionName, siteIndex) {
  selectSite({ ...SITES[regionName][siteIndex], region:regionName, index:siteIndex });
  closeModalDirect();
};

async function selectSite(site) {
  dashboardState.selectedSite = site;
  dashboardState.selectedRegion = displayRegionForSite(site);
  document.getElementById('headquartersView').hidden = true;
  document.getElementById('siteView').hidden = false;
  document.getElementById('selectedSiteLabel').textContent = site.name;
  document.getElementById('siteNameHeading').textContent = site.name;
  document.getElementById('siteSearchInput').value = site.name;
  renderRegionTabs();
  updateMarkerSelection();

  const regionDef = REGIONS.find(r => r.name === site.region);
  const coords = SITE_COORDS[site.name] || { nx:regionDef.nx, ny:regionDef.ny };
  renderWeatherMetrics('bottomWeatherMetrics', null, site.name);
  renderWeatherMetrics('siteWeatherMetrics', null, site.name);
  document.getElementById('siteAlertStatus').innerHTML = '<div class="status-copy"><strong>기상정보 확인 중</strong><p>선택 현장의 정보를 불러오고 있습니다.</p></div>';
  const [data, alert] = await Promise.all([fetchWeather(coords.nx, coords.ny), fetchAlert(site.region)]);
  site.liveWeather = data;
  site.liveAlert = alert || { type:'none' };
  renderWeatherMetrics('bottomWeatherMetrics', data, site.name);
  renderWeatherMetrics('siteWeatherMetrics', data, site.name);
  renderSiteAlert(site.liveAlert);
}

function renderSiteAlert(alert) {
  const type = alert?.type || 'none';
  const status = document.getElementById('siteAlertStatus');
  if (type === 'none') {
    status.innerHTML = '<span class="status-check">✓</span><div class="status-copy"><strong>발효 중인 특보가 없습니다</strong><p>현재 선택 현장에 발효 중인 기상특보가 없습니다.</p></div>';
  } else {
    status.innerHTML = `<span class="status-check" style="background:#e53935">!</span><div class="status-copy"><strong class="alerting">${alertLabel(type)} 발효</strong><p>안전관리 기준에 따라 작업계획을 확인해 주세요.</p></div>`;
  }
}

function showHeadquarters() {
  dashboardState.selectedSite = null;
  dashboardState.selectedRegion = null;
  document.getElementById('headquartersView').hidden = false;
  document.getElementById('siteView').hidden = true;
  document.getElementById('selectedSiteLabel').textContent = '현장을 선택하세요';
  document.getElementById('siteSearchInput').value = '';
  renderWeatherMetrics('bottomWeatherMetrics', null);
  renderRegionTabs();
  updateMarkerSelection();
}

function populateSearch() {
  document.getElementById('siteSearchList').innerHTML = allSites().map(site => `<option value="${escapeHtml(site.name)}">${escapeHtml(site.addr)}</option>`).join('');
}

function runSearch() {
  const query = document.getElementById('siteSearchInput').value.trim().toLowerCase();
  if (!query) return;
  const sites = allSites();
  const exact = sites.find(site => site.name.toLowerCase() === query);
  if (exact) return selectSite(exact);
  const matches = sites.filter(site => site.name.toLowerCase().includes(query) || site.addr.toLowerCase().includes(query));
  document.getElementById('modal-title').textContent = `현장명 검색 · ${matches.length}개`;
  document.getElementById('modal-body').innerHTML = matches.length ? `<ul class="site-list">${matches.map(site => `<li class="site-item" data-region="${site.region}" data-index="${site.index}"><div class="site-name">${escapeHtml(site.name)}</div><div class="site-addr">${escapeHtml(site.addr)}</div></li>`).join('')}</ul>` : '<div class="sw-loading">검색 결과가 없습니다.</div>';
  document.querySelectorAll('#modal-body .site-item').forEach(item => item.addEventListener('click', () => {
    const site = SITES[item.dataset.region][Number(item.dataset.index)];
    selectSite({ ...site, region:item.dataset.region, index:Number(item.dataset.index) });
    closeModalDirect();
  }));
  document.getElementById('modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

initMap = function(geojson) {
  dashboardState.geojson = geojson;
  const W = 720, H = 600;
  const projection = d3.geoMercator().fitExtent([[70,22],[650,578]], geojson);
  const path = d3.geoPath().projection(projection);
  document.getElementById('korea-map').innerHTML = '';
  mapSvg = d3.select('#korea-map').append('svg').attr('viewBox',`0 0 ${W} ${H}`).attr('preserveAspectRatio','xMidYMid meet');
  mapSvg.selectAll('path').data(geojson.features).enter().append('path')
    .attr('d',path).attr('fill','#eef4f7').attr('stroke','#6fa2c1').attr('stroke-width',1.4)
    .attr('class',d => `map-region region-${REGION_NAME_MAP[d.properties.name] || ''}`)
    .on('click',(event,d) => { const region = REGION_NAME_MAP[d.properties.name]; if (region) openRegionSites(region); })
    .on('mouseover',function(){ d3.select(this).attr('opacity',.75); })
    .on('mouseout',function(){ d3.select(this).attr('opacity',1); });

  const centroids = {};
  geojson.features.forEach(feature => {
    const region = REGION_NAME_MAP[feature.properties.name];
    if (region && !centroids[region]) centroids[region] = path.centroid(feature);
  });
  allSites().forEach((site, index) => {
    const center = centroids[site.region];
    if (!center || !Number.isFinite(center[0])) return;
    const local = site.index;
    const angle = local * 2.399963 + index * .03;
    const radius = 4 + Math.sqrt(local) * 4.1;
    const x = center[0] + Math.cos(angle) * radius;
    const y = center[1] + Math.sin(angle) * radius;
    const marker = mapSvg.append('g').attr('class','site-marker').attr('data-site',site.name).attr('transform',`translate(${x},${y})`)
      .on('click',(event) => { event.stopPropagation(); selectSite(site); });
    marker.append('circle').attr('r',5);
    marker.append('title').text(site.name);
  });
  updateMapAlerts();
  updateMarkerSelection();
};

function updateMapAlerts() {
  if (!mapSvg) return;
  REGIONS.forEach(region => {
    const type = alertFor(region.name).type;
    mapSvg.selectAll(`.region-${region.name}`).attr('fill', ALERT_FILL[type] || '#eef4f7').attr('stroke', ALERT_STROKE[type] || '#6fa2c1');
    if (type !== 'none') mapSvg.selectAll('.site-marker').filter(function(d){ return d3.select(this).attr('data-site') && (SITES[region.name]||[]).some(s => s.name === d3.select(this).attr('data-site')); }).classed('is-alert',true);
  });
}

function updateMarkerSelection() {
  if (!mapSvg) return;
  mapSvg.selectAll('.site-marker').classed('is-selected',function(){ return dashboardState.selectedSite?.name === d3.select(this).attr('data-site'); });
}

loadAll = async function() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  document.getElementById('mapLoading').hidden = false;
  try {
    if (!dashboardState.geojson) {
      const response = await fetch('skorea_provinces_geo_simple.json');
      if (!response.ok) throw new Error('지도 데이터를 불러오지 못했습니다.');
      initMap(await response.json());
    }
    await Promise.all(REGIONS.map(async region => {
      const [weather, alert] = await Promise.all([fetchWeather(region.nx,region.ny),fetchAlert(region.name)]);
      dashboardState.weather[region.name] = weather;
      dashboardState.alerts[region.name] = alert || { type:'none' };
    }));
    const now = new Date();
    document.getElementById('updated').textContent = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    renderHeadquarters();
    updateMapAlerts();
    if (dashboardState.selectedSite?.liveWeather) {
      renderWeatherMetrics('bottomWeatherMetrics',dashboardState.selectedSite.liveWeather,dashboardState.selectedSite.name);
      renderWeatherMetrics('siteWeatherMetrics',dashboardState.selectedSite.liveWeather,dashboardState.selectedSite.name);
    }
  } catch (error) {
    console.error(error);
    document.getElementById('mapLoading').textContent = '일부 기상정보를 불러오지 못했습니다.';
  } finally {
    btn.disabled = false;
    if (Object.keys(dashboardState.weather).length) document.getElementById('mapLoading').hidden = true;
  }
};

document.querySelectorAll('.season-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.season-btn').forEach(item => item.classList.toggle('active',item === btn));
}));
document.querySelectorAll('.forecast-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.forecast-btn').forEach(item => item.classList.toggle('active',item === btn));
  dashboardState.mode = btn.dataset.mode;
  const data = dashboardState.selectedSite?.liveWeather || null;
  renderWeatherMetrics('bottomWeatherMetrics',data,dashboardState.selectedSite?.name || '');
  if (dashboardState.selectedSite) renderWeatherMetrics('siteWeatherMetrics',data,dashboardState.selectedSite.name);
}));
document.getElementById('fullscreenBtn').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
document.getElementById('siteBackBtn').addEventListener('click', showHeadquarters);
document.getElementById('mapResetBtn').addEventListener('click', showHeadquarters);
document.getElementById('mapHomeBtn').addEventListener('click', showHeadquarters);
document.getElementById('mapNationBtn').addEventListener('click', showHeadquarters);
document.getElementById('siteSearchBtn').addEventListener('click', runSearch);
document.getElementById('siteSearchInput').addEventListener('keydown', event => { if (event.key === 'Enter') runSearch(); });

populateSearch();
renderRegionTabs();
renderWeatherMetrics('bottomWeatherMetrics',null);
renderWeatherMetrics('siteWeatherMetrics',null);
loadAll();
