(() => {
  const get=id=>document.getElementById(id);
  const notice=get('notice');
  const tz='America/New_York';
  const timeLabel=new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',hour:'numeric',minute:'2-digit'});
  const directions=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  let place, controller, displayedPlace=null;
  const cache=new Map();
  function finite(value){return typeof value==='number'&&Number.isFinite(value);}
  function read(measure){return finite(measure?.value)?measure.value:null;}
  function compass(value){return finite(value)?directions[Math.round(value/22.5)%16]:null;}
  function mph(measure){
    const value=read(measure);
    if(value===null)return null;
    if(measure.unitCode?.endsWith(':km_h-1'))return value*.621371;
    if(measure.unitCode?.endsWith(':m_s-1'))return value*2.23694;
    return null;
  }
  async function json(url,signal){
    const endpoint=new URL(url);
    if(endpoint.origin!=='https://api.weather.gov')throw new Error('Unexpected weather endpoint');
    const result=await fetch(endpoint,{signal:AbortSignal.any([signal,AbortSignal.timeout(16000)])});
    if(!result.ok)throw new Error('NWS returned '+result.status);
    return result.json();
  }
  function gridAt(series,stamp){
    for(const entry of series?.values??[]){
      const [date,duration]=entry.validTime.split('/');
      const span=duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/);
      if(!span)continue;
      const start=Date.parse(date);
      const end=start+(Number(span[1]??0)*1440+Number(span[2]??0)*60+Number(span[3]??0))*60000;
      if(stamp>=start&&stamp<end)return {value:read(entry),hours:(end-start)/3600000};
    }
    return null;
  }
  function stage(data){
    const words=data.condition??'Conditions unavailable';
    const snow=/snow|flurr|ice pellet|sleet/i.test(words);
    const thunder=/thunder/i.test(words);
    const rain=thunder||/rain|drizzle|shower/i.test(words);
    const fog=/fog|mist/i.test(words);
    const clouds=data.cloud===null?(/overcast|cloudy|rain|snow/i.test(words)?.86:/partly/i.test(words)?.49:.22):data.cloud/100;
    const parts=[finite(data.temp)?Math.round(data.temp)+'°F':null,words];
    if(finite(data.speed)){
      const wind=data.speed===0?'Calm':'Wind '+[compass(data.bearing),Math.round(data.speed)+' mph'].filter(Boolean).join(' ');
      parts.push(wind+(data.gust>data.speed?' · Gusts '+Math.round(data.gust)+' mph':''));
    }
    const extras=[
      finite(data.cloud)?'Cloud cover '+Math.round(data.cloud)+'%':null,
      finite(data.chance)?'Precipitation chance '+data.chance+'%':null,
      finite(data.amount)?'Observed precipitation past hour '+data.amount.toFixed(2)+' in':null,
      finite(data.qpf?.value)?'Forecast liquid precipitation '+(data.qpf.value/25.4).toFixed(2)+' in over '+data.qpf.hours+' hr':null
    ].filter(Boolean);
    const details=parts.filter(Boolean).join(' · ');
    return {label:data.label,source:data.source,details,text:[data.context,details,...extras].join(' · '),
      rain,snow,thunder,fog,clouds,night:data.night,cold:finite(data.temp)&&data.temp<45,
      cloudPercent:data.cloud,
      wind:finite(data.speed)?Math.min(1,(data.speed*.8+(data.gust??data.speed)*.2)/29):0,
      direction:finite(data.bearing)?-Math.sin(data.bearing*Math.PI/180):0,windBearing:data.bearing,windMph:data.speed,
      intensity:(data.amount??0)>0?Math.max(.2,Math.min(1,data.amount*3+.2)):(data.qpf?.value??0)>0?Math.max(.2,Math.min(1,data.qpf.value/25.4/data.qpf.hours*3+.2)):/heavy/i.test(words)?1:/light|drizzle|flurr/i.test(words)?.33:.62
    };
  }
  async function observation(points,signal){
    const stations=await json(points.observationStations,signal);
    const options=(stations.features??[]).slice(0,4);
    const results=await Promise.allSettled(options.map(async item=>{
      const data=await json(item.id+'/observations/latest',signal);
      const obs=data.properties;
      const age=Date.now()-Date.parse(obs.timestamp);
      return age<3*3600000&&age>-600000?{obs,id:item.properties.stationIdentifier}:null;
    }));
    return results.find(result=>result.status==='fulfilled'&&result.value)?.value??null;
  }
  function forecastStage(p,grid,placeName){
    const stamp=Date.parse(p.startTime);
    const speeds=(p.windSpeed?.match(/\d+(?:\.\d+)?/g)??[]).map(Number);
    const idx=directions.indexOf(p.windDirection);
    return stage({label:timeLabel.format(stamp),source:'NWS HOURLY FORECAST',context:placeName,
      condition:p.shortForecast,temp:p.temperatureUnit==='C'?p.temperature*1.8+32:p.temperature,
      speed:speeds.length?Math.max(...speeds):null,bearing:idx>=0?idx*22.5:null,
      gust:null,cloud:gridAt(grid?.skyCover,stamp)?.value??null,qpf:gridAt(grid?.quantitativePrecipitation,stamp),chance:read(p.probabilityOfPrecipitation),
      amount:null,night:!p.isDay});
  }
  function observedStage(result,hourly){
    const {obs,id}=result;
    const temp=read(obs.temperature);
    const precip=read(obs.precipitationLastHour);
    const cloudCode=obs.cloudLayers?.at(-1)?.amount;
    const coverage={CLR:0,SKC:0,FEW:20,SCT:44,BKN:75,OVC:100,VV:100};
    const mm=obs.precipitationLastHour?.unitCode?.endsWith(':mm');
    const metres=obs.precipitationLastHour?.unitCode?.endsWith(':m');
    return stage({label:'Observed '+timeLabel.format(new Date(obs.timestamp)),source:'NWS STATION · '+id,
      context:'Nearby station '+id,condition:obs.textDescription,temp:temp===null?null:temp*1.8+32,
      speed:mph(obs.windSpeed),bearing:read(obs.windDirection),gust:mph(obs.windGust),
      cloud:coverage[cloudCode]??null,chance:null,amount:precip!==null&&(mm||metres)?precip*(mm?1:1000)/25.4:null,
      night:hourly?!hourly.isDay:false});
  }
  async function load(force=false){
    if(!place)return;
    controller?.abort();
    const request=new AbortController();
    controller=request;
    const {name,center:[lng,lat]}=place;
    const key=lat.toFixed(4)+','+lng.toFixed(4);
    const previous=cache.get(key);
    if(displayedPlace!==key){
      setStages([{label:name,source:'NWS WEATHER',details:'Loading conditions…',text:'Fetching weather for '+name+'.',clouds:.25,wind:0}]);
      displayedPlace=key;
    }
    if(!force&&previous&&Date.now()-previous.loaded<300000){setStages(previous.stages);notice.textContent=previous.message;return;}
    notice.textContent='Loading NWS weather for '+name+'…';
    try{
      const point=(await json('https://api.weather.gov/points/'+key,request.signal)).properties;
      const [forecast,observed,grid]=await Promise.allSettled([
        point.forecastHourly?json(point.forecastHourly,request.signal):Promise.resolve(null),
        point.observationStations?observation(point,request.signal):Promise.resolve(null),
        point.forecastGridData?json(point.forecastGridData,request.signal):Promise.resolve(null)
      ]);
      if(request.signal.aborted)return;
      const now=Date.now();
      const hourly=(forecast.value?.properties?.periods??[]).filter(p=>Date.parse(p.endTime)>now).slice(0,48);
      const rows=hourly.map(p=>forecastStage(p,grid.value?.properties,name));
      if(observed.value)rows.unshift(observedStage(observed.value,hourly[0]));
      if(!rows.length)throw new Error('No recent observation or hourly forecast');
      const message=observed.value?(hourly.length?'':'Hourly forecast unavailable for this point.'):'No recent nearby station report. Showing the NWS hourly forecast.';
      cache.set(key,{loaded:now,stages:rows,message});
      const index=stages[current]?.source?.startsWith('NWS')&&stages[current]?.label!=='Observed'?Math.max(0,rows.findIndex(row=>row.label===stages[current]?.label)):0;
      setStages(rows,index);
      notice.textContent=message;
    }catch{
      if(request.signal.aborted)return;
      if(previous)setStages(previous.stages);
      else setStages([{label:name,source:'NWS WEATHER',details:'Data unavailable',text:'NWS weather unavailable for '+name+'.',clouds:.25,wind:0}]);
      notice.textContent=previous?'Refresh failed. Showing the last retrieved weather.':'NWS weather could not be loaded. Try Refresh or enter a written forecast.';
    }
  }
  window.loadPinnedWeather=next=>{place=next;load();};
  get('refreshWeather').onclick=()=>load(true);
  setInterval(()=>{if(!document.hidden)load(true);},600000);
})();
