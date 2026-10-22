import { useEffect, useRef, useState } from 'react';
import { Eye, ImagePlus, RefreshCw, ScanLine } from 'lucide-react';
import { api } from '../../../api/httpClient';
import { visionFileError, visionDimensionsError } from './visionData';
import s from './Management.module.css';
import ui from './InventoryUI.module.css';
import styles from './Vision.module.css';

export default function Vision() {
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
  return <div className={`${s.page} ${ui.workspace} ${styles.workspace}`}>
    <header className={`${s.header} ${ui.heading} ${styles.heading}`}><div><h1>Reconocimiento visual</h1></div></header>
    <section className={`${s.card} ${styles.modelStatus}`} data-connected={!!model} aria-label="Estado del modelo">
      <div className={styles.modelSummary}><ScanLine size={22} aria-hidden="true" /><strong role="status">{model?'Modelo conectado':checking?'Comprobando modelo…':'Modelo no conectado'}</strong><button type="button" className={`${ui.secondary} ${ui.savingButton}`} aria-busy={checking} disabled={checking||scanning} onClick={()=>{setChecking(true);setModel(null);setModelError('');setAttempt(n=>n+1);}}>Comprobar modelo</button></div>
      {model&&<details className={styles.modelDetails}><summary>Información del modelo</summary><p className={styles.modelText}>{model.model} · Clases reales: {model.classes.map(c=>c.name).join(', ')} · Umbral de confianza: {Math.round(model.confidenceThreshold*100)} % · Entrada YOLO: {model.imageSize} px</p><p className={styles.modelText}>Solo reconoce las clases aprendidas; no identifica automáticamente todas las categorías ni SKU del catálogo.</p></details>}
      {modelError&&<div className={styles.modelIssue} role="alert"><p>No se pudo comprobar el modelo.</p><details className={styles.modelDetails}><summary>Detalles de conexión</summary><p className={styles.modelText}>{modelError}</p></details></div>}
    </section>
    <div className={styles.grid}>
      <section className={`${s.card} ${styles.upload}`} aria-label="Imagen de entrada">
        <h2 className={styles.title}>Imagen de entrada</h2>
        <label className={s.field}><span><ImagePlus size={17} aria-hidden="true" /> Seleccionar imagen</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={scanning} onChange={select} aria-describedby="vision-file-help" /></label>
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
    </div>
  </div>;
}
