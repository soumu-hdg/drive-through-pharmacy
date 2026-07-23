// ============================================
// SoundForge — シーン別タグ 横断ブラウズ UI
// ============================================
(function(){
  'use strict';

  let currentScene='menu', focusIdx=-1, playIdx=-1, isPlaying=false, ws=null;
  let activeScene='all', activeMood='all';

  const TRACKS = (typeof UNIFIED_TRACKS !== 'undefined') ? UNIFIED_TRACKS.slice() : [];
  // シーンタグ順 → コレクション順で安定ソート
  const ORDER = {}; (typeof SCENE_TAGS!=='undefined'?SCENE_TAGS:[]).forEach((t,i)=>ORDER[t.key]=i);
  TRACKS.sort((a,b)=>(ORDER[a.sceneTag]-ORDER[b.sceneTag])||a.collection.localeCompare(b.collection));

  const barList=document.getElementById('barList');
  const detailEmpty=document.getElementById('detailEmpty');
  const detailFilled=document.getElementById('detailFilled');
  const mp=document.getElementById('mp');

  const sceneLabel=k=>(SCENE_TAG_MAP[k]?SCENE_TAG_MAP[k].label:k);
  const sceneShort=k=>(SCENE_TAG_MAP[k]?SCENE_TAG_MAP[k].short:k);
  const sceneIcon =k=>(SCENE_TAG_MAP[k]?SCENE_TAG_MAP[k].icon:'');
  const moodLabel =k=>(MOOD_TAG_MAP[k]?MOOD_TAG_MAP[k].label:k);

  // ── シーン切替 ──
  function go(id){
    if(id===currentScene)return;
    const t=document.getElementById('trans');
    t.classList.remove('out');t.classList.add('in');
    setTimeout(()=>{
      document.querySelectorAll('.sc').forEach(s=>s.classList.remove('active'));
      document.getElementById('sc-'+id).classList.add('active');
      currentScene=id;
      history.pushState({scene:id},'','#'+id);
      t.classList.remove('in');t.classList.add('out');
      setTimeout(()=>t.classList.remove('out'),400);
    },300);
  }
  window.goScene=go;

  window.addEventListener('popstate',e=>{
    const id=e.state?.scene||(location.hash?location.hash.slice(1):'menu');
    if(id===currentScene)return;
    document.querySelectorAll('.sc').forEach(s=>s.classList.remove('active'));
    document.getElementById('sc-'+id).classList.add('active');
    currentScene=id;
  });

  // ── Wavesurfer ──
  function initWS(){
    ws=WaveSurfer.create({
      container:'#mpWave',
      waveColor:'rgba(77,232,244,.08)',
      progressColor:'#e8232a',
      cursorColor:'#4de8f4',
      cursorWidth:2,barWidth:2,barGap:1,barRadius:1,
      height:36,responsive:true,normalize:true
    });
    ws.on('timeupdate',t=>{
      document.getElementById('mpCur').textContent=fmt(t);
      const d=ws.getDuration();
      if(d>0)document.getElementById('mpProg').style.width=(t/d*100)+'%';
    });
    ws.on('ready',()=>{document.getElementById('mpDur').textContent=fmt(ws.getDuration())});
    ws.on('finish',()=>adj(1));
    ws.on('play',()=>{isPlaying=true;syncUI()});
    ws.on('pause',()=>{isPlaying=false;syncUI()});
  }

  // ── フィルタ ──
  function filt(){
    return TRACKS.filter(t=>
      (activeScene==='all'||t.sceneTag===activeScene) &&
      (activeMood==='all'||t.moodTag===activeMood)
    );
  }

  // ── バーリスト描画 ──
  function render(){
    const list=filt();
    document.getElementById('browseCount').textContent='全'+list.length+'曲';
    const hn=document.getElementById('heroCount');
    if(hn)hn.textContent=TRACKS.length;

    if(!list.length){
      barList.innerHTML='<div class="bar-empty">該当する楽曲がありません</div>';
      return;
    }

    barList.innerHTML=list.map(t=>{
      const gi=TRACKS.indexOf(t);
      const sel=gi===focusIdx;
      return `
        <div class="p3r-bar${sel?' bar-selected':''}" data-gi="${gi}">
          <div class="bar-label bar-label-${t.sceneTag}">${sceneIcon(t.sceneTag)} ${sceneShort(t.sceneTag)}</div>
          <span class="bar-name">${t.title}<span class="bar-sub">${moodLabel(t.moodTag)}</span></span>
          <span class="bar-meta">▶</span>
        </div>`;
    }).join('');

    barList.querySelectorAll('.p3r-bar').forEach(b=>{
      b.addEventListener('click',()=>focus(+b.dataset.gi));
    });
  }

  // ── フォーカス ──
  function focus(gi){
    focusIdx=gi;
    const t=TRACKS[gi];
    const list=filt();
    const di=list.indexOf(t);

    barList.querySelectorAll('.p3r-bar').forEach(b=>b.classList.remove('bar-selected'));
    const row=barList.querySelector(`.p3r-bar[data-gi="${gi}"]`);
    if(row){row.classList.add('bar-selected');row.scrollIntoView({block:'nearest',behavior:'smooth'})}

    detailEmpty.style.display='none';
    detailFilled.style.display='';

    const dfImage=document.getElementById('dfImage');
    const dfImg=document.getElementById('dfImg');
    if(t.image){dfImg.src=t.image;dfImage.style.display='';dfImg.onerror=()=>{dfImage.style.display='none'}}
    else{dfImage.style.display='none';dfImg.src=''}

    document.getElementById('dfNum').textContent='#'+String(di+1).padStart(2,'0');
    document.getElementById('dfTitle').textContent=t.title;
    document.getElementById('dfDesc').textContent=t.desc;
    document.getElementById('dfScene').textContent=sceneLabel(t.sceneTag);
    document.getElementById('dfMood').textContent=moodLabel(t.moodTag);

    // 再生時間はメタデータから取得
    const timeEl=document.getElementById('dfTime');
    timeEl.textContent='--';
    const a=new Audio();a.preload='metadata';a.src=t.audio;
    a.onloadedmetadata=()=>{if(isFinite(a.duration))timeEl.textContent=fmt(a.duration)};

    document.getElementById('dfTags').innerHTML=
      `<span class="dtag dtag-scene dtag-${t.sceneTag}">${sceneLabel(t.sceneTag)}</span>`+
      `<span class="dtag">${moodLabel(t.moodTag)}</span>`+
      (t.collectionTitle?`<span class="dtag dtag-col">${t.collectionTitle.split(/[\/｜]/)[0].trim()}</span>`:'');

    const dl=document.getElementById('dfDl');
    dl.style.display=t.audio?'':'none';
    if(t.audio){dl.href=t.audio;dl.download=(t.titleEn||t.title)+'.mp3'}

    syncDetailBtn();
  }

  // ── 再生 ──
  function play(gi){
    const t=TRACKS[gi];
    if(!t)return;
    if(playIdx===gi&&isPlaying){ws.pause();return}
    if(playIdx===gi&&!isPlaying){ws.play();return}
    playIdx=gi;
    document.getElementById('mpTitle').textContent=t.title;
    mp.classList.add('visible');
    document.getElementById('mpProg').style.width='0%';
    document.body.classList.add('mp-active');
    ws.load(t.audio);
    ws.once('ready',()=>ws.play());
  }

  function adj(dir){
    const p=filt();
    if(!p.length)return;
    const c=p.findIndex(t=>TRACKS.indexOf(t)===playIdx);
    const n=(c+dir+p.length)%p.length;
    const gi=TRACKS.indexOf(p[n]);
    focus(gi);play(gi);
  }

  function syncUI(){
    const pp=document.getElementById('mpPlay');
    pp.querySelector('.icon-play').style.display=isPlaying?'none':'';
    pp.querySelector('.icon-pause').style.display=isPlaying?'':'none';
    syncDetailBtn();
  }

  function syncDetailBtn(){
    const btn=document.getElementById('dfPlay');
    if(!btn)return;
    const cur=focusIdx===playIdx&&isPlaying;
    btn.querySelector('.icon-play').style.display=cur?'none':'';
    btn.querySelector('.icon-pause').style.display=cur?'':'none';
    document.getElementById('dfPlayLabel').textContent=cur?'一時停止':'再生';
  }

  function fmt(s){const m=Math.floor(s/60);return m+':'+Math.floor(s%60).toString().padStart(2,'0')}

  // メニューのシーンボタン → ブラウズをそのタグでフィルタ
  function jumpToScene(sceneKey){
    activeScene=sceneKey; activeMood='all';
    focusIdx=-1;
    detailEmpty.style.display='';detailFilled.style.display='none';
    // タブUI同期
    document.querySelectorAll('#sceneFilter .sf-tab').forEach(t=>t.classList.toggle('sf-active',t.dataset.scene===sceneKey));
    document.querySelectorAll('#moodFilter .mf-tab').forEach(t=>t.classList.toggle('mf-active',t.dataset.mood==='all'));
    render();
    go('browse');
  }

  // ── イベント ──
  function bind(){
    // メニュー：シーンボタン（横断ブラウズへ）
    document.querySelectorAll('.menu-item[data-scene]').forEach(mi=>{
      mi.addEventListener('click',()=>jumpToScene(mi.dataset.scene));
      mi.addEventListener('mouseenter',()=>{
        document.querySelectorAll('.menu-item').forEach(m=>m.classList.remove('mi-active'));
        mi.classList.add('mi-active');
      });
    });
    // メニュー：シーン切替ボタン（案内など）
    document.querySelectorAll('.menu-item[data-target]').forEach(mi=>{
      mi.addEventListener('click',()=>go(mi.dataset.target.replace('sc-','')));
      mi.addEventListener('mouseenter',()=>{
        document.querySelectorAll('.menu-item').forEach(m=>m.classList.remove('mi-active'));
        mi.classList.add('mi-active');
      });
    });

    // シーン内ナビリンク
    document.querySelectorAll('.nav-link[data-nav]').forEach(link=>{
      link.addEventListener('click',()=>go(link.dataset.nav));
    });

    // シーン別タグ
    document.querySelectorAll('#sceneFilter .sf-tab').forEach(tab=>{
      tab.addEventListener('click',()=>{
        document.querySelectorAll('#sceneFilter .sf-tab').forEach(t=>t.classList.remove('sf-active'));
        tab.classList.add('sf-active');
        activeScene=tab.dataset.scene;
        focusIdx=-1;
        detailEmpty.style.display='';detailFilled.style.display='none';
        render();
      });
    });
    // 雰囲気タグ
    document.querySelectorAll('#moodFilter .mf-tab').forEach(tab=>{
      tab.addEventListener('click',()=>{
        document.querySelectorAll('#moodFilter .mf-tab').forEach(t=>t.classList.remove('mf-active'));
        tab.classList.add('mf-active');
        activeMood=tab.dataset.mood;
        focusIdx=-1;
        detailEmpty.style.display='';detailFilled.style.display='none';
        render();
      });
    });

    // 詳細の再生
    document.getElementById('dfPlay').addEventListener('click',()=>{if(focusIdx>=0)play(focusIdx)});

    // ミニプレイヤー
    document.getElementById('mpPlay').addEventListener('click',()=>{if(playIdx>=0)ws.playPause()});
    document.getElementById('mpPrev').addEventListener('click',()=>adj(-1));
    document.getElementById('mpNext').addEventListener('click',()=>adj(1));
    document.getElementById('mpTitle').addEventListener('click',()=>{
      if(playIdx>=0){
        if(currentScene!=='browse')go('browse');
        setTimeout(()=>focus(playIdx),currentScene!=='browse'?400:0);
      }
    });

    // キーボード
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&currentScene!=='menu'){e.preventDefault();go('menu');return}
      if(currentScene==='menu'){
        const items=[...document.querySelectorAll('.menu-item')];
        const ci=items.findIndex(m=>m.classList.contains('mi-active'));
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){
          e.preventDefault();
          const ni=e.key==='ArrowDown'?(ci+1)%items.length:(ci-1+items.length)%items.length;
          items.forEach(m=>m.classList.remove('mi-active'));
          items[ni].classList.add('mi-active');
        }
        if(e.key==='Enter'){e.preventDefault();const a=items.find(m=>m.classList.contains('mi-active'));if(a)a.click()}
        return;
      }
      if(currentScene!=='browse')return;
      const list=filt();
      if(!list.length)return;
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){
        e.preventDefault();
        const c=list.findIndex(t=>TRACKS.indexOf(t)===focusIdx);
        let n;
        if(e.key==='ArrowDown')n=c<0?0:(c+1)%list.length;
        else n=c<=0?list.length-1:c-1;
        focus(TRACKS.indexOf(list[n]));
      }
      if(e.key==='Enter'&&focusIdx>=0){e.preventDefault();play(focusIdx)}
    });
  }

  function init(){
    initWS();render();bind();
    const hash=location.hash.slice(1);
    if(hash&&document.getElementById('sc-'+hash)){
      document.querySelectorAll('.sc').forEach(s=>s.classList.remove('active'));
      document.getElementById('sc-'+hash).classList.add('active');
      currentScene=hash;
    }
    history.replaceState({scene:currentScene},'','#'+currentScene);
    const t=document.getElementById('trans');
    t.classList.add('in');
    setTimeout(()=>{t.classList.remove('in');t.classList.add('out');
      setTimeout(()=>t.classList.remove('out'),400);
    },200);
  }

  document.addEventListener('DOMContentLoaded',init);
})();
