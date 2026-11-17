(function(){
  var d=document,root=d.documentElement,reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.classList.add('js');

  // Заголовок — слова выезжают по одному
  var h1=d.getElementById('h1'),i=0;
  if(h1)(function split(node){
    Array.prototype.slice.call(node.childNodes).forEach(function(n){
      if(n.nodeType===3){
        var f=d.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(function(p){
          if(!p)return;
          if(/^\s+$/.test(p)){f.appendChild(d.createTextNode(' '));return}
          var w=d.createElement('span');w.className='w';
          var s=d.createElement('span');s.style.setProperty('--i',i++);s.textContent=p;
          w.appendChild(s);f.appendChild(w);
        });
        node.replaceChild(f,n);
      }else if(n.nodeType===1){
        // слово внутри <em> остаётся с градиентом: оборачиваем сам em
        var w=d.createElement('span');w.className='w';
        var s=d.createElement('span');s.style.setProperty('--i',i++);
        node.replaceChild(w,n);s.appendChild(n);w.appendChild(s);
      }
    });
  })(h1);

  // Бегущая строка: вторая копия для бесшовного круга
  var mq=d.getElementById('marq');if(mq)mq.innerHTML+=mq.innerHTML;

  // Появление при прокрутке
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.14,rootMargin:'0px 0px -6% 0px'});
  d.querySelectorAll('[data-r]').forEach(function(el){io.observe(el)});

  // Счётчики
  function fmt(n){return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' ')}
  var co=new IntersectionObserver(function(es){es.forEach(function(e){
    if(!e.isIntersecting)return;co.unobserve(e.target);
    var el=e.target,to=+el.dataset.count,plain=el.hasAttribute('data-plain'),from=plain?to-30:0,t0=performance.now(),dur=1600;
    if(reduce){return}
    (function tick(t){var p=Math.min(1,(t-t0)/dur),v=Math.round(from+(to-from)*(1-Math.pow(1-p,4)));el.textContent=plain?v:fmt(v);if(p<1)requestAnimationFrame(tick)})(t0);
  })},{threshold:.6});
  d.querySelectorAll('[data-count]').forEach(function(el){co.observe(el)});

  // Шапка, кнопка на телефоне, параллакс
  var nav=d.getElementById('nav'),mbar=d.getElementById('mbar'),px=d.querySelectorAll('[data-px]'),tick=false;
  function onScroll(){
    var y=scrollY;
    nav.classList.toggle('scrolled',y>40);
    var nearEnd=y+innerHeight>d.body.scrollHeight-500;
    mbar.classList.toggle('show',y>innerHeight*.7&&!nearEnd);
    if(!reduce)px.forEach(function(im){
      var r=im.parentNode.getBoundingClientRect();
      if(r.bottom<0||r.top>innerHeight)return;
      var k=(r.top+r.height/2-innerHeight/2)/innerHeight;
      im.style.transform='translate3d(0,'+(k*+im.dataset.px-5)+'%,0)';
    });
    tick=false;
  }
  addEventListener('scroll',function(){if(!tick){tick=true;requestAnimationFrame(onScroll)}},{passive:true});
  onScroll();

  // Коллаж следует за курсором
  var col=d.getElementById('collage');
  if(col&&!reduce&&matchMedia('(pointer:fine)').matches){
    var items=col.querySelectorAll('[data-depth]'),tx=0,ty=0,cx=0,cy=0,run=false;
    d.querySelector('.hero').addEventListener('pointermove',function(e){
      tx=e.clientX/innerWidth-.5;ty=e.clientY/innerHeight-.5;
      if(!run){run=true;requestAnimationFrame(loop)}
    });
    function loop(){
      cx+=(tx-cx)*.08;cy+=(ty-cy)*.08;
      items.forEach(function(el){var k=+el.dataset.depth;el.style.translate=(-cx*k)+'px '+(-cy*k)+'px'});
      if(Math.abs(tx-cx)>.001||Math.abs(ty-cy)>.001)requestAnimationFrame(loop);else run=false;
    }
  }

  // Вопросы
  d.querySelectorAll('#faq .qa button').forEach(function(b){b.addEventListener('click',function(){
    var q=b.parentNode,open=q.classList.contains('open');
    d.querySelectorAll('#faq .qa.open').forEach(function(o){o.classList.remove('open');o.firstChild.setAttribute('aria-expanded','false')});
    if(!open){q.classList.add('open');b.setAttribute('aria-expanded','true')}
  })});


  // Линия истории («О нас») заполняется по мере прокрутки
  var tl=d.getElementById('tl');
  if(tl){
    var fill=tl.querySelector('.tl-fill'),tt=false;
    function tlUpd(){var r=tl.getBoundingClientRect(),p=(innerHeight*.6-r.top)/r.height;fill.style.transform='scaleY('+Math.max(0,Math.min(1,p))+')';
      tl.querySelectorAll('.tl-item').forEach(function(it){it.classList.toggle('on',it.getBoundingClientRect().top<innerHeight*.6)});tt=false}
    addEventListener('scroll',function(){if(!tt){tt=true;requestAnimationFrame(tlUpd)}},{passive:true});tlUpd();
  }

  // Плашки направлений («Тренировки»): подсветка текущего
  var chips=d.querySelectorAll('#dchips a');
  if(chips.length){
    var so=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)chips.forEach(function(c){
      var on=c.getAttribute('href')==='#'+e.target.id;c.classList.toggle('on',on);
      if(on&&c.parentNode.scrollWidth>c.parentNode.clientWidth)c.parentNode.scrollTo({left:c.offsetLeft-c.parentNode.clientWidth/2+c.clientWidth/2,behavior:'smooth'})})})},{rootMargin:'-45% 0px -50% 0px'});
    d.querySelectorAll('.tr').forEach(function(el){so.observe(el)});
  }

  // Выбор варианта (вакансия) и отправка заявки в WhatsApp — без сервера
  d.querySelectorAll('.opts').forEach(function(g){g.addEventListener('click',function(e){
    var b=e.target.closest('button');if(!b)return;
    g.querySelectorAll('button').forEach(function(o){o.classList.toggle('on',o===b)});
  })});
  d.querySelectorAll('form[data-wa]').forEach(function(f){f.addEventListener('submit',function(e){
    e.preventDefault();
    var lines=[f.dataset.wa];
    f.querySelectorAll('input,textarea').forEach(function(i){if(i.value.trim())lines.push(i.dataset.label+': '+i.value.trim())});
    var o=f.querySelector('.opts .on');if(o)lines.push(f.querySelector('.opts').dataset.label+': '+o.textContent);
    open('https://wa.me/995591288682?text='+encodeURIComponent(lines.join('\n')),'_blank','noopener');
  })});

  // Меню и язык
  var burger=d.getElementById('burger');
  burger.addEventListener('click',function(){d.body.classList.toggle('menu-open')});
  d.querySelectorAll('#mmenu a').forEach(function(a){a.addEventListener('click',function(){d.body.classList.remove('menu-open')})});
  var lang=d.getElementById('lang');
  lang.querySelector('.lang-btn').addEventListener('click',function(e){e.stopPropagation();lang.classList.toggle('open')});
  d.addEventListener('click',function(){lang.classList.remove('open')});
})();
