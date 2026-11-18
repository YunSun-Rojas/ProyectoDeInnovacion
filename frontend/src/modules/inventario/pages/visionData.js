export const MAX_IMAGE_BYTES=8*1024*1024;
export const MAX_VIDEO_BYTES=100*1024*1024;
export function visionVideoFileError(file){
  if(!file)return 'Selecciona un video MP4.';
  const isMp4=file.name?.toLowerCase().endsWith('.mp4');
  const mime=file.type?.toLowerCase();
  if(!isMp4||!['','video/mp4','application/mp4','application/octet-stream'].includes(mime))return 'Selecciona un video MP4.';
  if(file.size<1||file.size>MAX_VIDEO_BYTES)return 'El video debe pesar entre 1 byte y 100 MiB.';
  return '';
}
export function visionFileError(file){
  if(!file)return 'Selecciona una imagen.';
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))return 'Selecciona un archivo JPG, PNG o WebP.';
  if(file.size<1||file.size>MAX_IMAGE_BYTES)return 'El archivo debe pesar entre 1 byte y 8 MiB.';
  return '';
}
export function visionDimensionsError(width,height){
  return Math.min(width,height)<32||Math.max(width,height)>8192||width*height>16000000?'La imagen debe tener al menos 32 px por lado, máximo 8192 px por lado y hasta 16 megapíxeles.':'';
}
