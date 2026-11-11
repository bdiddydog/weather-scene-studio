(() => {
  const get = id => document.getElementById(id);
  const viewport = get('viewport');
  const status = get('mapStatus');
  const places = window.delawarePlaces ?? {};
  const townInput = get('location');
  const locationStatus = get('locationStatus');
  const names = new Map(Object.keys(places).map(name => [name.toLowerCase(), name]));
  for(const name of names.values()){
    const option=document.createElement('option');
    option.value=name;
    get('delawarePlaces').append(option);
  }
  let location={name:'Wilmington',center:places.Wilmington??[-75.5466,39.7391],zoom:12.2};
  let overview=false;
  const statewide={center:[-75.41,39.14],zoom:7.7,pitch:0,bearing:0};
  function choose(name,center){
    closeRadar();
    overview=false;
    stopOrbit();
    location={name,center,zoom:12.2};
    townInput.value=name;
    window.loadPinnedWeather?.(location);
    locationStatus.textContent='';
    if(fallback){fallback.reset();return;}
    if(loaded){updateMarker();map.jumpTo(camera());refresh();}
  }
  function pin(lng,lat){
    if(lng < -75.9 || lng > -74.85 || lat < 38.4 || lat > 39.9){
      locationStatus.textContent='Choose a point in the Delaware area.';
      return;
    }
    choose(lat.toFixed(5)+', '+lng.toFixed(5),[lng,lat]);
  }
  get('locationForm').onsubmit=event=>{
    event.preventDefault();
    const query=townInput.value.trim();
    const name=names.get(query.replace(/,?\s+(?:DE|Delaware)$/i,'').toLowerCase());
    if(name){choose(name,places[name]);return;}
    const coords=query.match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
    if(coords){pin(Number(coords[2]),Number(coords[1]));return;}
    locationStatus.textContent='Select a listed town or enter latitude, longitude.';
  };
  get('overview').onclick=()=>{
    closeRadar();
    overview=true;stopOrbit();
    locationStatus.textContent='Click the map to drop a pin anywhere in Delaware.';
    if(fallback){fallback.reset();return;}
    if(loaded){marker.remove();map.jumpTo(camera());refresh();}
  };
  const imagery = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const streets = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
  const referenceRoot='https://server.arcgisonline.com/ArcGIS/rest/services/Reference/';
  const references=[
    {id:'roads',url:referenceRoot+'World_Transportation/MapServer/tile/{z}/{y}/{x}',opacity:.65},
    {id:'labels',url:referenceRoot+'World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',opacity:1}
  ];
  const referenceCredit='Reference © Esri, Garmin, HERE, OpenStreetMap contributors, and the GIS user community';
  const elevation = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  let map, marker, fallback, ground='satellite', loaded=false;
  const errors = new Set();
  const ready = new Set();
  function position() {return location;}
  function camera() {
    if(radarActive){
      const [west,south,east,north]=radarRegions[radarRegion].bounds;
      const fit=map?.cameraForBounds([[west,south],[east,north]],{padding:24,bearing:0});
      return {...(fit??{center:[(west+east)/2,(south+north)/2],zoom:radarRegions[radarRegion].level-1}),pitch:0,bearing:0};
    }
    if(overview)return statewide;
    const {center,zoom}=position();
    return {center,zoom,pitch:62,bearing:-29};
  }
  function selectGround(layer) {
    stopOrbit();ground=layer;refresh();
    if(fallback){fallback.render();return;}
    if(!loaded)return;
    setLayers();
  }
  function refresh() {
    window.terrainActive=loaded&&ready.has(ground);
    viewport.classList.toggle('terrain-ready',window.terrainActive);
    window.refreshWindLegend?.();
    get('radar').disabled=!window.terrainActive&&!radarActive;
    const groundMessage=errors.has(ground)?'Map tiles unavailable. Try the other map layer.':'Loading map tiles…';
    status.textContent=!window.terrainActive?groundMessage:fallback?'Tilted imagery':errors.has('elevation')?'Elevation tiles unavailable. Showing tilted imagery.':'';
    for(const key of ['satellite','street']) get(key).setAttribute('aria-pressed',String(key===ground));
    for(const key of ['topView','resetView','tilt','orbit','compass','left','right']) get(key).disabled=!window.terrainActive;
  }
  get('satellite').onclick=()=>selectGround('satellite');
  get('street').onclick=()=>selectGround('street');
  const tiltInput=get('tilt');
  const compass=get('compass');
  const orbitButton=get('orbit');
  let orbitFrame=0;
  function getBearing(){return fallback?.bearing()??map?.getBearing()??0;}
  function getPitch(){return fallback?.pitch()??map?.getPitch()??0;}
  function syncCamera(){
    const bearing=getBearing(),pitch=Math.round(getPitch());
    compass.style.setProperty('--compass-rotation',(-bearing)+'deg');
    compass.setAttribute('aria-label','Compass, heading '+Math.round((bearing%360+360)%360)+' degrees. Reset to north up');
    tiltInput.value=pitch;
    get('tiltValue').value=pitch+'°';
  }
  function stopOrbit(){
    cancelAnimationFrame(orbitFrame);
    orbitFrame=0;
    orbitButton.textContent='Rotate 360°';
  }
  function setBearing(value){
    if(fallback)fallback.setBearing(value);
    else map?.setBearing(value);
  }
  orbitButton.onclick=()=>{
    if(orbitFrame){stopOrbit();return;}
    const start=getBearing();
    let began=null;
    orbitButton.textContent='Stop rotation';
    function orbit(now){
      began??=now;
      const progress=Math.min(1,(now-began)/8500);
      setBearing(start+progress*360);
      if(progress<1)orbitFrame=requestAnimationFrame(orbit);
      else stopOrbit();
    }
    orbitFrame=requestAnimationFrame(orbit);
  };
  compass.onclick=()=>{stopOrbit();setBearing(0);};
  tiltInput.oninput=()=>{
    stopOrbit();
    if(fallback)fallback.setPitch(Number(tiltInput.value));
    else map?.setPitch(Number(tiltInput.value));
  };
  get('topView').onclick=()=>{
    stopOrbit();
    if(fallback)fallback.top();
    else map?.easeTo({pitch:0,bearing:0,duration:500});
  };
  get('resetView').onclick=()=>{
    stopOrbit();
    if(fallback)fallback.reset();
    else map?.easeTo({...camera(),duration:650});
  };
  window.rotateTerrain=delta=>{
    stopOrbit();
    if(window.terrainActive)setBearing(getBearing()+delta);
  };
  function setLayers(){
    for(const key of ['satellite','street',...references.map(layer=>layer.id)]){
      map.setLayoutProperty(key,'visibility',(key==='street'?ground==='street':ground==='satellite')?'visible':'none');
    }
  }
  const radarButton=get('radar');
  const radarInfo=get('radarInfo');
  const radarTime=get('radarTime');
  const regionControl=get('radarRegion');
  const modeControl=get('radarMode');
  const radarTitle=get('radarTitle');
  const radarRegions={
    conus:{bounds:[-126,24,-66,50],level:4,sector:'conus'},
    delaware:{bounds:[-79,36,-71,42],level:8,sector:'conus'},
    ak:{bounds:[-180,50,-128,72],level:4,sector:'ak'},
    hi:{bounds:[-161,18,-154,23],level:7,sector:'hi'}
  };
  const easternTime=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  const mercatorY=latitude=>Math.asinh(Math.tan(latitude*Math.PI/180));
  const mercatorX=longitude=>longitude*Math.PI/180;
  let radarRegion='conus',projected=false;
  let radarActive=false,radarVersion=0,radarTimer,radarFrame=null,radarReload;
  function radarUrl(minutes,frameKey){
    const {bounds:[west,south,east,north],sector}=radarRegions[radarRegion];
    const radius=6378137;
    const bbox=[mercatorX(west),mercatorY(south),mercatorX(east),mercatorY(north)].map(value=>value*radius);
    const observed='nexrad-n0q-900913'+(minutes?'-m'+String(minutes).padStart(2,'0')+'m':'')+'-'+sector;
    const layer=projected?'refd_'+String(minutes).padStart(4,'0'):observed;
    const query=new URLSearchParams({SERVICE:'WMS',VERSION:'1.1.1',REQUEST:'GetMap',LAYERS:layer,
      STYLES:'',SRS:'EPSG:3857',BBOX:bbox.join(','),WIDTH:'1080',HEIGHT:'760',FORMAT:'image/png',TRANSPARENT:'TRUE',frame:frameKey});
    return 'https://mesonet.agron.iastate.edu/cgi-bin/wms/'+(projected?'hrrr/refd':'nexrad/n0q')+'.cgi?'+query;
  }
  function clearRadarImage(){
    radarFrame=null;
    fallback?.showRadar(null);
    if(map?.getLayer('observed-radar'))map.removeLayer('observed-radar');
    if(map?.getSource('observed-radar'))map.removeSource('observed-radar');
  }
  function positionRadar(){
    if(fallback)fallback.reset();
    else{updateMarker();map.jumpTo(camera());}
    refresh();
  }
  function reloadRadarView(resetCamera=true){
    radarVersion++;
    clearInterval(radarTimer);
    clearRadarImage();
    modeControl.disabled=radarRegions[radarRegion].sector!=='conus';
    modeControl.setAttribute('aria-pressed',String(projected));
    modeControl.textContent=projected?'Show observed radar':'Show HRRR forecast';
    radarTitle.textContent=projected?'Projected precipitation · NOAA HRRR':'Observed radar · IEM NEXRAD';
    radarTime.textContent=projected?'Loading model forecast…':'Loading recent radar frames…';
    if(resetCamera)positionRadar();
    loadRadar();
  }
  regionControl.onchange=()=>{
    radarRegion=regionControl.value;
    if(radarRegions[radarRegion].sector!=='conus')projected=false;
    reloadRadarView();
  };
  modeControl.onclick=()=>{projected=!projected;reloadRadarView(false);};
  function closeRadar(){
    if(!radarActive)return;
    radarActive=false;radarVersion++;
    clearInterval(radarTimer);clearInterval(radarReload);
    clearRadarImage();
    viewport.classList.remove('radar-active');radarInfo.hidden=true;
    radarButton.setAttribute('aria-pressed','false');radarButton.textContent='Recent radar';
  }
  function showRadar(frame){
    radarFrame=frame;
    radarTime.textContent=frame.valid?'Valid '+easternTime.format(frame.valid)+' · Run '+easternTime.format(frame.run):frame.minutes?'About '+frame.minutes+' min before latest':'Latest available frame';
    if(fallback){fallback.showRadar(frame.url);return;}
    const source=map.getSource('observed-radar');
    if(source){source.updateImage({url:frame.url});return;}
    const [west,south,east,north]=radarRegions[radarRegion].bounds;
    map.addSource('observed-radar',{type:'image',url:frame.url,coordinates:[[west,north],[east,north],[east,south],[west,south]]});
    map.addLayer({id:'observed-radar',type:'raster',source:'observed-radar',
      paint:{'raster-opacity':.75,'raster-fade-duration':0}},ground==='satellite'?'roads':undefined);
  }
  async function loadRadar(){
    const request=++radarVersion;
    const now=Date.now();
    let frameKey=Math.floor(now/300000),run=null,steps=[50,40,30,20,10,0];
    if(projected){
      try{
        const response=await fetch('https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_1080.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw new Error('HRRR run unavailable');
        run=Date.parse((await response.json()).model_init_utc);
        if(!Number.isFinite(run)||now-run>8*3600000)throw new Error('HRRR run is stale');
      }catch{
        if(request===radarVersion&&radarActive)radarTime.textContent=radarFrame?'Refresh failed. Showing the previous HRRR run.':'Recent HRRR forecast unavailable.';
        return;
      }
      if(request!==radarVersion||!radarActive)return;
      frameKey=run;
      steps=[0,180,360,540,720,900,1080].filter(minutes=>run+minutes*60000>=now-3600000);
    }
    const available=await Promise.all(steps.map(minutes=>new Promise(resolve=>{
      const image=new Image();
      image.crossOrigin='anonymous';
      const url=radarUrl(minutes,frameKey);
      const timeout=setTimeout(()=>resolve(null),10000);
      image.onload=()=>{clearTimeout(timeout);resolve({minutes,url,run,valid:run===null?null:run+minutes*60000});};
      image.onerror=()=>{clearTimeout(timeout);resolve(null);};
      image.src=url;
    })));
    if(request!==radarVersion||!radarActive)return;
    const frames=available.filter(Boolean);
    if(!frames.length){
      radarTime.textContent=radarFrame?'Refresh failed. Showing the previous radar loop.':projected?'HRRR forecast unavailable.':'Radar unavailable. Try again in a moment.';
      return;
    }
    clearInterval(radarTimer);
    let index=0;
    showRadar(frames[index]);
    if(frames.length>1)radarTimer=setInterval(()=>{
      index=(index+1)%frames.length;
      showRadar(frames[index]);
    },950);
  }
  radarButton.onclick=()=>{
    if(radarActive){
      closeRadar();overview=false;
      if(fallback)fallback.reset();
      else{updateMarker();map.jumpTo(camera());}
      refresh();return;
    }
    radarActive=true;overview=true;stopOrbit();
    viewport.classList.add('radar-active');radarInfo.hidden=false;
    radarButton.setAttribute('aria-pressed','true');radarButton.textContent='Back to forecast';
    locationStatus.textContent='';
    reloadRadarView();
    radarReload=setInterval(loadRadar,300000);
  };
  function updateMarker(){
    if(overview){marker.remove();return;}
    const place=position();
    marker.getElement().querySelector('span').textContent=place.name;
    marker.setLngLat(place.center).addTo(map);
  }
  function start() {
    const raster=(tiles,attribution)=>({type:'raster',tiles:[tiles],tileSize:256,maxzoom:17,attribution});
    map=new maplibregl.Map({
      container:'terrain',...camera(),maxPitch:67,minZoom:2,maxZoom:17,canvasContextAttributes:{antialias:true},
      style:{version:8,sources:{
        satellite:raster(imagery,'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community'),
        street:raster(streets,'Map © Esri and contributors'),
        ...Object.fromEntries(references.map(layer=>[layer.id,raster(layer.url,referenceCredit)])),
        elevation:{type:'raster-dem',tiles:[elevation],encoding:'terrarium',tileSize:256,maxzoom:14,attribution:'Elevation © Mapzen/AWS'}
      },layers:[
        {id:'base',type:'background',paint:{'background-color':'#183440'}},
        ...['satellite','street'].map(id=>({id,type:'raster',source:id,layout:{visibility:id==='satellite'?'visible':'none'}})),
        ...references.map(layer=>({id:layer.id,type:'raster',source:layer.id,paint:{'raster-opacity':layer.opacity}}))
      ]}
    });
    const markerElement=document.createElement('div');markerElement.className='site-marker';
    markerElement.title='Drag to move the weather pin';
    markerElement.append(document.createElement('span'),document.createElement('i'));
    marker=new maplibregl.Marker({element:markerElement,anchor:'bottom',draggable:true});
    markerElement.addEventListener('click',event=>event.stopPropagation());
    marker.on('dragend',()=>{
      const {lng,lat}=marker.getLngLat();
      pin(lng,lat);
      updateMarker();
    });
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
    map.on('sourcedata',event=>{
      if(event.tile?.state==='loaded'&&event.sourceId){
        ready.add(event.sourceId);errors.delete(event.sourceId);refresh();
      }
    });
    map.on('error',event=>{
      if(event.sourceId){
        errors.add(event.sourceId);refresh();
      }
    });
    map.on('move',syncCamera);
    map.getCanvas().addEventListener('pointerdown',stopOrbit);
    map.on('click',event=>{pin(event.lngLat.lng,event.lngLat.lat);});
    map.once('load',()=>{
      loaded=true;
      map.setTerrain({source:'elevation',exaggeration:1});
      setLayers();
      syncCamera();
      updateMarker();refresh();
    });
  }
  function startFallback(){
    const container=get('terrain');
    container.replaceChildren();
    container.className='tilted-map';
    const plane=document.createElement('div');
    const label=document.createElement('div');
    const credit=document.createElement('small');
    const radarImage=new Image();
    radarImage.alt='';radarImage.draggable=false;radarImage.className='radar-tile';radarImage.hidden=true;
    plane.className='tile-plane';label.className='fallback-pin';
    credit.className='fallback-credit';label.title='Drag to move the weather pin';
    container.append(plane,label,credit);
    let heading=-29, tilt=57, zoom=1, dx=0, dy=0, revision=0, drag=null;
    function pose(){
      let fit=Math.max(.65,Math.min(1.2,container.clientWidth/850));
      if(radarActive){
        const {bounds:[west,south,east,north],level}=radarRegions[radarRegion];
        const pixels=256*2**level;
        const regionWidth=(east-west)/360*pixels;
        const regionHeight=(mercatorY(north)-mercatorY(south))/(2*Math.PI)*pixels;
        fit=.93*Math.min(container.clientWidth/regionWidth,container.clientHeight/regionHeight);
      }
      plane.style.transform='translate(-50%, -50%) translate('+dx+'px,'+dy+'px) rotateX('+tilt+'deg) rotateZ('+heading+'deg) scale('+zoom*fit+')';
      syncCamera();
      label.style.transform='translate('+dx+'px,'+dy+'px) translate(-50%,-100%)';
    }
    function render(){
      const generation=++revision;
      const layer=ground, source=layer==='satellite'?imagery:streets;
      ready.delete(layer);errors.delete(layer);refresh();
      const region=radarRegions[radarRegion];
      const [west,south,east,north]=region.bounds;
      const radarCenter=[(west+east)/2,Math.atan(Math.sinh((mercatorY(north)+mercatorY(south))/2))*180/Math.PI];
      const {name,center:[lng,lat]}=radarActive?{center:radarCenter}:overview?statewide:position();
      const radians=lat*Math.PI/180, level=radarActive?region.level:overview?8:12, span=2**level;
      label.hidden=overview;
      const x=(lng+180)/360*span, y=(1-Math.asinh(Math.tan(radians))/Math.PI)/2*span;
      label.textContent='●  '+name;credit.textContent=layer==='satellite'?'Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community · '+referenceCredit:'Map © Esri and contributors';
      const tiles=[];
      let remaining=35, centerLoaded=false;
      for(let row=-2;row<=2;row++)for(let col=-3;col<=3;col++){
        const tx=Math.floor(x)+col, ty=Math.floor(y)+row;
        const tile=new Image();tile.alt='';tile.draggable=false;
        tile.style.left=(tx-x)*256+'px';tile.style.top=(ty-y)*256+'px';
        tile.onload=tile.onerror=event=>{
          if(generation!==revision)return;
          if(!col&&!row&&event.type==='load'){centerLoaded=true;ready.add(layer);refresh();}
          if(!--remaining&&!centerLoaded){errors.add(layer);refresh();}
        };
        tile.dataset.x=tx;tile.dataset.y=ty;tile.dataset.span=span;
        tile.src=source.replace('{z}',level).replace('{y}',ty).replace('{x}',tx);
        tiles.push(tile);
        if(layer==='satellite'){
          for(const reference of references){
            const overlay=new Image();
            overlay.alt='';overlay.draggable=false;overlay.className='reference-tile';
            overlay.style.left=tile.style.left;overlay.style.top=tile.style.top;
            overlay.style.opacity=reference.opacity;
            overlay.onerror=()=>overlay.remove();
            overlay.src=reference.url.replace('{z}',level).replace('{y}',ty).replace('{x}',tx);
            tiles.push(overlay);
          }
        }
      }
      radarImage.style.left=((west+180)/360*span-x)*256+'px';
      radarImage.style.top=((1-mercatorY(north)/Math.PI)/2*span-y)*256+'px';
      radarImage.style.width=(east-west)/360*span*256+'px';
      radarImage.style.height=(mercatorY(north)-mercatorY(south))/(2*Math.PI)*span*256+'px';
      plane.replaceChildren(...tiles.filter(tile=>!tile.classList.contains('reference-tile')),radarImage,...tiles.filter(tile=>tile.classList.contains('reference-tile')));pose();
    }
    fallback={
      render,showRadar(url){radarImage.hidden=!url;if(url)radarImage.src=url;},bearing(){return -heading;},pitch(){return tilt;},
      setBearing(value){heading=-value;pose();},setPitch(value){tilt=value;pose();},top(){tilt=0;heading=0;pose();},
      reset(){heading=overview?0:-29;tilt=overview?0:57;zoom=1;dx=0;dy=0;render();}
    };
    new ResizeObserver(pose).observe(container);
    container.oncontextmenu=event=>event.preventDefault();
    function tilePoint(event){
      if(!(event.target instanceof HTMLImageElement)||!plane.contains(event.target))return null;
      const tile=event.target, span=Number(tile.dataset.span);
      const x=Number(tile.dataset.x)+event.offsetX/256;
      const y=Number(tile.dataset.y)+event.offsetY/256;
      return [x/span*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/span)))*180/Math.PI];
    }
    let pinDrag=null;
    container.onpointerdown=event=>{
      stopOrbit();
      if(event.button===0&&event.target===label){
        event.preventDefault();
        pinDrag={x:event.clientX,y:event.clientY,id:event.pointerId};
        if(label.hasPointerCapture(event.pointerId))label.releasePointerCapture(event.pointerId);
        label.style.pointerEvents='none';
        return;
      }
      drag={x:event.clientX,y:event.clientY,rotate:event.button===2,
        target:event.button===0?tilePoint(event):null,movement:0};
      container.setPointerCapture(event.pointerId);
    };
    window.addEventListener('pointermove',event=>{
      if(pinDrag?.id!==event.pointerId)return;
      label.style.translate=(event.clientX-pinDrag.x)+'px '+(event.clientY-pinDrag.y)+'px';
    });
    function endPinDrag(event){
      if(pinDrag?.id!==event.pointerId)return;
      const target=event.type==='pointerup'&&Math.hypot(event.clientX-pinDrag.x,event.clientY-pinDrag.y)>5?tilePoint(event):null;
      pinDrag=null;label.style.pointerEvents='';label.style.translate='';
      if(target)pin(...target);
    }
    window.addEventListener('pointerup',endPinDrag);
    window.addEventListener('pointercancel',endPinDrag);
    container.onpointermove=event=>{
      if(!drag)return;
      const x=event.clientX-drag.x,y=event.clientY-drag.y;
      drag.movement+=Math.hypot(x,y);
      if(drag.rotate){heading+=x*.4;tilt=Math.max(0,Math.min(67,tilt-y*.3));}
      else if(drag.movement>=5){dx=Math.max(-340,Math.min(340,dx+x));dy=Math.max(-220,Math.min(220,dy+y));}
      drag.x=event.clientX;drag.y=event.clientY;pose();
    };
    container.onpointerup=()=>{if(drag?.target&&drag.movement<5)pin(...drag.target);};
    container.onlostpointercapture=()=>{drag=null;};
    container.addEventListener('wheel',event=>{
      event.preventDefault();zoom=Math.max(.82,Math.min(3,zoom*Math.exp(-event.deltaY*.002)));pose();
    },{passive:false});
    loaded=true;fallback.reset();
  }
  refresh();
  try {
    if(!window.maplibregl)throw new Error('Map library unavailable');
    start();
  } catch (error) {
    console.warn("Could not initialize terrain map",error);
    startFallback();
  }
  const windBands=[
    {min:0,label:'Under 10',color:'#9ce6c1'},
    {min:10,label:'10–15',color:'#63bcff'},
    {min:16,label:'16–24',color:'#ffda6d'},
    {min:25,label:'25–39',color:'#ffa15c'},
    {min:40,label:'40+',color:'#ff646c'}
  ];
  const legend=get('windLegend');
  const legendTitle=document.createElement('strong');
  legendTitle.textContent='Wind arrows · mph';
  legend.append(legendTitle);
  for(const band of windBands){
    const item=document.createElement('span');
    const arrow=document.createElement('i');
    arrow.textContent='➜';
    arrow.setAttribute('aria-hidden','true');
    arrow.style.color=band.color;
    item.append(arrow,document.createTextNode(band.label));
    legend.append(item);
  }
  function drawWindArrows(ctx,w,h,time,stage){
    const speed=stage.windMph;
    if(!Number.isFinite(speed)||speed<=0||!Number.isFinite(stage.windBearing))return;
    const bearing=getBearing();
    const radians=(stage.windBearing-bearing)*Math.PI/180;
    const dx=-Math.sin(radians),dy=Math.cos(radians)*.62;
    const length=Math.hypot(dx,dy), ux=dx/length,uy=dy/length;
    const band=windBands.findLast(item=>Math.round(speed)>=item.min);
    const drift=time*Math.min(90,8+speed*1.5);
    const padding=28;
    const wrap=(value,size)=>((value%size)+size)%size;
    ctx.save();
    ctx.lineCap='round';
    ctx.lineJoin='round';
    ctx.beginPath();
    for(const [x,y,seed] of particles.slice(0,44)){
      const px=wrap(x*(w+padding*2)+dx*drift,w+padding*2)-padding;
      const py=wrap(y*(h+padding*2)+dy*drift,h+padding*2)-padding;
      const shaft=10+Math.min(speed,55)*.19+seed*5;
      const tx=px+ux*shaft,ty=py+uy*shaft;
      const head=3.8+seed*1.5,spread=head*.63;
      ctx.moveTo(px,py);ctx.lineTo(tx,ty);
      ctx.moveTo(tx-ux*head-uy*spread,ty-uy*head+ux*spread);
      ctx.lineTo(tx,ty);
      ctx.lineTo(tx-ux*head+uy*spread,ty-uy*head-ux*spread);
    }
    ctx.lineWidth=3.8;ctx.strokeStyle='#071928bd';ctx.stroke();
    ctx.lineWidth=1.7;ctx.strokeStyle=band.color;ctx.stroke();
    ctx.restore();
  }
  let legendStage;
  window.updateTerrainWeather=stage=>{legendStage=stage;refreshWindLegend();};
  function refreshWindLegend(){
    legend.hidden=radarActive||!window.terrainActive||!Number.isFinite(legendStage?.windMph);
  }
  window.refreshWindLegend=refreshWindLegend;
  refreshWindLegend();
  window.loadPinnedWeather?.(location);
  const particles=Array.from({length:490},()=>[Math.random(),Math.random(),Math.random()]);
  const cloudSprite=document.createElement('canvas');
  cloudSprite.width=240;cloudSprite.height=124;
  const cloudCtx=cloudSprite.getContext('2d');
  for(const [x,y,r] of [[54,70,45],[91,57,51],[132,51,49],[171,67,46],[193,76,33]]){
    const puff=cloudCtx.createRadialGradient(x,y,0,x,y,r);
    puff.addColorStop(0,'#eef3f7');
    puff.addColorStop(.45,'#d1dce5c9');
    puff.addColorStop(1,'#a3b7c800');
    cloudCtx.fillStyle=puff;cloudCtx.fillRect(x-r,y-r,r*2,r*2);
  }
  function drawClouds(ctx,w,h,time,s){
    const coverage=Math.max(0,Math.min(1,s.clouds??0));
    if(!coverage)return;
    const width=w*(.18+coverage*.095),height=h*(.19+coverage*.105);
    const columns=5,rows=4;
    const shift=Math.sin(time*.045)*(.015+s.wind*.025);
    ctx.save();
    ctx.globalAlpha=coverage>.85?.56:.66;
    for(let i=0;i<columns*rows;i++){
      const rank=((i*7)%20+.5)/20;
      if(rank>coverage)continue;
      const x=((i%columns+.25+(i%3)*.22)/columns+shift)*w;
      const y=(Math.floor(i/columns)+.35+(i%2)*.28)/rows*h;
      ctx.drawImage(cloudSprite,x-width*.5,y-height*.5,width,height);
    }
    if(coverage>.85){
      ctx.globalAlpha=(coverage-.85)*1.65;
      ctx.fillStyle='#c7d3e1';
      ctx.fillRect(0,0,w,h);
    }
    ctx.restore();
  }
  window.drawTerrainWeather=(ctx,w,h,time,s)=>{
    ctx.clearRect(0,0,w,h);
    if(radarActive)return;
    const storm=s.rain||s.snow;
    const shade=ctx.createLinearGradient(0,0,0,h);
    shade.addColorStop(0,s.night?'#081327c9':s.fog?'#bccdd4a3':storm?'#17293d9e':s.clouds>.6?'#33495f74':'#24445928');
    shade.addColorStop(1,s.night?'#07132770':s.fog?'#c6d7dd35':storm?'#15263d20':'#10233700');
    ctx.fillStyle=shade;ctx.fillRect(0,0,w,h);
    drawClouds(ctx,w,h,time,s);
    if(s.thunder&&Math.sin(time*.92)>.997){ctx.fillStyle='#d3e5ff60';ctx.fillRect(0,0,w,h);}
    drawWindArrows(ctx,w,h,time,s);
    if(!storm)return;
    const density=s.intensity*(s.intermittent?.56+.32*Math.sin(time*.65):1);
    ctx.beginPath();
    for(const [x,y,n] of particles){
      if(n>density*(s.coastal&&x<.5?.38:1))continue;
      const speed=s.snow?.047:.43;
      const px=((x+time*s.wind*s.direction*.025)%1+1)%1*w;
      const py=((y+time*speed*(.65+n))%1)*h;
      if(s.snow){ctx.moveTo(px+1.7,py);ctx.arc(px,py,.75+n*2.4,0,Math.PI*2);}
      else{ctx.moveTo(px,py);ctx.lineTo(px+s.wind*s.direction*(4+n*9),py+5+n*14);}
    }
    if(s.snow){ctx.fillStyle='#eff7ffd0';ctx.fill();}
    else{ctx.lineWidth=1;ctx.strokeStyle='#c2e8ffc0';ctx.stroke();}
  };
})();
