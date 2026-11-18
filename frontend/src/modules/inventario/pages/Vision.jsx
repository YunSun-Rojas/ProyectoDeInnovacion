import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Eye, ImagePlus, RefreshCw, ScanLine } from 'lucide-react';
import { api } from '../../../api/httpClient';
import { visionFileError, visionVideoFileError, visionDimensionsError } from './visionData';
import s from './Management.module.css';
import ui from './InventoryUI.module.css';
import styles from './Vision.module.css';

export default function Vision() {
  const inventory=useOutletContext()||{};
  const [tab,setTab]=useState('image');
  const [video,setVideo]=useState(null);
  const [videoPreview,setVideoPreview]=useState('');
  const [videoBusy,setVideoBusy]=useState(false);
  const [videoError,setVideoError]=useState('');
  const [videoResult,setVideoResult]=useState(null);
  const [videoOutput,setVideoOutput]=useState(false);
  const [videoJob,setVideoJob]=useState(null);
  const [videoProgress,setVideoProgress]=useState(null);
  const [lineRatio,setLineRatio]=useState(.5);
  const [leftToRight,setLeftToRight]=useState('SALIDA');
  const [cameras,setCameras]=useState([]);
  const [cameraId,setCameraId]=useState('');
  const [cameraStream,setCameraStream]=useState(null);
  const [liveActive,setLiveActive]=useState(false);
  const [liveError,setLiveError]=useState('');
  const [liveDetections,setLiveDetections]=useState([]);
  const [liveSize,setLiveSize]=useState({width:640,height:480});
  const [liveEvents,setLiveEvents]=useState([]);
  const [liveOperation,setLiveOperation]=useState(false);
  const [operation,setOperation]=useState(false);
  const [productId,setProductId]=useState('');
  const [confirmed,setConfirmed]=useState({});
  const videoRef=useRef(null);
  const requestIds=useRef(new Map());
  const versions=useRef(new Map());
  const activeJob=useRef(null);
  const cameraVideo=useRef(null);
  const captureCanvas=useRef(null);
  const liveInFlight=useRef(false);
  const products=inventory.products||[];
  const [file,setFile]=useState(null);
  const [preview,setPreview]=useState('');
  const [imageReady,setImageReady]=useState(false);
  const [model,setModel]=useState(null);
  const [modelError,setModelError]=useState('');
  const [checking,setChecking]=useState(true);
  const [attempt,setAttempt]=useState(0);
  const [error,setError]=useState('');
  const [scanning,setScanning]=useState(false);
  const [result,setResult]=useState(null);
  const request=useRef(null);
  const lock=useRef(false);
  useEffect(()=>{
    const controller=new AbortController();
    api('/vision/model',{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted){setModel(data);setChecking(false);}
    }).catch(e=>{if(!controller.signal.aborted){setModelError(e.message);setChecking(false);}});
    return()=>controller.abort();
  },[attempt]);
  useEffect(()=>{
    return()=>{if(preview)URL.revokeObjectURL(preview);};
  },[preview]);
  useEffect(()=>()=>{if(videoPreview)URL.revokeObjectURL(videoPreview);},[videoPreview]);
  useEffect(()=>()=>{if(activeJob.current)fetch(`/api/vision/video/cancel?jobId=${encodeURIComponent(activeJob.current)}`,{method:'POST',credentials:'same-origin',keepalive:true}).catch(()=>{});},[]);
  useEffect(()=>{
    if(tab!=='live')return;
    if(!navigator.mediaDevices?.enumerateDevices){setLiveError('Este navegador no ofrece acceso a cámaras en este contexto.');return;}
    navigator.mediaDevices.enumerateDevices().then(items=>{const available=items.filter(item=>item.kind==='videoinput');setCameras(available);if(!cameraId&&available[0])setCameraId(available[0].deviceId);})
      .catch(()=>setLiveError('No se pudo consultar las cámaras disponibles.'));
  },[tab]);
  useEffect(()=>{if(cameraVideo.current&&cameraStream)cameraVideo.current.srcObject=cameraStream;},[cameraStream,tab]);
  useEffect(()=>()=>{cameraStream?.getTracks().forEach(track=>track.stop());},[cameraStream]);
  useEffect(()=>{
    if(!liveActive||!cameraStream)return;
    let stopped=false;
    const timer=setInterval(async()=>{
      const video=cameraVideo.current,canvas=captureCanvas.current;
      if(stopped||liveInFlight.current||!video||!canvas||video.readyState<2)return;
      liveInFlight.current=true;
      try{
        const scale=Math.min(1,640/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
        canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);setLiveSize({width:canvas.width,height:canvas.height});
        const frame=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.72));if(!frame)return;
        const result=await api('/vision/live/frame',{method:'POST',rawBody:frame});
        if(stopped)return;
        setLiveDetections(result.detections);setLiveSize({width:result.width,height:result.height});
        const events=result.detections.filter(item=>item.event).map(item=>{
          const evidenceCanvas=document.createElement('canvas');evidenceCanvas.width=canvas.width;evidenceCanvas.height=canvas.height;
          const context=evidenceCanvas.getContext('2d');context.drawImage(canvas,0,0);const lineX=result.line.x;
          context.strokeStyle='#ffd400';context.lineWidth=3;context.beginPath();context.moveTo(lineX,0);context.lineTo(lineX,evidenceCanvas.height);context.stroke();
          for(const detection of result.detections){const [x1,y1,x2,y2]=detection.box;context.strokeStyle=detection.trackId===item.trackId?'#ff243f':'#28e664';context.lineWidth=detection.trackId===item.trackId?4:2;context.strokeRect(x1,y1,x2-x1,y2-y1);context.fillStyle='white';context.font='12px sans-serif';context.fillText(`ID ${detection.trackId} · ${detection.className} · ${(detection.confidence*100).toFixed(0)}%`,x1,Math.max(14,y1-4));}
          const timestamp=new Date().toISOString();context.fillStyle='red';context.font='bold 14px sans-serif';context.fillText(`${item.event} · ${timestamp}`,8,evidenceCanvas.height-10);
          return {...item,type:item.event,timestamp,evidence:evidenceCanvas.toDataURL('image/jpeg',.7)};
        });
        if(events.length)setLiveEvents(old=>[...old,...events.filter(event=>!old.some(prev=>prev.trackId===event.trackId))].slice(-50));
      }catch(e){if(!stopped)setLiveError(e.message);}
      finally{liveInFlight.current=false;}
    },650);
    return()=>{stopped=true;clearInterval(timer);};
  },[liveActive,cameraStream]);
  useEffect(()=>()=>{const controller=request.current;request.current=null;controller?.abort();},[]);
  function select(event){
    const selected=event.target.files?.[0];
    if(!selected)return;
    const issue=visionFileError(selected);
    setResult(null);setImageReady(false);setError(issue);setPreview(issue?'':URL.createObjectURL(selected));
    setFile(issue?null:selected);
    event.target.value='';
  }
  async function analyze(){
    if(lock.current||!imageReady||!file||!model)return;
    lock.current=true;setScanning(true);setError('');setResult(null);
    const controller=new AbortController();request.current=controller;
    const timer=setTimeout(()=>controller.abort(),55000);
    try{
      const data=await api('/vision/detect',{method:'POST',rawBody:file,signal:controller.signal});
      if(!controller.signal.aborted)setResult(data);
    }catch(e){if(request.current===controller)setError(e.name==='AbortError'?'El análisis fue cancelado o excedió el tiempo permitido. Reintenta.':e.message);}
    finally{clearTimeout(timer);lock.current=false;if(request.current===controller){setScanning(false);request.current=null;}}
  }
  function selectVideo(event){
    const chosen=event.target.files?.[0];event.target.value='';
    if(!chosen)return;
    setVideoError('');setVideoResult(null);setVideoJob(null);setVideoProgress(null);setConfirmed({});requestIds.current.clear();
    const issue=visionVideoFileError(chosen);
    if(issue){setVideo(null);setVideoError(issue);return;}
    if(videoPreview)URL.revokeObjectURL(videoPreview);
    setVideo(chosen);setVideoPreview(URL.createObjectURL(chosen));
  }
  async function analyzeVideo(){
    if(videoBusy||!video)return;
    setVideoBusy(true);setVideoError('');setVideoResult(null);setVideoOutput(false);setConfirmed({});requestIds.current.clear();setVideoProgress(null);
    try{
      const query=new URLSearchParams({lineRatio:String(lineRatio),leftToRight,rightToLeft:leftToRight==='SALIDA'?'ENTRADA':'SALIDA'});
      const started=await api(`/vision/video?${query}`,{method:'POST',rawBody:video,rawContentType:'video/mp4'});
      activeJob.current=started.jobId;setVideoJob(started.jobId);
      let state=started;
      while(['queued','processing','cancelling'].includes(state.status)){
        await new Promise(resolve=>setTimeout(resolve,650));
        state=await api(`/vision/video/status?jobId=${encodeURIComponent(started.jobId)}`);
        setVideoProgress(state);
      }
      if(state.status==='completed')setVideoResult(await api(`/vision/video/result?jobId=${encodeURIComponent(started.jobId)}`));
      else if(state.status==='cancelled')setVideoError('Procesamiento cancelado. Los recursos temporales se liberaron.');
      else throw new Error(state.error||'Falló el procesamiento del video.');
    }
    catch(e){setVideoError(e.message);}
    finally{setVideoBusy(false);activeJob.current=null;}
  }
  async function cancelVideo(){if(!activeJob.current)return;try{await api(`/vision/video/cancel?jobId=${encodeURIComponent(activeJob.current)}`,{method:'POST'});}catch(e){setVideoError(e.message);}}
  async function confirmEvent(event){
    const product=products.find(p=>String(p.id)===String(productId));
    if(!product)return;
    if(!requestIds.current.has(event.trackId))requestIds.current.set(event.trackId,crypto.randomUUID());
    const requestId=requestIds.current.get(event.trackId);
    try{
      const version=versions.current.get(String(product.id))??product.version;
      const source=String(event.trackId).startsWith('live-')?'cámara en vivo':'video';
      const receipt=await api('/inventory/changes',{method:'POST',body:{requestId,action:event.type==='ENTRADA'?'stock_in':'stock_out',productId:Number(product.id),version,data:{quantity:1,reason:`Visión Artificial · ${source} · track ${event.trackId} · ${requestId}`}}});
      if(receipt.product?.version)versions.current.set(String(product.id),receipt.product.version);
      setConfirmed(old=>({...old,[event.trackId]:'Registrado'}));
    }catch(e){setConfirmed(old=>({...old,[event.trackId]:`Pendiente: ${e.message}`}));}
  }
  async function startCamera(){
    if(!cameraId)return;
    setLiveError('');setLiveEvents([]);setLiveDetections([]);requestIds.current.clear();
    let stream;
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:cameraId}}});
      const query=new URLSearchParams({lineRatio:String(lineRatio),leftToRight,rightToLeft:leftToRight==='SALIDA'?'ENTRADA':'SALIDA'});
      await api('/vision/live/reset?'+query,{method:'POST'});
      setCameraStream(stream);setLiveActive(true);
    }catch(e){stream?.getTracks().forEach(track=>track.stop());setLiveError(e.message||'No se pudo abrir la cámara seleccionada.');}
  }
  function stopCamera(){setLiveActive(false);cameraStream?.getTracks().forEach(track=>track.stop());setCameraStream(null);setLiveDetections([]);}
  return <div className={`${s.page} ${ui.workspace} ${styles.workspace}`}>
    <header className={`${s.header} ${ui.heading} ${styles.heading}`}><div><h1>Reconocimiento visual</h1></div></header>
    <section className={`${s.card} ${styles.modelStatus}`} data-connected={!!model} aria-label="Estado del modelo">
      <div className={styles.modelSummary}><ScanLine size={22} aria-hidden="true" /><strong role="status">{model?'Modelo conectado':checking?'Comprobando modelo…':'Modelo no conectado'}</strong><button type="button" className={`${ui.secondary} ${ui.savingButton}`} aria-busy={checking} disabled={checking||scanning} onClick={()=>{setChecking(true);setModel(null);setModelError('');setAttempt(n=>n+1);}}>Comprobar modelo</button></div>
      {model&&<details className={styles.modelDetails}><summary>Información del modelo</summary><p className={styles.modelText}>{model.model} · Clases reales: {model.classes.map(c=>c.name).join(', ')} · Umbral de confianza: {Math.round(model.confidenceThreshold*100)} % · Entrada YOLO: {model.imageSize} px</p><p className={styles.modelText}>Solo reconoce las clases aprendidas; no identifica automáticamente todas las categorías ni SKU del catálogo.</p></details>}
      {modelError&&<div className={styles.modelIssue} role="alert"><p>No se pudo comprobar el modelo.</p><details className={styles.modelDetails}><summary>Detalles de conexión</summary><p className={styles.modelText}>{modelError}</p></details></div>}
    </section>
    <nav className={styles.tabs} aria-label="Modalidad de visión">
      <button type="button" aria-pressed={tab==='image'} onClick={()=>setTab('image')}>Análisis por imagen</button>
      <button type="button" aria-pressed={tab==='video'} onClick={()=>setTab('video')}>Análisis por video</button>
      <button type="button" aria-pressed={tab==='live'} onClick={()=>setTab('live')}>Monitoreo en vivo</button>
    </nav>
    {tab==='image'&&<div className={styles.grid}>
      <section className={`${s.card} ${styles.upload}`} aria-label="Imagen de entrada">
        <h2 className={styles.title}>Imagen de entrada</h2>
        <label className={s.field}><span><ImagePlus size={17} aria-hidden="true" /> Seleccionar imagen</span><input id="vision-image-file" name="imageFile" type="file" accept="image/jpeg,image/png,image/webp" disabled={scanning} onChange={select} aria-describedby="vision-file-help" /></label>
        <p id="vision-file-help" className={styles.help}>JPG, PNG o WebP · Hasta 8 MiB y 16 MP · Entre 32 y 8192 px por lado. Se procesa en memoria, sin guardar la imagen en el servidor.</p>
        {preview?<div className={styles.imageSurface}><div className={styles.imageFrame}><img src={preview} alt={`Imagen seleccionada: ${file?.name||''}`} onLoad={e=>{
          const issue=visionDimensionsError(e.currentTarget.naturalWidth,e.currentTarget.naturalHeight);setError(issue);setImageReady(!issue);
        }} onError={()=>{setImageReady(false);setError('No se pudo abrir la imagen. Selecciona un archivo válido.');}} />
          {result&&<svg className={styles.overlay} viewBox={`0 0 ${result.width} ${result.height}`} role="img" aria-label={`${result.detections.length} detecciones sobre la imagen`}>
            {result.detections.map((d,index)=>{const [x1,y1,x2,y2]=d.box;const fontSize=Math.max(12,result.width/45);return <g key={index}><title>{`${d.className}: ${(d.confidence*100).toFixed(1)} %`}</title><rect x={x1} y={y1} width={x2-x1} height={y2-y1} fill="none" stroke="#ff3153" strokeWidth="2" vectorEffect="non-scaling-stroke" /><text x={x1+3} y={Math.max(fontSize+2,y1-5)} fontSize={fontSize} fill="white" stroke="#8a1029" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">{index+1} · {d.className} {(d.confidence*100).toFixed(1)}%</text></g>;})}
          </svg>}
        </div></div>:<div className={styles.placeholder}><ImagePlus size={32} aria-hidden="true" /><p>Selecciona una imagen</p><span>La vista previa aparecerá aquí.</span></div>}
        <button type="button" className={`${ui.primary} ${scanning?styles.scanning:''}`} aria-busy={scanning} disabled={scanning||!model||!imageReady} onClick={analyze}>{scanning?<RefreshCw size={17} aria-hidden="true" />:<Eye size={17} aria-hidden="true" />}{scanning?'Analizando imagen…':'Analizar imagen'}</button>
        {error&&<p className={ui.alert} role="alert">{error}</p>}
      </section>
      <section className={`${s.card} ${styles.detections}`} aria-busy={scanning} aria-label="Resultado real del reconocimiento"><h2 className={styles.title}>Detecciones</h2>
        {scanning?<p role="status" className={ui.notice}>Analizando la imagen…</p>:result?<>
          <p className={ui.notice} role="status">{result.detections.length?`${result.detections.length} detecciones reales`:'No se encontraron detecciones por encima del umbral de confianza.'}</p>
          <p className={styles.help}>{result.width} × {result.height} px · Inferencia: {result.elapsedMs} ms · {result.model}</p>
          {result.detections.length>0&&<div className={`${s.tableWrap} ${ui.tableSurface}`}><table className={s.table}><caption className={styles.caption}>Coordenadas en píxeles de la imagen orientada, no del tamaño de pantalla.</caption><thead><tr><th scope="col">Clase</th><th scope="col">Confianza</th><th scope="col">Caja (x1, y1, x2, y2)</th></tr></thead><tbody>{result.detections.map((d,i)=><tr key={i}><td>{i+1}. {d.className}</td><td>{(d.confidence*100).toFixed(1)} %</td><td>{d.box.map(n=>n.toFixed(1)).join(', ')}</td></tr>)}</tbody></table></div>}
          <p className={styles.help}>Puedes seleccionar otra imagen o repetir el análisis. No se registran productos, existencias ni movimientos.</p>
        </>:<div className={styles.placeholder}><ScanLine size={32} aria-hidden="true" /><h3>Sin resultados todavía</h3><span>Los resultados del análisis aparecerán aquí</span></div>}
      </section>
    </div>}
    {tab==='video'&&<div className={styles.videoGrid}>
      <section className={`${s.card} ${styles.upload}`}><h2 className={styles.title}>Análisis de video</h2>
        <label className={s.field}><span>Seleccionar video MP4</span><input id="vision-video-file" name="videoFile" type="file" accept="video/mp4,.mp4" disabled={videoBusy} onChange={selectVideo} aria-label="Seleccionar video MP4"/></label>
        <p className={styles.help}>Hasta 100 MiB, 20 minutos, 8 MP y 3840 px por lado. Se procesa temporalmente en Python.</p>
        {videoPreview?<div className={styles.videoWrap}><video ref={videoRef} className={styles.video} src={videoOutput&&videoJob?'/api/vision/video/output?jobId='+encodeURIComponent(videoJob):videoPreview} controls playsInline/><span className={styles.linePreview} style={{left:(lineRatio*100)+'%'}} aria-hidden="true"/></div>:<div className={styles.placeholder}>Selecciona el video grabado para revisarlo.</div>}
        {videoPreview&&<><label className={s.field}>Posición de línea: {Math.round(lineRatio*100)} %<input type="range" min="10" max="90" value={Math.round(lineRatio*100)} onChange={e=>setLineRatio(Number(e.target.value)/100)} disabled={videoBusy}/></label><label className={s.field}>Movimiento izquierda → derecha<select value={leftToRight} onChange={e=>setLeftToRight(e.target.value)} disabled={videoBusy}><option value="SALIDA">SALIDA</option><option value="ENTRADA">ENTRADA</option></select></label><p className={styles.help}>El movimiento opuesto recibe la otra dirección. Ajusta la línea antes de iniciar.</p></>}
        <button type="button" className={`${ui.primary} ${videoBusy?styles.scanning:''}`} disabled={!video||videoBusy||!model} onClick={analyzeVideo} aria-busy={videoBusy}>{videoBusy?'Procesando fotogramas…':'Procesar video (modo de prueba)'}</button>
        {videoBusy&&<><progress className={styles.progress} max="100" value={videoProgress?.progress||0} aria-label="Avance del procesamiento"/><p role="status" className={ui.notice}>{videoProgress?.status||'Iniciando'} · {videoProgress?.progress??0}% · {videoProgress?.processedFrames??0}/{videoProgress?.totalFrames||'…'} fotogramas · {videoProgress?.elapsedSeconds??0} s</p><button type="button" className={ui.secondary} onClick={cancelVideo}>Cancelar procesamiento</button></>}
        {videoError&&<p className={ui.alert} role="alert">{videoError}</p>}
      </section>
      <section className={`${s.card} ${styles.detections}`} aria-label="Eventos del video">
        <h2 className={styles.title}>Cruces detectados</h2>
        {videoResult?<>
          <p className={ui.notice} role="status">{videoResult.counts.entradas} entradas · {videoResult.counts.salidas} salidas · {videoResult.processedFrames} fotogramas procesados</p>
          <p className={styles.help}>Línea en x={videoResult.line.x}, margen {videoResult.line.margin} px. Izquierda → derecha: {videoResult.line.leftToRight}; derecha → izquierda: {videoResult.line.rightToLeft}. Duración: {videoResult.elapsedSeconds} s.</p>
          {videoResult.diagnostics&&<details className={styles.diagnostic} open><summary>Diagnóstico YOLO, ByteTrack y cruces</summary><dl className={styles.diagnosticGrid}>
            <div><dt>Fotogramas procesados</dt><dd>{videoResult.processedFrames} / {videoResult.totalFrames}</dd></div>
            <div><dt>Detecciones YOLO</dt><dd>{videoResult.diagnostics.yoloDetections}</dd></div>
            <div><dt>Umbral YOLO en video</dt><dd>{(videoResult.diagnostics.videoConfidenceThreshold*100).toFixed(0)} %</dd></div>
            <div><dt>Detecciones con ID</dt><dd>{videoResult.diagnostics.idAssignedDetections}</dd></div>
            <div><dt>IDs únicos</dt><dd>{videoResult.diagnostics.uniqueTrackIds}</dd></div>
            <div><dt>Detecciones sin ID</dt><dd>{videoResult.diagnostics.noIdDetections}</dd></div>
            <div><dt>Observaciones quietas (ID estable)</dt><dd>{videoResult.diagnostics.stationaryIdObservations}</dd></div>
            <div><dt>Observaciones desplazadas (ID estable)</dt><dd>{videoResult.diagnostics.movingIdObservations}</dd></div>
            <div><dt>Posibles cambios de ID</dt><dd>{videoResult.diagnostics.possibleIdChanges}</dd></div>
            <div><dt>Brechas de seguimiento</dt><dd>{videoResult.diagnostics.lostTracks}</dd></div>
            <div><dt>Confianza promedio</dt><dd>{videoResult.diagnostics.averageConfidence==null?'Sin detecciones':`${(videoResult.diagnostics.averageConfidence*100).toFixed(1)} %`}</dd></div>
            <div><dt>Cruces confirmados</dt><dd>{videoResult.diagnostics.crossings}</dd></div>
          </dl>
          {videoResult.diagnostics.discardedCrossings?.length>0&&<><h3>Motivos observados para no confirmar un cruce</h3><ul>{videoResult.diagnostics.discardedCrossings.map(item=><li key={item.reason}>{item.reason} · {item.count} fotogramas</li>)}</ul></>}
          <p className={styles.help}>El video usa confianza mínima 5 % para permitir la asociación de baja confianza de ByteTrack; las imágenes conservan su umbral independiente. Quieto/desplazado compara centros consecutivos del mismo ID (más de 2 px cuenta como desplazamiento). Las cajas sin ID también se anotan, pero no participan en cruces. Los cambios de ID son posibles coincidencias por solapamiento y requieren revisión visual.</p></details>}
          {videoJob&&<label className={styles.mode}><input type="checkbox" checked={videoOutput} onChange={e=>setVideoOutput(e.target.checked)}/> Ver video procesado con cajas, clases, confianza, IDs, línea y cruces</label>}
          <label className={s.field}>Producto para confirmar<select value={productId} onChange={e=>setProductId(e.target.value)}><option value="">Selecciona manualmente un producto…</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.sku} (stock {p.stock})</option>)}</select></label>
          <label className={styles.mode}><input type="checkbox" checked={operation} onChange={e=>setOperation(e.target.checked)}/> Modo de operación (requiere confirmación por evento)</label>
          {!operation&&<p className={styles.help}>Modo de prueba: no se ha modificado el inventario.</p>}
          {videoResult.events.length?<div className={`${s.tableWrap} ${ui.tableSurface}`}><table className={s.table}><thead><tr><th>Track</th><th>Movimiento</th><th>Fotograma</th><th>Clase detectada</th><th>Estado</th></tr></thead><tbody>{videoResult.events.map((event,i)=><tr key={`${event.trackId}-${i}`}><td>{event.trackId}</td><td>{event.type}</td><td>{event.frame} ({event.timeSeconds??'—'} s)</td><td>{event.className} · {Math.round(event.confidence*100)}%</td><td>{confirmed[event.trackId]|| (operation?<button type="button" disabled={!productId||confirmed[event.trackId]==='Registrado'} onClick={()=>confirmEvent(event)}>Confirmar {event.type.toLowerCase()}</button>:'Solo revisión')}</td></tr>)}</tbody></table></div>:<p>No se detectaron cruces confirmados de la línea.</p>}
          {videoResult.events.length>0&&<div className={`${s.tableWrap} ${ui.tableSurface}`}><table className={s.table}><caption>Revisión de evidencias</caption><thead><tr><th>ID</th><th>Producto detectado</th><th>Tipo</th><th>Confianza</th><th>Fecha y hora</th><th>Estado</th><th>Evidencia</th></tr></thead><tbody>{videoResult.events.map((event,i)=><tr key={'evidence-'+i}><td>{event.trackId}</td><td>{event.className}</td><td>{event.type}</td><td>{(event.confidence*100).toFixed(1)}%</td><td>{new Date(event.timestamp).toLocaleString('es-PE')}</td><td>{confirmed[event.trackId]||'Pendiente de revisión'}</td><td>{event.evidence&&<details><summary>Ver captura</summary><img className={styles.evidence} src={event.evidence} alt={`${event.className}; seguimiento ${event.trackId}; ${event.type}; caja y línea`}/></details>}</td></tr>)}</tbody></table></div>}
        </>:<div className={styles.placeholder}>El resumen y los eventos aparecerán al terminar el procesamiento.</div>}
      </section>
    </div>}
    {tab==='live'&&<section className={`${s.card} ${styles.live}`}><h2 className={styles.title}>Monitoreo en vivo</h2>
      <label className={s.field}>Cámara disponible<select value={cameraId} onChange={e=>setCameraId(e.target.value)} disabled={liveActive}><option value="">Selecciona una cámara…</option>{cameras.map((camera,index)=><option key={camera.deviceId||index} value={camera.deviceId}>{camera.label||`Cámara ${index+1}`}</option>)}</select></label>
      {!liveActive?<button type="button" className={ui.primary} disabled={!cameraId||!model} onClick={startCamera}>Iniciar cámara</button>:<button type="button" className={ui.secondary} onClick={stopCamera}>Detener monitoreo</button>}
      {cameraStream?<div className={styles.videoWrap}><video ref={cameraVideo} className={styles.video} autoPlay muted playsInline/><svg className={styles.liveOverlay} viewBox={`0 0 ${liveSize.width} ${liveSize.height}`} aria-label="Detecciones YOLO en vivo"><line x1={Math.round(liveSize.width*lineRatio)} y1="0" x2={Math.round(liveSize.width*lineRatio)} y2={liveSize.height} stroke="#ffd400" strokeWidth="3" vectorEffect="non-scaling-stroke"/>{liveDetections.map((d,i)=>{const [x1,y1,x2,y2]=d.box;return <g key={`${d.trackId}-${i}`}><rect x={x1} y={y1} width={x2-x1} height={y2-y1} fill="none" stroke="#28e664" strokeWidth="2" vectorEffect="non-scaling-stroke"/><text x={x1} y={Math.max(14,y1-4)} fill="white" stroke="#111" strokeWidth="3" paintOrder="stroke">ID {d.trackId} · {d.className} · {(d.confidence*100).toFixed(0)}%</text></g>;})}</svg><canvas ref={captureCanvas} hidden/></div>:<p className={ui.notice} role="status">{cameras.length?'Cámara disponible; todavía no se ha iniciado.':'No se detectan cámaras disponibles.'}</p>}
      {liveActive&&<p role="status" className={ui.notice}>Cámara conectada · seguimiento Python {liveDetections.length?'activo':'iniciando'} · {liveDetections.length} objetos visibles · {liveEvents.filter(e=>e.type==='ENTRADA').length} entradas / {liveEvents.filter(e=>e.type==='SALIDA').length} salidas detectadas.</p>}
      {liveError&&<p role="alert" className={ui.alert}>{liveError}</p>}
      {liveEvents.length>0&&<><label className={s.field}>Producto para confirmar<select value={productId} onChange={e=>setProductId(e.target.value)}><option value="">Selecciona manualmente un producto…</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></label><label className={styles.mode}><input type="checkbox" checked={liveOperation} onChange={e=>setLiveOperation(e.target.checked)}/> Permitir confirmaciones manuales</label><div className={`${s.tableWrap} ${ui.tableSurface}`}><table className={s.table}><thead><tr><th>ID</th><th>Clase</th><th>Movimiento</th><th>Confianza</th><th>Fecha y hora</th><th>Estado</th></tr></thead><tbody>{liveEvents.map((event,index)=><tr key={`${event.trackId}-${index}`}><td>{event.trackId}</td><td>{event.className}</td><td>{event.type}</td><td>{(event.confidence*100).toFixed(1)}%</td><td>{new Date(event.timestamp).toLocaleString('es-PE')}</td><td>{confirmed[`live-${event.trackId}`]|| (liveOperation?<button type="button" disabled={!productId||confirmed[`live-${event.trackId}`]==='Registrado'} onClick={()=>confirmEvent({...event,trackId:`live-${event.trackId}`})}>Confirmar {event.type.toLowerCase()}</button>:'Revisión pendiente')}</td></tr>)}</tbody></table></div></>}
      {liveEvents.length>0&&<div className={styles.liveEvidence}><h3>Evidencia de cruces</h3>{liveEvents.map((event,index)=><details key={`live-evidence-${index}`}><summary>ID {event.trackId} · {event.type} · {new Date(event.timestamp).toLocaleTimeString('es-PE')}</summary><img className={styles.evidence} src={event.evidence} alt={`${event.className}, ID ${event.trackId}, ${event.type}, caja y línea virtual`}/></details>)}</div>}
      <p className={styles.help}>Las capturas de la cámara se procesan en memoria; el navegador necesita permiso y contexto seguro. La sincronización de stock siempre exige confirmación explícita.</p>
    </section>}
  </div>;
}
