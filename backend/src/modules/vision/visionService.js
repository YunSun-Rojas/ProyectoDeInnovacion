import { fail } from '../../utils/http.js';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
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

export function createVisionService({port=Number(process.env.VISION_PORT||8001),fetcher=fetch,timeout=45000}={}) {
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('VISION_PORT debe ser un puerto local válido.');
  const base=`http://127.0.0.1:${port}`;
  let busy=false;
  async function request(path,options={}){
    let response;
    try {response=await fetcher(base+path,{...options,signal:AbortSignal.timeout(timeout),redirect:'error'});}
    catch(error){throw fail(error.name==='TimeoutError'?504:503,error.name==='TimeoutError'?'El análisis excedió 45 segundos. Reintenta con una imagen más pequeña.':'No se pudo conectar al modelo. Inicia Python: python backend/yolo/service.py');}
    let result;try{result=await response.json();}catch{throw fail(502,'Respuesta incompleta del servicio Python.');}
    if(!response.ok)throw fail([400,408,413,415,429].includes(response.status)?response.status:502,result.error||'No se pudo ejecutar la inferencia.');
    return validateVisionResult(result,path==='/detect');
  }
  return {
    info:()=>request('/health'),
    async detect(req){
      if(busy)throw fail(429,'Ya hay un análisis en curso. Espera unos segundos.');
      busy=true;
      try{const {bytes,type}=await readImage(req);return await request('/detect',{method:'POST',headers:{'Content-Type':type},body:bytes});}
      finally{busy=false;}
    },
  };
}
