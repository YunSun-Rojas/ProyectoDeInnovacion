import { fail } from '../../utils/http.js';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const TYPES = new Set(['image/jpeg','image/png','image/webp']);

export function imageType(bytes) {
  if(bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes.length>=12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
  return null;
}

export async function readImage(req) {
  const type=req.headers['content-type']?.split(';')[0].toLowerCase();
  if(!TYPES.has(type))throw fail(415,'Selecciona una imagen JPG, PNG o WebP.');
  const length=req.headers['content-length'];
  if(length && (!/^\d+$/.test(length)||Number(length)>MAX_IMAGE_BYTES||Number(length)<1))throw fail(413,'La imagen debe pesar entre 1 byte y 8 MiB.');
  const bytes=await new Promise((resolve,reject)=>{
    let size=0;const chunks=[];
    const timer=setTimeout(()=>finish(fail(408,'La carga de la imagen excedió 15 segundos.')),15000);
    function finish(error){
      clearTimeout(timer);req.removeListener('data',onData);req.removeListener('end',onEnd);req.removeListener('error',onError);req.removeListener('aborted',onAborted);
      if(error){req.pause();reject(error);}else resolve(Buffer.concat(chunks,size));
    }
    function onData(chunk){size+=chunk.length;if(size>MAX_IMAGE_BYTES)return finish(fail(413,'La imagen supera 8 MiB.'));chunks.push(chunk);}
    function onEnd(){finish();}
    function onError(){finish(fail(400,'No se pudo leer la imagen.'));}
    function onAborted(){finish(fail(400,'Carga de imagen cancelada.'));}
    req.on('data',onData);req.once('end',onEnd);req.once('error',onError);req.once('aborted',onAborted);
  });
  if(!bytes.length || (length && bytes.length!==Number(length)))throw fail(400,'La carga de la imagen está incompleta.');
  if(imageType(bytes)!==type)throw fail(415,'El contenido del archivo no corresponde a JPG, PNG o WebP.');
  return { bytes,type };
}

export function validateVisionResult(result, detection=false) {
  if(result?.model!=='monitores_v1/best.pt'||!Array.isArray(result.classes)||!result.classes.length||result.classes.some(c=>!Number.isInteger(c.id)||typeof c.name!=='string'))throw fail(502,'El servicio no devolvió los metadatos del modelo entrenado.');
  if(detection){
    if(!Number.isInteger(result.width)||!Number.isInteger(result.height)||Math.min(result.width,result.height)<32||Math.max(result.width,result.height)>8192||result.width*result.height>16000000||!Array.isArray(result.detections)||result.detections.length>100)throw fail(502,'Respuesta de inferencia incompleta.');
    for(const d of result.detections){
      if(!result.classes.some(c=>c.id===d.classId&&c.name===d.className)||!Number.isFinite(d.confidence)||d.confidence<0||d.confidence>1||!Array.isArray(d.box)||d.box.length!==4||d.box.some(v=>!Number.isFinite(v))||d.box[0]<0||d.box[1]<0||d.box[2]<=d.box[0]||d.box[3]<=d.box[1]||d.box[2]>result.width||d.box[3]>result.height)throw fail(502,'El servicio devolvió una detección inválida.');
    }
  }
  return result;
}

function validateVideoResult(result){
  validateVisionResult(result);
  if(!Number.isInteger(result.width)||!Number.isInteger(result.height)||!Number.isInteger(result.totalFrames)
    ||!Number.isInteger(result.processedFrames)||result.processedFrames<1||result.processedFrames>result.totalFrames
    ||!result.line||!Number.isFinite(result.line.x)||!Number.isFinite(result.line.margin)
    ||!Array.isArray(result.events)||result.events.length>10000
    ||!Number.isInteger(result.counts?.entradas)||!Number.isInteger(result.counts?.salidas)
    ||result.counts.entradas+result.counts.salidas!==result.events.length)throw fail(502,'Respuesta incompleta del procesamiento de video.');
  for(const event of result.events){
    if(!Number.isInteger(event.trackId)||!['ENTRADA','SALIDA'].includes(event.type)||!Number.isInteger(event.frame)
      ||event.frame<1||event.frame>result.processedFrames||!result.classes.some(c=>c.id===event.classId&&c.name===event.className)
      ||!Number.isFinite(event.confidence)||event.confidence<0||event.confidence>1
      ||!Array.isArray(event.box)||event.box.length!==4||event.box.some(v=>!Number.isFinite(v))
      ||!Number.isFinite(Date.parse(event.timestamp))||!(event.evidence===null||(typeof event.evidence==='string'&&event.evidence.startsWith('data:image/jpeg;base64,')&&event.evidence.length<2_000_000)))throw fail(502,'El servicio devolvió un evento de video inválido.');
  }
  return result;
}

function validateTrackResult(result){
  validateVisionResult(result);
  if(!Number.isInteger(result.width)||!Number.isInteger(result.height)||!Array.isArray(result.detections))throw fail(502,'Respuesta de seguimiento incompleta.');
  for(const d of result.detections)if(!Number.isInteger(d.trackId)||!result.classes.some(c=>c.id===d.classId&&c.name===d.className)
    ||!Number.isFinite(d.confidence)||d.confidence<0||d.confidence>1||!Array.isArray(d.box)||d.box.length!==4
    ||d.box.some(v=>!Number.isFinite(v))||!(d.event===null||['ENTRADA','SALIDA'].includes(d.event)))throw fail(502,'Detección de cámara inválida.');
  return result;
}

export async function readVideo(req) {
  if(req.headers['content-type']?.split(';')[0].toLowerCase()!=='video/mp4')throw fail(415,'Selecciona un video MP4.');
  const length=req.headers['content-length'];
  if(length&&(!/^\d+$/.test(length)||Number(length)<1||Number(length)>MAX_VIDEO_BYTES))throw fail(413,'El video debe pesar entre 1 byte y 100 MiB.');
  const bytes=await new Promise((resolve,reject)=>{
    let size=0;const chunks=[];
    const timer=setTimeout(()=>finish(fail(408,'La carga del video excedió 60 segundos.')),60000);
    function finish(error){clearTimeout(timer);req.removeListener('data',onData);req.removeListener('end',onEnd);req.removeListener('error',onError);req.removeListener('aborted',onAbort);if(error){req.pause();reject(error);}else resolve(Buffer.concat(chunks,size));}
    function onData(chunk){size+=chunk.length;if(size>MAX_VIDEO_BYTES)return finish(fail(413,'El video supera 100 MiB.'));chunks.push(chunk);}
    function onEnd(){finish();} function onError(){finish(fail(400,'No se pudo leer el video.'));} function onAbort(){finish(fail(400,'Carga de video cancelada.'));}
    req.on('data',onData);req.once('end',onEnd);req.once('error',onError);req.once('aborted',onAbort);
  });
  if(!bytes.length||(length&&bytes.length!==Number(length)))throw fail(400,'La carga del video está incompleta.');
  if(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp')throw fail(415,'El archivo no contiene una firma MP4 válida.');
  return bytes;
}

export function createVisionService({port=Number(process.env.VISION_PORT||8001),fetcher=fetch,timeout=45000}={}) {
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('VISION_PORT debe ser un puerto local válido.');
  const base=`http://127.0.0.1:${port}`;
  let busy=false;
  async function request(path,options={},duration=timeout){
    let response;
    try {response=await fetcher(base+path,{...options,signal:AbortSignal.timeout(duration),redirect:'error'});}
    catch(error){
      console.error('[vision] python_request_failed',{path,error:error.message});
      throw fail(error.name==='TimeoutError'?504:503,error.name==='TimeoutError'?'El servicio de visión excedió el tiempo permitido.':'No se pudo conectar al modelo. Inicia Python: python backend/yolo/service.py');
    }
    let result;try{result=await response.json();}catch(error){console.error('[vision] python_invalid_json',{path,error:error.message});throw fail(502,'Respuesta incompleta del servicio Python.');}
    if(!response.ok){console.error('[vision] python_http_error',{path,status:response.status,error:result.error});throw fail([400,408,413,415,429].includes(response.status)?response.status:502,result.error||'No se pudo ejecutar la inferencia.');}
    if(path.endsWith('/result'))return validateVideoResult(result);
    if(path==='/detect')return validateVisionResult(result,true);
    if(path==='/health')return validateVisionResult(result);
    if(path==='/track')return validateTrackResult(result);
    return result;
  }
  return {
    info:()=>request('/health'),
    async detect(req){
      if(busy)throw fail(429,'Ya hay un análisis en curso. Espera unos segundos.');
      busy=true;
      try{const {bytes,type}=await readImage(req);return await request('/detect',{method:'POST',headers:{'Content-Type':type},body:bytes});}
      finally{busy=false;}
    },
    async startVideo(req,config={}){
      const bytes=await readVideo(req);
      console.info('[vision] video_upload_received',{bytes:bytes.length});
      const query=new URLSearchParams({lineRatio:String(config.lineRatio??.5),leftToRight:config.leftToRight??'SALIDA',rightToLeft:config.rightToLeft??'ENTRADA'});
      const task=await request(`/video?${query}`,{method:'POST',headers:{'Content-Type':'video/mp4'},body:bytes},120000);
      console.info('[vision] video_task_created',{jobId:task.jobId,status:task.status});
      return task;
    },
    videoStatus:id=>request(`/video/${safeJobId(id)}/status`),
    videoResult:id=>request(`/video/${safeJobId(id)}/result`),
    cancelVideo:id=>request(`/video/${safeJobId(id)}/cancel`,{method:'POST'}),
    async videoOutput(id){
      let response;
      try{response=await fetcher(`${base}/video/${safeJobId(id)}/output`,{signal:AbortSignal.timeout(timeout),redirect:'error'});}
      catch{throw fail(503,'No se pudo cargar el video anotado.');}
      if(!response.ok)throw fail(response.status===409?409:502,'El video anotado no está disponible.');
      return response.body;
    },
    async liveReset(config={}){
      if(busy)throw fail(429,'El modelo está ocupado.');
      return request('/live/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)});
    },
    async liveFrame(req){
      if(busy)throw fail(429,'El modelo está ocupado. Espera al fotograma actual.');
      busy=true;
      try{const {bytes,type}=await readImage(req);return await request('/track',{method:'POST',headers:{'Content-Type':type},body:bytes});}
      finally{busy=false;}
    },
  };
}

function safeJobId(id){if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw fail(400,'Identificador de tarea inválido.');return id;}
