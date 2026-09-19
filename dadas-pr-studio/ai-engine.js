let faceDetectorPromise=null;
let ocrWorkerPromise=null;
let personSegmenterPromise=null;

const FACE_MODULE='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm';
const FACE_WASM='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';
const FACE_MODEL='https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite';
const OCR_MODULE='https://cdn.jsdelivr.net/npm/tesseract.js@6/+esm';
const BODY_SEG_MODULE='https://cdn.jsdelivr.net/npm/@tensorflow-models/body-segmentation@1.0.2/+esm';
const SELFIE_SEG_PATH='https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747';


function notify(cb,msg){try{cb&&cb(msg)}catch{}}

async function getFaceDetector(cb){
  if(faceDetectorPromise)return faceDetectorPromise;
  faceDetectorPromise=(async()=>{
    notify(cb,'Loading local face detector…');
    const vision=await import(FACE_MODULE);
    const files=await vision.FilesetResolver.forVisionTasks(FACE_WASM);
    return vision.FaceDetector.createFromOptions(files,{
      baseOptions:{modelAssetPath:FACE_MODEL},
      runningMode:'IMAGE',
      minDetectionConfidence:0.45,
      minSuppressionThreshold:0.25
    });
  })();
  try{return await faceDetectorPromise}catch(err){faceDetectorPromise=null;throw err}
}

async function getOCR(cb){
  if(ocrWorkerPromise)return ocrWorkerPromise;
  ocrWorkerPromise=(async()=>{
    notify(cb,'Loading local OCR for Marathi / Hindi / English…');
    const mod=await import(OCR_MODULE);
    try{
      return await mod.createWorker(['eng','hin','mar'],1,{logger:m=>{
        if(m&&m.status&&typeof m.progress==='number')notify(cb,m.status+' '+Math.round(m.progress*100)+'%');
      }});
    }catch{
      return mod.createWorker(['eng','hin'],1,{logger:m=>{
        if(m&&m.status&&typeof m.progress==='number')notify(cb,m.status+' '+Math.round(m.progress*100)+'%');
      }});
    }
  })();
  try{return await ocrWorkerPromise}catch(err){ocrWorkerPromise=null;throw err}
}

function tokens(text){
  try{return (String(text||'').normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[])}
  catch{return String(text||'').toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>1)}
}
function normalize(text){return tokens(text).join(' ')}
function relevance(text,context){
  const a=new Set(tokens(text)),b=new Set(tokens(context));
  if(!a.size||!b.size)return 0;
  let hit=0;for(const t of a)if(b.has(t))hit++;
  return Math.min(100,Math.round((hit/Math.max(2,Math.min(a.size,b.size)))*100));
}
function chooseFace(detections,w,h){
  if(!detections||!detections.length)return null;
  let best=null,bestScore=-Infinity;
  for(const d of detections){
    const b=d.boundingBox;if(!b)continue;
    const cx=(b.originX+b.width/2)/w,cy=(b.originY+b.height/2)/h;
    const area=(b.width*b.height)/(w*h);
    const center=1-Math.min(1,Math.hypot(cx-.5,cy-.46));
    const score=area*3+center;
    if(score>bestScore){bestScore=score;best={x:cx,y:cy,w:b.width/w,h:b.height/h}}
  }
  return best;
}


async function getPersonSegmenter(cb){
  if(personSegmenterPromise)return personSegmenterPromise;
  personSegmenterPromise=(async()=>{
    notify(cb,'Loading person cutout model…');
    const body=await import(BODY_SEG_MODULE);
    const model=body.SupportedModels.MediaPipeSelfieSegmentation;
    const segmenter=await body.createSegmenter(model,{
      runtime:'mediapipe',
      modelType:'general',
      solutionPath:SELFIE_SEG_PATH
    });
    return {body,segmenter};
  })();
  try{return await personSegmenterPromise}catch(err){personSegmenterPromise=null;throw err}
}
async function personCutout(source,opts){
  opts=opts||{};const onStatus=opts.onStatus;
  try{
    const {body,segmenter}=await getPersonSegmenter(onStatus);
    notify(onStatus,'Extracting foreground subject…');
    const people=await segmenter.segmentPeople(source,{multiSegmentation:false,segmentBodyParts:false});
    if(!people||!people.length)return null;
    const mask=await body.toMask(
      people,
      {r:255,g:255,b:255,a:255},
      {r:0,g:0,b:0,a:0},
      false,
      .48
    );
    const mw=mask.width||source.width,mh=mask.height||source.height;
    const maskCanvas=document.createElement('canvas');maskCanvas.width=mw;maskCanvas.height=mh;
    maskCanvas.getContext('2d').putImageData(mask,0,0);
    const out=document.createElement('canvas');out.width=source.width;out.height=source.height;
    const q=out.getContext('2d');q.drawImage(source,0,0);
    q.globalCompositeOperation='destination-in';q.imageSmoothingEnabled=true;
    q.drawImage(maskCanvas,0,0,out.width,out.height);q.globalCompositeOperation='source-over';
    return out;
  }catch(err){
    notify(onStatus,'Person cutout unavailable; using depth crop fallback.');
    return null;
  }
}

async function browserTextDetector(canvas){
  if(!('TextDetector' in window))return '';
  try{
    const detector=new TextDetector();
    const blocks=await detector.detect(canvas);
    return blocks.map(b=>b.rawValue||'').join(' ').trim();
  }catch{return ''}
}

async function analyzeCanvas(canvas,opts){
  opts=opts||{};
  const context=opts.context||'',personNames=opts.personNames||[],ocr=opts.ocr!==false,faces=opts.faces!==false,onStatus=opts.onStatus;
  let faceCount=0,focal=null,ocrText='',faceError='',ocrError='';
  if(faces){
    try{
      const detector=await getFaceDetector(onStatus);
      const result=detector.detect(canvas);
      const detections=(result&&result.detections)||[];
      faceCount=detections.length;
      focal=chooseFace(detections,canvas.width,canvas.height);
    }catch(err){faceError=(err&&err.message)||'Face detector unavailable'}
  }
  if(ocr){
    try{
      notify(onStatus,'Reading text locally…');
      ocrText=await browserTextDetector(canvas);
      if(!ocrText){
        const worker=await getOCR(onStatus);
        const result=await worker.recognize(canvas);
        ocrText=((result&&result.data&&result.data.text)||'').replace(/\s+/g,' ').trim();
      }
    }catch(err){ocrError=(err&&err.message)||'OCR unavailable'}
  }
  const normalized=normalize(ocrText);
  const nameInText=personNames.some(n=>{
    const q=normalize(n);return q&&normalized.includes(q);
  });
  return {
    faceCount:faceCount,
    focal:focal,
    ocrText:ocrText,
    relevance:relevance(ocrText,context),
    nameInText:nameInText,
    faceError:faceError,
    ocrError:ocrError
  };
}

window.LocalAI={
  analyzeCanvas:analyzeCanvas,
  personCutout:personCutout,
  relevance:relevance,
  tokens:tokens,
  version:'1.1-local-cutout'
};
window.dispatchEvent(new Event('local-ai-ready'));
