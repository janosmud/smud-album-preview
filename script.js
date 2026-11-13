const tracks=["für_dich","schon_genug","sag_mir_wer","ein_stück","seit_immer","bist_du_da_?","ich_hab_dein_pt1","kommst_du_raus","nicht_allein_outro"];
const audioFiles=["mp3/01-Für dich master.mp3","mp3/02-schon genug master.mp3","mp3/03 sag_mir_wer.mp3","mp3/04 ein_stueck.mp3","mp3/05 seit_immer.mp3","mp3/06 bist_du_da_.mp3","mp3/07 ich hab dein.mp3","mp3/08 kommst_du_raus.mp3","mp3/09 nicht_allein_outro.mp3"];
const trackDurations=["2:44","3:12","4:07","2:40","2:31","1:57","1:47","1:20","3:34"];
const audio=document.querySelector('#audio');
const list=document.querySelector('#tracklist');
const player=document.querySelector('.player');
const vinyl=document.querySelector('.vinyl');
const playButton=document.querySelector('#play');
const likeButton=document.querySelector('#like');
const likeCount=document.querySelector('#like-count');
const likeStorageKey='smud-like-data-v1';
let localLikeState=readLocalLikeState();
const pendingPlayKey='smud-pending-play-events-v1';
let pendingPlayEvents=readPendingPlayEvents();
let playEventTracked=false;
let playEventSending=false;
let current=-1;
let audioContext;
let analyser;
let audioOutputGain;
let frequencyData;
let animationFrame;
let playbackRampFrame=0;
let playbackRampToken=0;
let playbackTransition='idle';
let vinylFrame=0;
let vinylLastFrame=0;
let vinylAngle=0;
const meterFrequencies=[50,70,100,150,200,350,500,750,1000,1500,2000,3500,5000,7000,10000];
const barLevels=Array(meterFrequencies.length).fill(0);
const lyricFolders=["01-fuer_dich","02-schon_genug","03-sag_mir_wer","04-ein_stueck","05-seit_immer","06-bist_du_da","07-ich_hab_dein_pt1","08-kommst_du_raus","09-nicht_allein_outro"];
let lyricEntries=[];
let lyricRequest=0;
let lyricStatus='';
let lyricDisplayPlans=[];
const lyricFloatNodes=new Map();
let trackTitleNode=null;
let trackTitleFadeTimer=0;
let trackTitleRemoveTimer=0;
let trackTitleRepeatTimer=0;
let trackTitleSequence=0;
const backgroundVideo=document.querySelector('#background-video');
const backgroundVideoNext=document.querySelector('#background-video-next');
const lyricsBackdrop=document.querySelector('#lyrics-backdrop');
const mobileLyrics=document.querySelector('#mobile-lyrics');
const backgroundVideoLayers=[backgroundVideo,backgroundVideoNext];
const backgroundVideoFile='Adobe Express - IMG_3101.mp4';
const loadedBackgroundVideoSources=new WeakSet();
let activeBackgroundVideo=null;
let videoSwitchToken=0;
let previousSpectrum;
let spectrumPrimed=false;
let onsetCalibrationFrames=0;
let onsetFluxBaselines={};
let lastDetectedOnset=-Infinity;
let lastVideoSwitchTime=-Infinity;
const prefersReducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');

const backgroundVideoSource=`assets/Videos/${encodeURIComponent(backgroundVideoFile)}`;
backgroundVideoLayers.forEach(video=>video.addEventListener('ended',()=>{
  if(video===activeBackgroundVideo&&!audio.paused)setBackgroundVideo(true);
}));

tracks.forEach((title,index)=>{
  const row=document.createElement('li');
  row.className='track-row'; row.tabIndex=0; row.setAttribute('role','button');
  row.setAttribute('aria-label',`${String(index+1).padStart(2,'0')} ${title} abspielen`);
  row.innerHTML=`<span class="track-num">${String(index+1).padStart(2,'0')}</span><span class="track-title"></span><span class="track-duration">${trackDurations[index]}</span>`;
  row.querySelector('.track-title').textContent=title;
  row.addEventListener('click',()=>selectTrack(index,true));
  row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectTrack(index,true)}});
  list.append(row);
});

function selectTrack(index,autoplay){
  current=(index+tracks.length)%tracks.length;
  playEventTracked=false;
  updateLikeButton();
  resetVisualizer();
  resetBeatDetector();
  vinyl.classList.remove('playing');
  stopVinylSpin();
  vinylAngle=0;
  vinyl.style.transform='rotate(0deg)';
  document.querySelector('#vinyl-center').textContent=String(current+1).padStart(2,'0');
  const rows=[...list.children];
  rows.forEach((row,i)=>{row.classList.toggle('active',i===current);if(i===current)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current')});
  document.querySelector('#now-title').textContent=tracks[current];
  document.querySelector('#now-state').textContent='AUDIO WIRD GELADEN';
  lyricStatus='';
  loadLyrics(current);
  const source=`assets/audio/${audioFiles[current].split('/').map(encodeURIComponent).join('/')}`;
  audio.src=source;
  if(autoplay)startPlayback();
}
function startVisualizer(){
  const bars=[...document.querySelectorAll('.sound-wave i')];
  bars.forEach((bar,index)=>{bar.title=`${meterFrequencies[index]} Hz`});
  if(!analyser){
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass)return;
    try{
      audioContext=new AudioContextClass();
      analyser=audioContext.createAnalyser();
      analyser.fftSize=2048;
      analyser.smoothingTimeConstant=0;
      frequencyData=new Uint8Array(analyser.frequencyBinCount);
      previousSpectrum=new Uint8Array(analyser.frequencyBinCount);
      const source=audioContext.createMediaElementSource(audio);
      audioOutputGain=audioContext.createGain();
      audioOutputGain.gain.value=1;
      source.connect(analyser);
      analyser.connect(audioOutputGain);
      audioOutputGain.connect(audioContext.destination);
    }catch(error){analyser=null;return}
  }
  audioContext.resume();
  cancelAnimationFrame(animationFrame);
  const draw=()=>{
    if(audio.paused)return;
    analyser.getByteFrequencyData(frequencyData);
    updateSeekProgress();
    bars.forEach((bar,index)=>{
      const frequency=meterFrequencies[index];
      const previous=meterFrequencies[index-1];
      const next=meterFrequencies[index+1];
      const lower=previous?Math.sqrt(previous*frequency):frequency/Math.sqrt(next/frequency);
      const upper=next?Math.sqrt(frequency*next):frequency*Math.sqrt(frequency/previous);
      const binWidth=audioContext.sampleRate/analyser.fftSize;
      const start=Math.max(1,Math.floor(lower/binWidth));
      const end=Math.min(frequencyData.length,Math.max(start+1,Math.ceil(upper/binWidth)));
      let sum=0;
      for(let bin=start;bin<end;bin++)sum+=frequencyData[bin];
      const average=sum/(end-start);
      const target=average<8?0:Math.min(1,(average-8)/190);
      barLevels[index]=target>barLevels[index]
        ?barLevels[index]+(target-barLevels[index])*.68
        :barLevels[index]*.64;
      bar.style.height=barLevels[index]<.035?'0px':`${barLevels[index]*14}px`;
    });
    checkForVideoBeat();
    animationFrame=requestAnimationFrame(draw);
  };
  draw();
}
function setBackgroundVideo(randomPosition=true){
  if(prefersReducedMotion.matches)return;
  const token=++videoSwitchToken;
  const target=activeBackgroundVideo===backgroundVideo?backgroundVideoNext:backgroundVideo;
  const readyToShow=()=>{
    if(token!==videoSwitchToken)return;
    const showTarget=()=>{
      if(token!==videoSwitchToken)return;
      const previous=activeBackgroundVideo;
      const activate=()=>{
        target.classList.add('is-visible');
        activeBackgroundVideo=target;
        if(previous&&previous!==target){previous.classList.remove('is-visible');previous.pause()}
      };
      if(audio.paused){target.pause();activate()}
      else target.play().then(activate).catch(()=>{});
    };
    if(randomPosition&&Number.isFinite(target.duration)&&target.duration>2){
      let randomTime=Math.random()*Math.max(0,target.duration-1);
      const currentTime=activeBackgroundVideo?.currentTime;
      if(Number.isFinite(currentTime)&&target.duration>12&&Math.abs(randomTime-currentTime)<5){randomTime=(randomTime+target.duration/2)%target.duration}
      target.addEventListener('seeked',showTarget,{once:true});
      target.currentTime=randomTime;
      if(!target.seeking)showTarget();
    }else showTarget();
  };
  const targetReady=()=>{
    if(token!==videoSwitchToken)return;
    if(target.readyState>=2)readyToShow();
    else target.addEventListener('loadeddata',readyToShow,{once:true});
  };
  target.pause();
  if(!loadedBackgroundVideoSources.has(target)){
    loadedBackgroundVideoSources.add(target);
    target.src=backgroundVideoSource;
    target.load();
  }
  if(target.readyState>=1)targetReady();
  else target.addEventListener('loadedmetadata',targetReady,{once:true});
}
function checkForVideoBeat(){
  if(!analyser||audio.paused||prefersReducedMotion.matches||!previousSpectrum)return;
  if(!spectrumPrimed){previousSpectrum.set(frequencyData);spectrumPrimed=true;return}
  const binWidth=audioContext.sampleRate/analyser.fftSize;
  const sensitivity=Number(document.querySelector('#video-sensitivity').value)/100;
  const kick=measureSpectralFlux(40,130,binWidth);
  const snareBody=measureSpectralFlux(150,250,binWidth);
  const snareAttack=measureSpectralFlux(1000,5000,binWidth);
  previousSpectrum.set(frequencyData);
  const frame=onsetCalibrationFrames++;
  const fluxThreshold=region=>Math.max(.022+(1-sensitivity)*.018,region.baseline*(7.5-sensitivity*4.5)+.016);
  const kickThreshold=fluxThreshold(kick);
  const bodyThreshold=fluxThreshold(snareBody);
  const attackThreshold=fluxThreshold(snareAttack);
  const kickHit=document.querySelector('#kick-detection').checked&&kick.flux>kickThreshold&&kick.level>.095;
  const bodyRatio=snareBody.flux/bodyThreshold;
  const attackRatio=snareAttack.flux/attackThreshold;
  const snareHit=document.querySelector('#snare-detection').checked&&bodyRatio>1.15&&attackRatio>1.15&&(bodyRatio*.45+attackRatio*.55)>2.25&&snareBody.level>.075&&snareAttack.level>.08;
  updateFluxBaselines([kick,snareBody,snareAttack],frame);
  const now=performance.now();
  if(frame<120||(!kickHit&&!snareHit)||now-lastDetectedOnset<500)return;
  lastDetectedOnset=now;
  const cooldown=Number(document.querySelector('#video-cooldown').value);
  if(now-lastVideoSwitchTime<cooldown)return;
  lastVideoSwitchTime=now;
  setBackgroundVideo(true);
}
function measureSpectralFlux(lowHz,highHz,binWidth){
  const firstBin=Math.max(1,Math.floor(lowHz/binWidth));
  const lastBin=Math.min(frequencyData.length,Math.max(firstBin+1,Math.ceil(highHz/binWidth)));
  let fluxPower=0;
  let levelPower=0;
  for(let bin=firstBin;bin<lastBin;bin++){
    const current=frequencyData[bin]/255;
    const previous=previousSpectrum[bin]/255;
    const positiveChange=Math.max(0,current-previous);
    fluxPower+=positiveChange*positiveChange;
    levelPower+=current*current;
  }
  const count=Math.max(1,lastBin-firstBin);
  const key=`${lowHz}-${highHz}`;
  const flux=Math.sqrt(fluxPower/count);
  const baseline=onsetFluxBaselines[key];
  return {flux,level:Math.sqrt(levelPower/count),baseline:baseline??flux,key};
}
function updateFluxBaselines(regions,frame){
  for(const region of regions){
    const baseline=onsetFluxBaselines[region.key];
    if(baseline===undefined)onsetFluxBaselines[region.key]=region.flux;
    else{
      const alpha=frame<120?.08:.012;
      if(region.flux<baseline*1.8)onsetFluxBaselines[region.key]=baseline+(region.flux-baseline)*alpha;
    }
  }
}
function resetBeatDetector(){
  if(previousSpectrum)previousSpectrum.fill(0);
  spectrumPrimed=false;
  onsetCalibrationFrames=0;
  lastDetectedOnset=-Infinity;
  onsetFluxBaselines={};
}
prefersReducedMotion.addEventListener?.('change',event=>{
  if(event.matches){backgroundVideoLayers.forEach(video=>video.pause());stopVinylSpin()}
  else if(!audio.paused){startVinylSpin();if(activeBackgroundVideo)activeBackgroundVideo.play().catch(()=>{});else setBackgroundVideo(false)}
});
function stopVisualizer(){
  cancelAnimationFrame(animationFrame);
}
function resetVisualizer(){
  stopVisualizer();
  barLevels.fill(0);
  document.querySelectorAll('.sound-wave i').forEach(bar=>bar.style.height='0px');
}
function setPlaying(playing){
  player.classList.toggle('is-playing',playing);
  vinyl.classList.toggle('playing',playing);
  updatePlaybackButton(playing);
  if(playing){
    startVisualizer();
    startVinylSpin();
  }else{
    stopVisualizer();
    stopVinylSpin();
    spectrumPrimed=false;
    backgroundVideoLayers.forEach(video=>video.pause());
  }
}
function updatePlaybackButton(playing){
  playButton.innerHTML=playing?'<span class="pause-symbol" aria-hidden="true"><i></i><i></i></span>':'<svg class="play-symbol" viewBox="0 0 20 24" aria-hidden="true"><path d="M5 3.5v17L19 12 5 3.5Z" fill="currentColor"/></svg>';
  playButton.setAttribute('aria-label',playing?'Pausieren':'Abspielen');
  playButton.title=playing?'Pausieren':'Abspielen';
}
function rampPlaybackRate(target,duration,complete){
  cancelAnimationFrame(playbackRampFrame);
  const token=++playbackRampToken;
  const initial=audio.playbackRate||1;
  const started=performance.now();
  const update=now=>{
    if(token!==playbackRampToken)return;
    const progress=Math.min(1,(now-started)/duration);
    const eased=progress*progress*(3-2*progress);
    audio.playbackRate=initial+(target-initial)*eased;
    if(progress<1)playbackRampFrame=requestAnimationFrame(update);
    else{playbackRampFrame=0;audio.playbackRate=target;complete?.()}
  };
  playbackRampFrame=requestAnimationFrame(update);
}
function rampOutputGain(target,duration=.04){
  if(!audioOutputGain||!audioContext)return;
  const gain=audioOutputGain.gain;
  const now=audioContext.currentTime;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value,now);
  if(duration<=0)gain.setValueAtTime(target,now);
  else gain.linearRampToValueAtTime(target,now+duration);
}
function startPlayback(){
  if(!audio.paused){
    cancelAnimationFrame(playbackRampFrame);
    playbackRampFrame=0;
    playbackRampToken++;
    audio.playbackRate=1;
    rampOutputGain(1,.025);
    playbackTransition='starting';
    updatePlaybackButton(true);
    playbackTransition='playing';
    return;
  }
  cancelAnimationFrame(playbackRampFrame);
  playbackRampFrame=0;
  playbackRampToken++;
  playbackTransition='starting';
  audio.playbackRate=1;
  audio.preservesPitch=false;
  if('webkitPreservesPitch'in audio)audio.webkitPreservesPitch=false;
  updatePlaybackButton(true);
  startVisualizer();
  rampOutputGain(0,0);
  audio.play().then(()=>{rampOutputGain(1,.045);playbackTransition='playing'}).catch(()=>{
    playbackTransition='idle';
    audio.playbackRate=1;
    document.querySelector('#now-state').textContent='AUDIODATEI KANN NICHT ABGESPIELT WERDEN';
    setPlaying(false);
  });
}
function pausePlayback(){
  if(audio.paused)return;
  playbackTransition='stopping';
  updatePlaybackButton(false);
  rampPlaybackRate(.5,750,()=>{
    if(playbackTransition!=='stopping')return;
    rampOutputGain(0,.05);
    window.setTimeout(()=>{
      if(playbackTransition!=='stopping')return;
      audio.pause();
      audio.playbackRate=1;
      playbackTransition='idle';
    },55);
  });
}
function startVinylSpin(){
  if(prefersReducedMotion.matches||audio.paused||vinylFrame)return;
  vinylLastFrame=0;
  const rotate=now=>{
    if(audio.paused||prefersReducedMotion.matches){stopVinylSpin();return}
    if(vinylLastFrame)vinylAngle+=((now-vinylLastFrame)*360*audio.playbackRate)/(7*1000);
    vinylLastFrame=now;
    vinyl.style.transform=`rotate(${vinylAngle%360}deg)`;
    vinylFrame=requestAnimationFrame(rotate);
  };
  vinylFrame=requestAnimationFrame(rotate);
}
function stopVinylSpin(){
  cancelAnimationFrame(vinylFrame);
  vinylFrame=0;
  vinylLastFrame=0;
}
playButton.addEventListener('click',()=>{
  playButton.classList.add('is-pressed');
  window.setTimeout(()=>playButton.classList.remove('is-pressed'),130);
  if(current<0)selectTrack(0,false);
  if(audio.paused||playbackTransition==='stopping')startPlayback();
  else pausePlayback();
});
document.querySelector('#prev').addEventListener('click',()=>selectTrack(current<=0?tracks.length-1:current-1,true));
document.querySelector('#next').addEventListener('click',()=>selectTrack(current<0?0:current+1,true));
audio.addEventListener('play',()=>setPlaying(true));audio.addEventListener('pause',()=>setPlaying(false));
audio.addEventListener('playing',()=>{
  if(!prefersReducedMotion.matches){if(activeBackgroundVideo)activeBackgroundVideo.play().catch(()=>{});else setBackgroundVideo(false)}
  trackCurrentPlay();
});
audio.addEventListener('loadedmetadata',()=>{document.querySelector('#duration').textContent=format(audio.duration);document.querySelector('#now-state').textContent=lyricStatus||'SMUD · am_ende_bin_ich_da';list.children[current].querySelector('.track-duration').textContent=format(audio.duration)});
audio.addEventListener('error',()=>{if(current>=0)document.querySelector('#now-state').textContent='DATEI KANN NICHT GELADEN WERDEN'});
audio.addEventListener('timeupdate',updateSeekProgress);
audio.addEventListener('timeupdate',updateLyrics);
audio.addEventListener('ended',()=>selectTrack(current+1,true));
document.querySelector('#seek').addEventListener('input',event=>{if(audio.duration)audio.currentTime=Number(event.target.value)/100*audio.duration;updateSeekProgress()});
document.querySelector('#volume').addEventListener('input',event=>{audio.volume=Number(event.target.value)/100;document.querySelector('#volume-value').textContent=event.target.value});
audio.volume=.75;
const sensitivityControl=document.querySelector('#video-sensitivity');
const cooldownControl=document.querySelector('#video-cooldown');
sensitivityControl.addEventListener('input',()=>document.querySelector('#sensitivity-value').textContent=sensitivityControl.value);
cooldownControl.addEventListener('input',()=>document.querySelector('#cooldown-value').textContent=`${(Number(cooldownControl.value)/1000).toFixed(1)}s`);
likeButton.addEventListener('click',()=>{
  if(current<0)return;
  const key=String(current+1);
  const isLiked=!Boolean(localLikeState.liked[key]);
  localLikeState.liked[key]=isLiked;
  localLikeState.events.push({
    trackNumber:current+1,
    track:tracks[current],
    action:isLiked?'like':'unlike',
    timestamp:new Date().toISOString()
  });
  saveLocalLikeState();
  updateLikeButton();
});
document.querySelector('#like-history-export').addEventListener('click',exportLikeHistory);
window.SMUDLikes={getHistory:()=>localLikeState.events.map(event=>({...event})),exportHistory:exportLikeHistory};
function readLocalLikeState(){
  try{
    const saved=JSON.parse(localStorage.getItem(likeStorageKey)||'null');
    if(saved&&saved.version===1&&saved.liked&&Array.isArray(saved.events))return saved;
  }catch(error){}
  return {version:1,liked:{},events:[]};
}
function saveLocalLikeState(){
  try{localStorage.setItem(likeStorageKey,JSON.stringify(localLikeState))}
  catch(error){console.warn('Likes konnten in diesem Browser nicht gespeichert werden.',error)}
}
function updateLikeButton(){
  const hasTrack=current>=0;
  const isLiked=hasTrack&&Boolean(localLikeState.liked[String(current+1)]);
  likeButton.disabled=!hasTrack;
  likeButton.setAttribute('aria-pressed',String(isLiked));
  likeButton.setAttribute('aria-label',hasTrack?`${isLiked?'Like entfernen für':'Track liken'}: ${tracks[current]}`:'Track liken');
  likeButton.title=hasTrack?`${isLiked?'Geliked':'Liken'}: ${tracks[current]}`:'Wähle zuerst einen Track';
  likeButton.querySelector('span').textContent=isLiked?'♥':'♡';
  likeCount.textContent=hasTrack&&isLiked?'1':'0';
}
function exportLikeHistory(){
  const data={
    scope:'Dieser Browser; nicht mit Likes anderer Besucher zusammengeführt',
    exportedAt:new Date().toISOString(),
    currentLikes:tracks.flatMap((track,index)=>localLikeState.liked[String(index+1)]?[{trackNumber:index+1,track}]:[]),
    events:localLikeState.events
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download='smud-like-verlauf.json';
  link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function readPendingPlayEvents(){
  try{
    const saved=JSON.parse(localStorage.getItem(pendingPlayKey)||'[]');
    return Array.isArray(saved)?saved:[];
  }catch(error){return []}
}
function savePendingPlayEvents(){
  try{localStorage.setItem(pendingPlayKey,JSON.stringify(pendingPlayEvents))}catch(error){}
}
function trackCurrentPlay(){
  if(current<0||playEventTracked)return;
  playEventTracked=true;
  showTrackTitle(current);
  if(location.port!=='4173')return;
  const eventId=window.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  pendingPlayEvents.push({eventId,trackNumber:current+1,clientStartedAt:new Date().toISOString()});
  savePendingPlayEvents();
  sendPendingPlayEvents();
}
function showTrackTitle(index){
  const sequence=++trackTitleSequence;
  window.clearTimeout(trackTitleFadeTimer);
  window.clearTimeout(trackTitleRemoveTimer);
  window.clearTimeout(trackTitleRepeatTimer);
  trackTitleNode?.remove();
  trackTitleNode=null;
  let shown=0;
  const showNext=()=>{
    if(sequence!==trackTitleSequence||current!==index)return;
    const node=document.createElement('div');
    const styles=['slide-left','slide-right','rise','turn','pop','blur','flip'];
    node.className=`lyric-float track-title-float lyric-float--${styles[Math.floor(Math.random()*styles.length)]}`;
    node.textContent=tracks[index];
    node.style.fontSize=`${28+Math.random()*8}px`;
    node.style.setProperty('--lyric-tilt',`${(Math.random()-.5)*3}deg`);
    const targetHost=window.matchMedia('(max-width:600px)').matches?mobileLyrics:lyricsBackdrop;
    targetHost.append(node);
    if(!placeLyric(node)){node.remove();return}
    trackTitleNode=node;
    trackTitleFadeTimer=window.setTimeout(()=>{
      if(sequence!==trackTitleSequence||trackTitleNode!==node)return;
      node.style.animation='none';
      void node.offsetWidth;
      node.classList.add('is-leaving');
      trackTitleRemoveTimer=window.setTimeout(()=>{
        if(sequence!==trackTitleSequence)return;
        node.remove();
        trackTitleNode=null;
        shown++;
        if(shown<index+1)trackTitleRepeatTimer=window.setTimeout(showNext,110);
      },270);
    },480);
  };
  showNext();
}
async function sendPendingPlayEvents(){
  if(playEventSending||!pendingPlayEvents.length)return;
  playEventSending=true;
  try{
    while(pendingPlayEvents.length){
      const event=pendingPlayEvents[0];
      const response=await fetch('/api/plays',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(event),
        keepalive:true
      });
      if(!response.ok)break;
      pendingPlayEvents=pendingPlayEvents.filter(item=>item.eventId!==event.eventId);
      savePendingPlayEvents();
    }
  }catch(error){
    console.warn('Play-Ereignis wartet auf Verbindung zum Cloudflare-Worker.',error);
  }finally{playEventSending=false}
}
window.addEventListener('online',sendPendingPlayEvents);
async function loadLyrics(index){
  const request=++lyricRequest;
  lyricEntries=[];
  lyricDisplayPlans=[];
  renderLyrics();
  try{
    const response=await fetch(`assets/lyrics/${lyricFolders[index]}/lyrics.txt`);
    if(!response.ok){lyricStatus='LYRICS-DATEI NICHT GEFUNDEN';document.querySelector('#now-state').textContent=lyricStatus;return}
    const source=await response.text();
    if(request!==lyricRequest)return;
    if(!source.trim()){
      lyricStatus='FÜR DIESEN TRACK SIND NOCH KEINE LYRICS DA';
      document.querySelector('#now-state').textContent=lyricStatus;
      return;
    }
    const timestampPattern=/[\[(](\d{1,3})[.:,;|/_-](\d{1,2})(?:[.:,;|/_-](\d{1,3}))?[\])]/g;
    lyricEntries=source.split(/\r?\n/).flatMap(rawLine=>{
      if(!rawLine.trim()||rawLine.trim().startsWith('#'))return [];
      const times=[];
      const text=rawLine.replace(timestampPattern,(_,minutes,seconds,fraction='0')=>{
        const first=Number(minutes);
        const second=Number(seconds);
        const fractionValue=Number(fraction);
        const decimal=fraction==='0'?0:fractionValue/(10**fraction.length);
        const atSeconds=first+(second+decimal)/100;
        const atMinutes=first*60+second+decimal;
        const secondsFormat=first>=10&&(!Number.isFinite(audio.duration)||atMinutes>audio.duration);
        times.push(fraction==='0'?first*60+second:(secondsFormat?atSeconds:atMinutes));
        return '';
      }).replace(/\s+/g,' ').trim();
      const emphasized=/!\s*$/.test(text);
      const displayText=text.replace(/!\s*$/,'').trim();
      const isPause=/\bLEERE\b/i.test(displayText);
      if(!displayText&&!isPause)return [];
      return (times.length?times:[null]).map(time=>({time,text:isPause?'':displayText,emphasized:!isPause&&emphasized}));
    });
    lyricEntries.sort((a,b)=>{
      if(a.time===null)return b.time===null?0:1;
      if(b.time===null)return -1;
      return a.time-b.time;
    });
    if(!lyricEntries.length){lyricStatus='FÜR DIESEN TRACK SIND NOCH KEINE LYRICS DA';document.querySelector('#now-state').textContent=lyricStatus;return}
    lyricDisplayPlans=buildLyricDisplayPlans();
    renderLyrics();
    updateLyrics();
  }catch(error){
    if(request===lyricRequest){
      lyricEntries=[];
      renderLyrics();
      lyricStatus=location.protocol==='file:'?'LYRICS BENÖTIGEN EINEN WEBSERVER':'LYRICS KONNTEN NICHT GELADEN WERDEN';
      document.querySelector('#now-state').textContent=lyricStatus;
    }
  }
}
function renderLyrics(){
  lyricsBackdrop.replaceChildren();
  mobileLyrics.replaceChildren();
  lyricFloatNodes.clear();
}
function updateLyrics(){
  const now=audio.currentTime;
  const latestEntry=lyricDisplayPlans.reduce((latest,plan)=>plan.time<=now?plan:latest,null);
  const latestPause=lyricDisplayPlans.reduce((latest,plan)=>plan.pause&&plan.time<=now?Math.max(latest,plan.time):latest,-1);
  const hasFutureText=lyricDisplayPlans.some(plan=>!plan.pause&&plan.time>now);
  const silenceDeadline=latestEntry&&!hasFutureText?latestEntry.time+5:Infinity;
  const visiblePlans=lyricDisplayPlans.flatMap(plan=>{
    if(plan.pause||plan.time>now)return [];
    const pauseDeadline=latestPause>plan.time?latestPause:Infinity;
    const deadline=Math.min(plan.expiresAt,silenceDeadline,pauseDeadline);
    const fadeLead=Math.min(plan.fadeLead,Math.max(0,(deadline-plan.time)*.75));
    const fadeStartsAt=Math.max(plan.time,deadline-fadeLead);
    const displayText=plan.groupEntries?plan.groupEntries.filter(entry=>entry.time<=now).map(entry=>entry.text).join(' '):plan.text;
    if(now<fadeStartsAt)return [{...plan,persistentOnly:false,displayText}];
    if(plan.untilEnd)return [{...plan,persistentOnly:true,displayText}];
    return [];
  });
  const visibleIds=new Set(visiblePlans.map(plan=>plan.index));
  for(const [index,node] of lyricFloatNodes){
    if(visibleIds.has(index))continue;
    lyricFloatNodes.delete(index);
    node.style.animation='none';
    void node.offsetWidth;
    node.classList.add('is-leaving');
    window.setTimeout(()=>node.remove(),1250);
  }
  for(const plan of visiblePlans){
    const existingNode=lyricFloatNodes.get(plan.index);
    if(existingNode){
      const targetHost=window.matchMedia('(max-width:600px)').matches?mobileLyrics:lyricsBackdrop;
      if(existingNode.parentElement!==targetHost){targetHost.append(existingNode);placeLyric(existingNode)}
      if(plan.groupEntries){
        const visibleText=existingNode.querySelector('.lyric-group-visible');
        if(visibleText&&visibleText.textContent!==plan.displayText)visibleText.textContent=plan.displayText;
      }
      if(plan.untilEnd){
        existingNode.dataset.persistentOnly=String(plan.persistentOnly);
        existingNode.querySelectorAll('.lyric-context').forEach(context=>context.classList.toggle('is-hidden-context',plan.persistentOnly));
      }
      continue;
    }
    const node=document.createElement('div');
    const styles=['slide-left','slide-right','rise','turn','pop','blur','flip'];
    const entrance=plan.groupEntries?'rise':styles[Math.floor(Math.random()*styles.length)];
    node.className=`lyric-float${plan.groupEntries?' lyric-group-float':''} lyric-float--${entrance}${plan.emphasized?' lyric-float--emphasized':''}`;
    const baseFontSize=13+Math.random()*10;
    node.style.fontSize=plan.groupEntries?'28px':`${Math.round(baseFontSize*(plan.emphasized?1.55:1))}px`;
    node.style.textAlign=plan.groupEntries?'left':['left','center','right'][Math.floor(Math.random()*3)];
    node.style.setProperty('--lyric-tilt',plan.groupEntries?'0deg':`${(Math.random()-.5)*5}deg`);
    if(plan.groupEntries){
      const content=document.createElement('span');
      const placeholder=document.createElement('span');
      const visible=document.createElement('span');
      content.className='lyric-group-content';
      placeholder.className='lyric-group-placeholder';
      visible.className='lyric-group-visible';
      placeholder.textContent=plan.groupFullText;
      visible.textContent=plan.displayText;
      content.append(placeholder,visible);
      node.append(content);
    }else if(plan.untilEnd){
      const before=document.createElement('span');
      const phrase=document.createElement('span');
      const after=document.createElement('span');
      before.className='lyric-context';
      phrase.className='lyric-persistent-phrase';
      after.className='lyric-context';
      before.textContent=plan.text.slice(0,plan.phraseStart);
      phrase.textContent=plan.persistentText;
      after.textContent=plan.text.slice(plan.phraseEnd);
      if(plan.persistentOnly){before.classList.add('is-hidden-context');after.classList.add('is-hidden-context')}
      node.append(before,phrase,after);
      node.dataset.persistentOnly=String(plan.persistentOnly);
    }else node.textContent=plan.text;
    node.dataset.entry=String(plan.index);
    const targetHost=window.matchMedia('(max-width:600px)').matches?mobileLyrics:lyricsBackdrop;
    targetHost.append(node);
    if(placeLyric(node))lyricFloatNodes.set(plan.index,node);
    else node.remove();
  }
}
function buildLyricDisplayPlans(){
  const timed=lyricEntries.map((entry,index)=>({...entry,index})).filter(entry=>entry.time!==null);
  const gaps=[];
  for(let i=1;i<timed.length;i++)if(timed[i].time>timed[i-1].time)gaps.push(timed[i].time-timed[i-1].time);
  const averageGap=gaps.length?gaps.reduce((sum,gap)=>sum+gap,0)/gaps.length:2;
  let previousRetention=2;
  const plans=timed.map((entry,index)=>{
    const passagesToKeep=Math.max(previousRetention,2+Math.floor(Math.random()*3));
    previousRetention=passagesToKeep;
    const expiryPassage=timed[index+passagesToKeep];
    const fallbackEnd=Number.isFinite(audio.duration)&&audio.duration>entry.time?audio.duration:timed[timed.length-1].time+averageGap*passagesToKeep;
    const expiresAt=expiryPassage?expiryPassage.time:fallbackEnd;
    const phraseMatch=current===5?entry.text.match(/am ende bin ich da/i):null;
    const persistentText=phraseMatch?.[0]||null;
    const untilEnd=Boolean(persistentText);
    return {...entry,passagesToKeep,expiresAt:Math.max(expiresAt,entry.time+.25),fadeLead:1.25+Math.random()*.35,pause:!entry.text,untilEnd,persistentText,phraseStart:phraseMatch?.index??-1,phraseEnd:phraseMatch?phraseMatch.index+persistentText.length:-1};
  });
  if(current!==1)return plans;
  const groupIndexes=plans.map((entry,index)=>({entry,index})).filter(({entry})=>entry.time>=124.4&&entry.time<=126.01&&/^(sag|mir|wer|ja)$/i.test(entry.text));
  if(groupIndexes.length!==5)return plans;
  const groupEntries=groupIndexes.map(({entry})=>entry);
  const firstIndex=groupIndexes[0].index;
  const lastIndex=groupIndexes[groupIndexes.length-1].index;
  const lastFollowing=plans[lastIndex+2];
  const groupPlan={...groupEntries[0],index:'sag-mir-wer-cluster',text:'',groupEntries,groupFullText:groupEntries.map(entry=>entry.text).join(' '),expiresAt:lastFollowing?.expiresAt??groupEntries[groupEntries.length-1].expiresAt,fadeLead:lastFollowing?.fadeLead??1.3,pause:false,untilEnd:false,clusterStart:firstIndex};
  return plans.filter((_,index)=>index<firstIndex||index>lastIndex).concat(groupPlan).sort((a,b)=>a.time-b.time);
}
function placeLyric(node){
  if(window.matchMedia('(max-width:600px)').matches){
    node.classList.add('mobile-lyric-float');
    node.style.visibility='visible';
    return true;
  }
  node.classList.remove('mobile-lyric-float');
  const playerRect=player.getBoundingClientRect();
  const viewportWidth=window.innerWidth;
  const viewportHeight=window.innerHeight;
  const edge=8;
  const leftSpace=playerRect.left-edge*2;
  const rightSpace=viewportWidth-playerRect.right-edge*2;
  const availableWidth=Math.min(320,Math.max(leftSpace,rightSpace));
  if(availableWidth<36)return false;
  node.style.maxWidth=`${availableWidth}px`;
  node.style.visibility='hidden';
  node.style.left='0px';
  node.style.top='0px';
  const width=node.offsetWidth;
  const height=node.offsetHeight;
  const randomBetween=(min,max)=>min<=max?min+Math.random()*(max-min):min;
  const zones=[];
  const sideTop=Math.max(edge,playerRect.top+edge);
  const sideBottom=Math.min(viewportHeight-height-edge,playerRect.bottom-height-edge);
  if(sideBottom<sideTop)return false;
  const leftMax=playerRect.left-width-edge;
  if(leftSpace>=width&&leftMax>=edge)zones.push(()=>({x:randomBetween(edge,leftMax),y:randomBetween(sideTop,sideBottom)}));
  const rightMin=playerRect.right+edge;
  if(rightSpace>=width&&rightMin<=viewportWidth-width-edge)zones.push(()=>({x:randomBetween(rightMin,viewportWidth-width-edge),y:randomBetween(sideTop,sideBottom)}));
  if(!zones.length)return false;
  for(let attempt=0;attempt<30;attempt++){
    const zone=zones[Math.floor(Math.random()*zones.length)];
    if(!zone)break;
    const point=zone();
    const box={left:point.x,right:point.x+width,top:point.y,bottom:point.y+height};
    const overlapsPlayer=box.left<playerRect.right&&box.right>playerRect.left&&box.top<playerRect.bottom&&box.bottom>playerRect.top;
    const overlapsLyric=[...document.querySelectorAll('.lyric-float')].some(other=>{if(other===node)return false;const left=parseFloat(other.style.left)||0;const top=parseFloat(other.style.top)||0;const otherBox={left,top,right:left+other.offsetWidth,bottom:top+other.offsetHeight};return box.left<otherBox.right+8&&box.right>otherBox.left-8&&box.top<otherBox.bottom+8&&box.bottom>otherBox.top-8});
    if(overlapsPlayer||overlapsLyric)continue;
    node.style.left=`${point.x}px`;node.style.top=`${point.y}px`;node.style.visibility='visible';return true;
  }
  return false;
}
function updateSeekProgress(){
  const seek=document.querySelector('#seek');
  const progress=audio.duration?Math.min(100,Math.max(0,audio.currentTime/audio.duration*100)):0;
  seek.value=progress;
  seek.style.setProperty('--seek-progress',`${progress}%`);
  document.querySelector('#elapsed').textContent=format(audio.currentTime);
}
function format(seconds){return Number.isFinite(seconds)?`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`:'—:——'}
